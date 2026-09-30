//! Resource-bound, expiring, memory-only stream capabilities for Shelf Drive.
//!
//! Stream tokens are short-lived bearer capabilities issued for specific
//! media/file streaming operations. They replace process-lifetime master
//! tokens, enforcing:
//! - Cryptographically secure 256-bit CSPRNG generation
//! - Configurable time-to-live (default: 1 hour) with strict expiration checks
//! - Strict resource binding (a token issued for file A cannot stream file B)
//! - Memory-only storage (invalidated automatically on application restart)
//! - Thread-safe concurrent validation and bounded lazy cleanup
//! - Token values are never logged or persisted

use std::collections::HashMap;
use std::fmt;
use std::sync::RwLock;
use std::time::{Duration, Instant};

/// Default lifetime for a stream token (1 hour). Allows normal media playback,
/// seeking, and range requests without becoming a permanent credential.
pub const DEFAULT_STREAM_TOKEN_TTL: Duration = Duration::from_secs(60 * 60);

/// Maximum number of active tokens in the in-memory store to prevent unbounded
/// memory growth.
const MAX_ACTIVE_TOKENS: usize = 10_000;

#[derive(Debug, PartialEq, Eq)]
pub enum StreamAuthError {
    MissingToken,
    InvalidToken,
    Expired,
    ResourceMismatch,
}

impl fmt::Display for StreamAuthError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::MissingToken => write!(f, "Missing stream token"),
            Self::InvalidToken => write!(f, "Invalid stream token"),
            Self::Expired => write!(f, "Stream token has expired"),
            Self::ResourceMismatch => write!(f, "Stream token not authorized for this resource"),
        }
    }
}

pub struct StreamTokenEntry {
    pub resource_id: String,
    pub issued_at: Instant,
    pub expires_at: Instant,
    pub owner_id: Option<i64>,
}

pub struct StreamTokenManager {
    tokens: RwLock<HashMap<String, StreamTokenEntry>>,
    ttl: Duration,
}

impl fmt::Debug for StreamTokenManager {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("StreamTokenManager")
            .field("active_count", &self.active_count())
            .field("ttl_secs", &self.ttl.as_secs())
            .finish()
    }
}

impl Default for StreamTokenManager {
    fn default() -> Self {
        Self::new()
    }
}

impl StreamTokenManager {
    pub fn new() -> Self {
        Self::new_with_ttl(DEFAULT_STREAM_TOKEN_TTL)
    }

    pub fn new_with_ttl(ttl: Duration) -> Self {
        Self {
            tokens: RwLock::new(HashMap::new()),
            ttl,
        }
    }

    /// Issues a new, cryptographically unpredictable stream capability bound
    /// to the specified resource.
    pub fn issue_token(&self, resource_id: &str, owner_id: Option<i64>) -> String {
        let now = Instant::now();
        self.prune(now);

        // 32 random bytes = 256 bits of entropy from the OS CSPRNG, hex-encoded
        let token = crate::crypto::random::random_bytes(32)
            .iter()
            .map(|b| format!("{:02x}", b))
            .collect::<String>();

        let entry = StreamTokenEntry {
            resource_id: resource_id.to_string(),
            issued_at: now,
            expires_at: now + self.ttl,
            owner_id,
        };

        let mut lock = self.tokens.write().unwrap();
        if lock.len() >= MAX_ACTIVE_TOKENS {
            // Evict expired entries first; if still full, clear to bound memory
            lock.retain(|_, e| now <= e.expires_at);
            if lock.len() >= MAX_ACTIVE_TOKENS {
                lock.clear();
            }
        }
        lock.insert(token.clone(), entry);
        token
    }

    /// Validates a stream token against the requested resource.
    ///
    /// Resource matching:
    /// - Direct match: `entry.resource_id == requested_resource`
    /// - HLS/fMP4 file_key match: `{owner}_{folder}_{msg_id}` matches if the
    ///   message ID portion equals the token's bound resource ID.
    pub fn validate_token(
        &self,
        token: &str,
        requested_resource: &str,
    ) -> Result<(), StreamAuthError> {
        let now = Instant::now();
        let lock = self.tokens.read().unwrap();
        let entry = lock.get(token).ok_or(StreamAuthError::InvalidToken)?;

        if now > entry.expires_at {
            return Err(StreamAuthError::Expired);
        }

        if !self.resource_matches(&entry.resource_id, requested_resource) {
            return Err(StreamAuthError::ResourceMismatch);
        }

        Ok(())
    }

    fn resource_matches(&self, bound: &str, requested: &str) -> bool {
        if bound == requested {
            return true;
        }
        // Match if requested is `{owner}_{folder}_{msg_id}` and bound is `{msg_id}`
        if let Some((_, msg_id)) = requested.rsplit_once('_') {
            if bound == msg_id {
                return true;
            }
        }
        // Match if bound is `{owner}_{folder}_{msg_id}` and requested is `{msg_id}`
        if let Some((_, msg_id)) = bound.rsplit_once('_') {
            if requested == msg_id {
                return true;
            }
        }
        false
    }

    pub fn revoke_all(&self) {
        let mut lock = self.tokens.write().unwrap();
        lock.clear();
    }

    fn prune(&self, now: Instant) {
        if let Ok(mut lock) = self.tokens.try_write() {
            lock.retain(|_, entry| now <= entry.expires_at);
        }
    }

