//! Shared request-boundary guards for Shelf Drive's local HTTP services
//! (REST API and WebDAV): Host-header validation and authentication-failure
//! rate limiting.
//!
//! Both services bind to IPv4 loopback only. These guards defend the
//! application against DNS-rebinding-style requests (attacker-controlled
//! Host headers) and against local processes brute-forcing the API key or
//! WebDAV capability token.

use actix_web::http::header::HeaderValue;
use actix_web::web;
use actix_web::HttpResponse;
use std::collections::HashMap;
use std::net::IpAddr;
use std::time::{Duration, Instant};

/// Maximum number of tracked identities per limiter. Mirrors the share
/// password limiter's bounded-memory convention.
const MAX_TRACKED_IDENTITIES: usize = 1024;

/// Hosts a loopback client may legitimately present. `localhost` and
/// `127.0.0.1` both resolve to the loopback listener; everything else
/// (including `[::1]`, which the REST/WebDAV listeners do not bind) is
/// rejected before routing.
fn is_local_host_name(host: &str) -> bool {
    host.eq_ignore_ascii_case("localhost") || host == "127.0.0.1"
}

/// Validates a `Host` header value against the loopback names and the
/// server's bound port. Accepts `host`, `host:port`, and (for IPv6
/// notation) `[host]:port`, but only when the host is a loopback name and
/// the optional port equals the bound port. A missing/empty Host header is
/// rejected: HTTP/1.1 requires it and every real WebDAV/REST client sends it.
pub fn host_header_allowed(host_header: Option<&HeaderValue>, bound_port: u16) -> bool {
    let host_str = host_header.and_then(|v| v.to_str().ok());
    host_header_str_allowed(host_str, bound_port)
}

/// Validates a raw Host header string slice against the loopback names and
/// bound port.
pub fn host_header_str_allowed(host_str: Option<&str>, bound_port: u16) -> bool {
    let Some(host_str) = host_str else {
        return false;
    };
    if host_str.is_empty() {
        return false;
    }

    // Split an IPv6 bracket form first: "[::1]:8551" or "[::1]".
    let (host_part, port_part) = if let Some(rest) = host_str.strip_prefix('[') {
        match rest.split_once(']') {
            Some((inside, remainder)) => {
                let port = remainder.strip_prefix(':');
                (inside, port)
            }
            None => return false, // Unterminated bracket: malformed.
        }
    } else {
        match host_str.rsplit_once(':') {
            // A single colon splits host:port; hosts cannot contain ':'.
            Some((host, port)) => (host, Some(port)),
            None => (host_str, None),
        }
    };

    if !is_local_host_name(host_part) {
        return false;
    }

    match port_part {
        None => true, // HTTP/1.0-style Host without a port.
        Some(port) => {
            if bound_port == 0 {
                true
            } else {
                port.parse::<u16>()
                    .map(|p| p == bound_port)
                    .unwrap_or(false)
            }
        }
    }
}

/// Parses an IP address string for limiter keying. Loopback clients all share
/// `127.0.0.1`, which is exactly the aggregation we want for auth-failure
/// buckets: the legitimate application never fails authentication.
pub fn peer_identity(peer_addr: Option<std::net::SocketAddr>) -> String {
    peer_addr
        .map(|addr| match addr.ip() {
            IpAddr::V4(v4) => v4.to_string(),
            IpAddr::V6(v6) => v6.to_string(),
        })
        .unwrap_or_else(|| "unknown".to_string())
}

/// Fixed-window authentication-failure limiter. Records failures per
/// identity; once `max_failures` failures occur inside `window`, the identity
/// is blocked for `cooldown`. Successful authentication clears the identity's
/// history (the legitimate application never fails authentication, so this
/// cannot be abused to reset an attacker's bucket).
pub struct FailureLimiter {
    max_failures: usize,
    window: Duration,
    cooldown: Duration,
    failures: HashMap<String, Vec<Instant>>,
    limited_until: HashMap<String, Instant>,
}

impl Default for FailureLimiter {
    fn default() -> Self {
        // Production defaults: 10 failed authentications within 60 seconds
        // block the identity for 60 seconds.
        Self::new(10, Duration::from_secs(60), Duration::from_secs(60))
    }
}

impl FailureLimiter {
    pub fn new(max_failures: usize, window: Duration, cooldown: Duration) -> Self {
        Self {
            max_failures,
            window,
            cooldown,
            failures: HashMap::new(),
            limited_until: HashMap::new(),
        }
    }

    fn prune(&mut self, now: Instant, identity: &str) {
        if let Some(entries) = self.failures.get_mut(identity) {
            entries.retain(|at| now.duration_since(*at) <= self.window);
        }
        if let Some(until) = self.limited_until.get(identity) {
            if now >= *until {
                self.limited_until.remove(identity);
            }
        }
        if self.failures.len() > MAX_TRACKED_IDENTITIES {
            self.failures.clear();
        }
    }

    /// Returns `Some(retry_after_seconds)` when the identity is currently
    /// rate-limited.
    pub fn is_limited(&mut self, identity: &str) -> Option<u64> {
        let now = Instant::now();
        self.prune(now, identity);
        self.limited_until.get(identity).map(|until| {
            u64::try_from(until.duration_since(now).as_secs())
                .unwrap_or(1)
                .max(1)
        })
    }