    pub fn active_count(&self) -> usize {
        self.tokens.read().unwrap().len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn valid_token_authenticates_for_bound_resource() {
        let manager = StreamTokenManager::new();
        let token = manager.issue_token("42", None);
        assert_eq!(manager.validate_token(&token, "42"), Ok(()));
    }

    #[test]
    fn missing_or_random_token_is_rejected() {
        let manager = StreamTokenManager::new();
        assert_eq!(
            manager.validate_token("nonexistent-token", "42"),
            Err(StreamAuthError::InvalidToken)
        );
    }

    #[test]
    fn token_for_resource_a_cannot_access_resource_b() {
        let manager = StreamTokenManager::new();
        let token_a = manager.issue_token("42", None);
        // Correct resource succeeds
        assert_eq!(manager.validate_token(&token_a, "42"), Ok(()));
        // Different resource fails
        assert_eq!(
            manager.validate_token(&token_a, "99"),
            Err(StreamAuthError::ResourceMismatch)
        );
    }

    #[test]
    fn hls_file_key_matches_bound_message_id() {
        let manager = StreamTokenManager::new();
        let token = manager.issue_token("42", None);
        // HLS file key format: {owner}_{folder}_{message_id}
        assert_eq!(manager.validate_token(&token, "100_0_42"), Ok(()));
        // Mismatched message ID fails
        assert_eq!(
            manager.validate_token(&token, "100_0_99"),
            Err(StreamAuthError::ResourceMismatch)
        );
    }

    #[test]
    fn expired_token_is_rejected() {
        // Create manager with 10ms TTL
        let manager = StreamTokenManager::new_with_ttl(Duration::from_millis(10));
        let token = manager.issue_token("42", None);
        assert_eq!(manager.validate_token(&token, "42"), Ok(()));

        std::thread::sleep(Duration::from_millis(25));
        assert_eq!(
            manager.validate_token(&token, "42"),
            Err(StreamAuthError::Expired)
        );
    }

    #[test]
    fn token_replay_within_ttl_succeeds_for_same_resource() {
        let manager = StreamTokenManager::new();
        let token = manager.issue_token("42", None);
        // Multiple requests (e.g. range requests or HLS segments) succeed
        assert_eq!(manager.validate_token(&token, "42"), Ok(()));
        assert_eq!(manager.validate_token(&token, "42"), Ok(()));
        assert_eq!(manager.validate_token(&token, "100_0_42"), Ok(()));
    }

    #[test]
    fn restart_invalidates_memory_only_tokens() {
        let first_manager = StreamTokenManager::new();
        let token = first_manager.issue_token("42", None);
        assert_eq!(first_manager.validate_token(&token, "42"), Ok(()));

        // Simulate application restart with new manager instance
        let second_manager = StreamTokenManager::new();
        assert_eq!(
            second_manager.validate_token(&token, "42"),
            Err(StreamAuthError::InvalidToken)
        );
    }

    #[test]
    fn revoke_all_clears_all_active_tokens() {
        let manager = StreamTokenManager::new();
        let token1 = manager.issue_token("42", None);
        let token2 = manager.issue_token("43", None);
        assert_eq!(manager.active_count(), 2);

        manager.revoke_all();
        assert_eq!(manager.active_count(), 0);
        assert_eq!(
            manager.validate_token(&token1, "42"),
            Err(StreamAuthError::InvalidToken)
        );
        assert_eq!(
            manager.validate_token(&token2, "43"),
            Err(StreamAuthError::InvalidToken)
        );
    }

    #[test]
    fn tokens_have_high_entropy_and_are_not_logged() {
        let manager = StreamTokenManager::new();
        let token1 = manager.issue_token("42", None);
        let token2 = manager.issue_token("42", None);

        // 32 bytes hex = 64 characters
        assert_eq!(token1.len(), 64);
        assert_eq!(token2.len(), 64);
        assert_ne!(token1, token2);

        // Debug output must not contain token values
        let debug_str = format!("{:?}", manager);
        assert!(!debug_str.contains(&token1));
        assert!(!debug_str.contains(&token2));
    }

    #[test]
    fn concurrent_validation_is_safe() {
        use std::sync::Arc;
        let manager = Arc::new(StreamTokenManager::new());
        let token = manager.issue_token("42", None);

        let mut handles = vec![];
        for i in 0..20 {
            let m = manager.clone();
            let t = token.clone();
            handles.push(std::thread::spawn(move || {
                if i % 2 == 0 {
                    assert_eq!(m.validate_token(&t, "42"), Ok(()));
                } else {
                    assert_eq!(m.validate_token(&t, "99"), Err(StreamAuthError::ResourceMismatch));
                }
            }));
        }
        for h in handles {
            h.join().unwrap();
        }
    }

    #[test]
    fn cross_endpoint_reuse_is_rejected() {
        let manager = StreamTokenManager::new();
        let stream_token = manager.issue_token("42", None);

        // Attempt to use stream token as WebDAV token against a real hash
        let webdav_hash = "97019edd94f27971f9253dce908be0578253e4bec41bf26344a558ea35e74666";
        assert!(!crate::commands::webdav_settings::verify_token(&stream_token, webdav_hash));

        // Attempt to use stream token as REST API key
        let api_key_hash = "97019edd94f27971f9253dce908be0578253e4bec41bf26344a558ea35e74666";
        assert!(!crate::commands::api_settings::verify_key(&stream_token, api_key_hash));
    }
}