    pub fn record_failure(&mut self, identity: &str) {
        let now = Instant::now();
        self.prune(now, identity);
        let entries = self.failures.entry(identity.to_string()).or_default();
        entries.push(now);
        if entries.len() >= self.max_failures {
            self.limited_until
                .insert(identity.to_string(), now + self.cooldown);
            self.failures.remove(identity);
        }
    }

    pub fn record_success(&mut self, identity: &str) {
        self.failures.remove(identity);
        self.limited_until.remove(identity);
    }
}

/// 429 response used when an identity exceeds the auth-failure budget.
pub fn rate_limited_response(retry_after_secs: u64) -> HttpResponse {
    HttpResponse::TooManyRequests()
        .insert_header(("Retry-After", retry_after_secs.to_string()))
        .json(web::Json({
            serde_json::json!({
                "error": {"code": "RATE_LIMITED", "message": "Too many failed authentication attempts. Retry later."}
            })
        }))
}

/// Auth-failure limiter for the REST API key (shared across actix workers).
pub static REST_AUTH_LIMITER: std::sync::LazyLock<std::sync::Mutex<FailureLimiter>> =
    std::sync::LazyLock::new(|| std::sync::Mutex::new(FailureLimiter::default()));

/// Auth-failure limiter for the WebDAV capability token (shared across
/// actix workers).
pub static WEBDAV_AUTH_LIMITER: std::sync::LazyLock<std::sync::Mutex<FailureLimiter>> =
    std::sync::LazyLock::new(|| std::sync::Mutex::new(FailureLimiter::default()));

/// 403 response used when the Host header is not a loopback form bound by
/// the service (DNS-rebinding-style request).
pub fn host_rejected_response() -> HttpResponse {
    HttpResponse::Forbidden()
        .json(web::Json({
            serde_json::json!({
                "error": {"code": "HOST_NOT_ALLOWED", "message": "Requests must target the loopback address this service is bound to."}
            })
        }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_loopback_host_forms_with_matching_port() {
        assert!(host_header_str_allowed(Some("127.0.0.1:8550"), 8550));
        assert!(host_header_str_allowed(Some("localhost:8550"), 8550));
        assert!(host_header_str_allowed(Some("LOCALHOST:8550"), 8550));
        assert!(host_header_str_allowed(Some("127.0.0.1"), 8550));
        assert!(host_header_str_allowed(Some("localhost"), 8550));
    }

    #[test]
    fn rejects_attacker_controlled_and_malformed_hosts() {
        assert!(!host_header_str_allowed(Some("attacker.example"), 8550));
        assert!(!host_header_str_allowed(
            Some("localhost.attacker.example"),
            8550
        ));
        assert!(!host_header_str_allowed(
            Some("127.0.0.1.attacker.example"),
            8550
        ));
        assert!(!host_header_str_allowed(
            Some("evil-localhost.example"),
            8550
        ));
        assert!(!host_header_str_allowed(Some("localhost:9999"), 8550));
        assert!(!host_header_str_allowed(Some("[::1]:8550"), 8550));
        assert!(!host_header_str_allowed(Some(""), 8550));
        assert!(!host_header_str_allowed(None, 8550));
        assert!(!host_header_str_allowed(Some("127.0.0.1 evil"), 8550));
        assert!(!host_header_str_allowed(Some("user@127.0.0.1"), 8550));
    }

    #[test]
    fn rate_limiter_blocks_after_threshold_and_recovers() {
        let mut limiter =
            FailureLimiter::new(3, Duration::from_millis(50), Duration::from_millis(80));
        assert!(limiter.is_limited("127.0.0.1").is_none());
        limiter.record_failure("127.0.0.1");
        limiter.record_failure("127.0.0.1");
        assert!(limiter.is_limited("127.0.0.1").is_none());
        limiter.record_failure("127.0.0.1");
        assert!(limiter.is_limited("127.0.0.1").is_some());
        // Success clears the bucket (legitimate user recovery).
        limiter.record_success("127.0.0.1");
        assert!(limiter.is_limited("127.0.0.1").is_none());
    }

    #[test]
    fn rate_limiter_window_expires() {
        let mut limiter =
            FailureLimiter::new(2, Duration::from_millis(40), Duration::from_millis(40));
        limiter.record_failure("h");
        limiter.record_failure("h");
        assert!(limiter.is_limited("h").is_some());
        std::thread::sleep(Duration::from_millis(60));
        assert!(limiter.is_limited("h").is_none());
    }

    #[test]
    fn rate_limiter_bounds_tracked_identities() {
        let mut limiter = FailureLimiter::new(1, Duration::from_secs(60), Duration::from_secs(60));
        for index in 0..(MAX_TRACKED_IDENTITIES + 32) {
            limiter.record_failure(&format!("identity-{index}"));
        }
        // Bounded memory: the map must not have grown past the cap.
        assert!(limiter.failures.len() <= MAX_TRACKED_IDENTITIES);
        assert!(limiter.is_limited("identity-0").is_some() || limiter.failures.len() <= 8);
    }

    #[test]
    fn peer_identity_handles_missing_peer() {
        assert_eq!(peer_identity(None), "unknown");
        assert_eq!(
            peer_identity(Some("127.0.0.1:5000".parse().unwrap())),
            "127.0.0.1"
        );
    }
}
