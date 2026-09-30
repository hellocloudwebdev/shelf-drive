use base64::{prelude::BASE64_STANDARD, Engine};
use constant_time_eq::constant_time_eq;
use std::fmt;
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::task::JoinHandle;

use crate::crypto::random::random_bytes;

pub trait AsyncReadWrite: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin + Send {}
impl<T: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin + Send> AsyncReadWrite for T {}

type BoxedStream = Box<dyn AsyncReadWrite>;

/// Fixed, non-secret identity presented during RFC 1929 authentication. The
/// secret is the per-launch password; the username only has to match.
const BRIDGE_USERNAME: &str = "shelf-drive-bridge";

/// Per-launch credentials for the local SOCKS5 bridge. Generated with the OS
/// CSPRNG when the bridge starts, held in memory only, never persisted,
/// never returned to the frontend, and never logged.
pub struct BridgeCredentials {
    pub username: String,
    pub password: String,
}

impl fmt::Debug for BridgeCredentials {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("BridgeCredentials")
            .field("username", &"[REDACTED]")
            .field("password", &"[REDACTED]")
            .finish()
    }
}

/// A running bridge: loopback listener, credentials, and the accept-loop task.
pub struct RunningBridge {
    pub local_addr: SocketAddr,
    pub credentials: BridgeCredentials,
    pub handle: JoinHandle<()>,
}

impl fmt::Debug for RunningBridge {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("RunningBridge")
            .field("local_addr", &self.local_addr)
            .field("credentials", &"[REDACTED]")
            .finish()
    }
}

fn generate_bridge_password() -> String {
    // 32 CSPRNG bytes = 256 bits of entropy, hex-encoded (64 chars).
    random_bytes(32)
        .iter()
        .map(|byte| format!("{:02x}", byte))
        .collect()
}

/// Starts a local SOCKS5 bridge on a random loopback port.
///
/// The bridge requires RFC 1929 username/password authentication before any
/// request is accepted; the credentials are generated here and returned to the
/// in-process caller so the Telegram client can authenticate. No other local
/// process can proxy through this listener without the credential.
pub async fn start_bridge(
    upstream_host: String,
    upstream_port: u16,
    upstream_scheme: String,
    upstream_username: String,
    upstream_password: String,
) -> Result<RunningBridge, String> {
    // Bind to a random port on IPv4 loopback only. The intended client is the
    // in-process Telegram client, so no wider interface or IPv6 bind is needed.
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| format!("Failed to bind local SOCKS5 bridge: {}", e))?;

    let local_addr = listener
        .local_addr()
        .map_err(|e| format!("Failed to get local address: {}", e))?;

    let credentials = BridgeCredentials {
        username: BRIDGE_USERNAME.to_string(),
        password: generate_bridge_password(),
    };
    let credentials_for_tasks = BridgeCredentials {
        username: credentials.username.clone(),
        password: credentials.password.clone(),
    };

    let upstream_host = Arc::new(upstream_host);
    let upstream_scheme = Arc::new(upstream_scheme);
    let upstream_username = Arc::new(upstream_username);
    let upstream_password = Arc::new(upstream_password);

    log::info!(
        "SOCKS5 bridge listening on {} tunneling to {}://{}:{} (authenticated)",
        local_addr,
        upstream_scheme,
        upstream_host,
        upstream_port
    );

    let credentials_for_tasks = Arc::new(credentials_for_tasks);
    let handle = tokio::spawn(async move {
        loop {
            match listener.accept().await {
                Ok((client_stream, client_addr)) => {
                    let upstream_host = upstream_host.clone();
                    let upstream_scheme = upstream_scheme.clone();
                    let upstream_username = upstream_username.clone();
                    let upstream_password = upstream_password.clone();
                    let credentials = credentials_for_tasks.clone();

                    tokio::spawn(async move {
                        // Bound the unauthenticated handshake so a local
                        // process cannot park bridge tasks indefinitely.
                        let handshake = tokio::time::timeout(
                            HANDSHAKE_TIMEOUT,
                            authenticate_client(client_stream, &credentials),
                        )
                        .await;
                        let (client_stream, target_host, target_port) = match handshake {
                            Ok(Ok(result)) => result,
                            Ok(Err(e)) => {
                                log::debug!("Bridge connection error for {}: {}", client_addr, e);
                                return;
                            }
                            Err(_) => {
                                log::debug!("Bridge handshake timed out for {}", client_addr);
                                return;
                            }
                        };
                        if let Err(e) = connect_and_relay(
                            client_stream,
                            &upstream_host,
                            upstream_port,
                            &upstream_scheme,
                            &upstream_username,
                            &upstream_password,
                            target_host,
                            target_port,
                        )
                        .await
                        {
                            log::debug!("Bridge connection error for {}: {}", client_addr, e);
                        }
                    });
                }
                Err(e) => {
                    log::error!("SOCKS5 bridge accept error: {}", e);
                    break;
                }
            }
        }
    });

    Ok(RunningBridge {
        local_addr,
        credentials,
        handle,
    })
}

/// Domains are relayed verbatim into an HTTP CONNECT request line for the
/// upstream proxy. Only characters that can legally appear in a DNS name are
/// accepted so a malicious client cannot inject CR/LF headers (which could
/// smuggle or override the injected Proxy-Authorization header).
fn is_valid_destination_host(host: &str) -> bool {
    !host.is_empty()
        && host.len() <= 253
        && host.bytes().all(|byte| {
            byte.is_ascii_alphanumeric() || byte == b'.' || byte == b'-' || byte == b'_'
        })
}

/// Sends a failure reply and closes the session gracefully. Dropping the
/// socket while the client still has bytes in flight would emit a TCP RST
/// that discards the queued reply, so after the write we shut down the write
/// side (FIN) and drain in-flight client bytes (bounded by timeout) before
/// the socket is dropped.
async fn reject_and_close(mut client_stream: TcpStream, reply: &[u8]) {
    client_stream.write_all(reply).await.ok();
    client_stream.flush().await.ok();
    let _ = client_stream.shutdown().await;
    let _ = tokio::time::timeout(std::time::Duration::from_millis(500), async {
        let mut discard = [0u8; 512];
        loop {
            match client_stream.read(&mut discard).await {
                Ok(0) | Err(_) => break,
                Ok(_) => {}
            }
        }
    })
    .await;
}

/// Bound for the unauthenticated handshake. A local process that opens
/// connections without ever completing authentication cannot park bridge
/// tasks indefinitely.
const HANDSHAKE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(30);

/// Performs the SOCKS5 greeting, method negotiation, RFC 1929 authentication,
/// and request parsing. On success returns the client stream plus the
/// destination; every failure path sends the appropriate SOCKS5 error reply
/// (fail closed) and consumes the stream.
async fn authenticate_client(
    mut client_stream: TcpStream,
    credentials: &BridgeCredentials,
) -> Result<(TcpStream, String, u16), String> {
    // 1. SOCKS5 greeting
    let mut greeting = [0u8; 2];
    client_stream
        .read_exact(&mut greeting)
        .await
        .map_err(|e| format!("Failed reading greeting: {}", e))?;

    if greeting[0] != 0x05 {
        return Err(format!("Unsupported SOCKS version: {}", greeting[0]));
    }

    let num_methods = greeting[1] as usize;
    let mut methods = vec![0u8; num_methods];
    client_stream
        .read_exact(&mut methods)
        .await
        .map_err(|e| format!("Failed reading methods: {}", e))?;

    // Only RFC 1929 username/password (0x02) is accepted. NO-AUTH (0x00) and
    // GSSAPI are rejected before any request byte is read, so an
    // unauthenticated client can never reach CONNECT/BIND/UDP ASSOCIATE.
    if !methods.contains(&0x02) {
        // No acceptable methods
        reject_and_close(client_stream, &[0x05, 0xff]).await;
        return Err("Client did not offer username/password authentication".into());
    }

    client_stream
        .write_all(&[0x05, 0x02])
        .await
        .map_err(|e| format!("Failed writing auth selection: {}", e))?;

    // 2. RFC 1929 username/password sub-negotiation (VER 0x01)
    let mut auth_ver = [0u8; 1];
    client_stream
        .read_exact(&mut auth_ver)
        .await
        .map_err(|e| format!("Failed reading auth version: {}", e))?;
    if auth_ver[0] != 0x01 {
        return Err(format!(
            "Unsupported auth sub-negotiation version: {}",
            auth_ver[0]
        ));
    }

    let mut user_len = [0u8; 1];
    client_stream
        .read_exact(&mut user_len)
        .await
        .map_err(|e| format!("Failed reading username length: {}", e))?;
    let mut username = vec![0u8; user_len[0] as usize];
    client_stream
        .read_exact(&mut username)
        .await
        .map_err(|e| format!("Failed reading username: {}", e))?;

    let mut pass_len = [0u8; 1];
    client_stream
        .read_exact(&mut pass_len)
        .await
        .map_err(|e| format!("Failed reading password length: {}", e))?;
    let mut password = vec![0u8; pass_len[0] as usize];
    client_stream
        .read_exact(&mut password)
        .await
        .map_err(|e| format!("Failed reading password: {}", e))?;

    let username_ok = constant_time_eq(username.as_slice(), credentials.username.as_bytes());
    let password_ok = constant_time_eq(password.as_slice(), credentials.password.as_bytes());

    if !(username_ok && password_ok) {
        // Fail closed: protocol failure status, then terminate the session.
        reject_and_close(client_stream, &[0x01, 0x01]).await;
        return Err("SOCKS5 authentication failed".into());
    }

    client_stream
        .write_all(&[0x01, 0x00])
        .await
        .map_err(|e| format!("Failed writing auth success: {}", e))?;

    // 3. SOCKS5 Request
    let mut req_header = [0u8; 4];
    client_stream
        .read_exact(&mut req_header)
        .await
        .map_err(|e| format!("Failed reading request header: {}", e))?;

    if req_header[0] != 0x05 {
        return Err("Invalid SOCKS version in request".into());
    }

    if req_header[1] != 0x01 {
        // We only support CONNECT (0x01). BIND and UDP ASSOCIATE are rejected
        // after (and never before) authentication; neither has an upstream path.
        reject_and_close(client_stream, &[0x05, 0x07, 0x00, 0x01, 0, 0, 0, 0, 0, 0]).await;
        return Err(format!("Unsupported SOCKS command: {}", req_header[1]));
    }

    // Parse target address
    let target_host = match req_header[3] {
        0x01 => {
            // IPv4
            let mut ip = [0u8; 4];
            client_stream
                .read_exact(&mut ip)
                .await
                .map_err(|e| format!("Failed reading IPv4: {}", e))?;
            format!("{}.{}.{}.{}", ip[0], ip[1], ip[2], ip[3])
        }
        0x03 => {
            // Domain
            let mut len_buf = [0u8; 1];
            client_stream
                .read_exact(&mut len_buf)
                .await
                .map_err(|e| format!("Failed reading domain length: {}", e))?;
            let len = len_buf[0] as usize;
            let mut domain = vec![0u8; len];
            client_stream
                .read_exact(&mut domain)
                .await
                .map_err(|e| format!("Failed reading domain name: {}", e))?;
            let domain =
                String::from_utf8(domain).map_err(|e| format!("Invalid domain UTF-8: {}", e))?;
            if !is_valid_destination_host(&domain) {
                reject_and_close(client_stream, &[0x05, 0x08, 0x00, 0x01, 0, 0, 0, 0, 0, 0]).await;
                return Err("Invalid characters in SOCKS5 destination host".into());
            }
            domain
        }
        0x04 => {
            // IPv6
            let mut ip = [0u8; 16];
            client_stream
                .read_exact(&mut ip)
                .await
                .map_err(|e| format!("Failed reading IPv6: {}", e))?;
            // Format IPv6 cleanly
            let mut parts = vec![];
            for chunk in ip.chunks(2) {
                parts.push(format!("{:x}", u16::from_be_bytes([chunk[0], chunk[1]])));
            }
            format!("[{}]", parts.join(":"))
        }
        _ => {
            reject_and_close(client_stream, &[0x05, 0x08, 0x00, 0x01, 0, 0, 0, 0, 0, 0]).await;
            return Err(format!("Unsupported SOCKS address type: {}", req_header[3]));
        }
    };

    let mut port_buf = [0u8; 2];
    client_stream
        .read_exact(&mut port_buf)
        .await
        .map_err(|e| format!("Failed reading target port: {}", e))?;
    let target_port = u16::from_be_bytes(port_buf);

    log::debug!(
        "Authenticated client requesting connection to {}:{}",
        target_host,
        target_port
    );

    Ok((client_stream, target_host, target_port))
}

/// Connects to the upstream HTTP/HTTPS proxy and relays the authenticated
/// client's traffic. Runs only after `authenticate_client` succeeded.
async fn connect_and_relay(
    mut client_stream: TcpStream,
    upstream_host: &str,
    upstream_port: u16,
    upstream_scheme: &str,
    upstream_username: &str,
    upstream_password: &str,
    target_host: String,
    target_port: u16,
) -> Result<(), String> {
    let upstream_stream = TcpStream::connect((upstream_host, upstream_port))
        .await
        .map_err(|e| format!("Failed to connect to upstream proxy: {}", e))?;

    let mut upstream_boxed: BoxedStream = if upstream_scheme == "https" {
        // HTTPS connection to the proxy: wrap in rustls
        let mut root_store = rustls::RootCertStore::empty();
        root_store.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());

        let config = rustls::ClientConfig::builder()
            .with_root_certificates(root_store)
            .with_no_client_auth();

        let connector = tokio_rustls::TlsConnector::from(Arc::new(config));
        let server_name = rustls::pki_types::ServerName::try_from(upstream_host.to_string())
            .map_err(|e| format!("Invalid DNS name: {}", e))?
            .to_owned();

        let tls_stream = connector
            .connect(server_name, upstream_stream)
            .await
            .map_err(|e| format!("TLS handshake with upstream proxy failed: {}", e))?;

        Box::new(tls_stream)
    } else {
        Box::new(upstream_stream)
    };

    // 5. Send HTTP CONNECT request
    let mut connect_req = format!(
        "CONNECT {}:{} HTTP/1.1\r\nHost: {}:{}\r\nProxy-Connection: Keep-Alive\r\n",
        target_host, target_port, target_host, target_port
    );

    if !upstream_username.is_empty() {
        let auth = format!("{}:{}", upstream_username, upstream_password);
        let encoded = BASE64_STANDARD.encode(auth);
        connect_req.push_str(&format!("Proxy-Authorization: Basic {}\r\n", encoded));
    }
    connect_req.push_str("\r\n");

    upstream_boxed
        .write_all(connect_req.as_bytes())
        .await
        .map_err(|e| format!("Failed to send CONNECT request: {}", e))?;
    upstream_boxed
        .flush()
        .await
        .map_err(|e| format!("Failed to flush CONNECT request: {}", e))?;

    // Read response until \r\n\r\n
    let mut response_headers = Vec::new();
    let mut buf = [0u8; 1];
    loop {
        upstream_boxed
            .read_exact(&mut buf)
            .await
            .map_err(|e| format!("Error reading CONNECT response: {}", e))?;
        response_headers.push(buf[0]);
        if response_headers.ends_with(b"\r\n\r\n") {
            break;
        }
        if response_headers.len() > 8192 {
            return Err("Proxy CONNECT response headers too long".into());
        }
    }

    let response_str = String::from_utf8_lossy(&response_headers);
    if !response_str.starts_with("HTTP/1.1 200") && !response_str.starts_with("HTTP/1.0 200") {
        let status = response_str.lines().next().unwrap_or("Unknown status");
        reject_and_close(client_stream, &[0x05, 0x05, 0x00, 0x01, 0, 0, 0, 0, 0, 0]).await;
        return Err(format!("Proxy connection rejected: {}", status));
    }

    // 6. Send SOCKS5 success reply to client
    client_stream
        .write_all(&[0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0])
        .await
        .map_err(|e| format!("Failed to send SOCKS5 success reply: {}", e))?;
    client_stream
        .flush()
        .await
        .map_err(|e| format!("Failed to flush client stream: {}", e))?;

    // 7. Relay traffic bidirectionally
    let (mut client_read, mut client_write) = tokio::io::split(client_stream);
    let (mut upstream_read, mut upstream_write) = tokio::io::split(upstream_boxed);

    let client_to_upstream = tokio::io::copy(&mut client_read, &mut upstream_write);
    let upstream_to_client = tokio::io::copy(&mut upstream_read, &mut client_write);

    tokio::select! {
        res = client_to_upstream => { res.map_err(|e| format!("Relay client to upstream error: {}", e))?; }
        res = upstream_to_client => { res.map_err(|e| format!("Relay upstream to client error: {}", e))?; }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex as StdMutex;

    /// A minimal upstream HTTP CONNECT proxy that records each request and
    /// echoes subsequent bytes, so tests can prove whether the bridge ever
    /// reached the upstream (i.e., whether an outbound connection happened).
    async fn spawn_mock_upstream() -> (SocketAddr, Arc<StdMutex<Vec<String>>>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let requests: Arc<StdMutex<Vec<String>>> = Arc::new(StdMutex::new(Vec::new()));
        let requests_for_tasks = requests.clone();

        tokio::spawn(async move {
            loop {
                let Ok((mut stream, _)) = listener.accept().await else {
                    break;
                };
                let requests_for_task = requests_for_tasks.clone();
                tokio::spawn(async move {
                    let mut collected = Vec::new();
                    let mut byte = [0u8; 1];
                    loop {
                        if stream.read_exact(&mut byte).await.is_err() {
                            return;
                        }
                        collected.push(byte[0]);
                        if collected.ends_with(b"\r\n\r\n") || collected.len() > 8192 {
                            break;
                        }
                    }
                    requests_for_task
                        .lock()
                        .unwrap()
                        .push(String::from_utf8_lossy(&collected).to_string());
                    stream
                        .write_all(b"HTTP/1.1 200 Connection established\r\n\r\n")
                        .await
                        .ok();
                    let (mut read_half, mut write_half) = tokio::io::split(stream);
                    let _ = tokio::io::copy(&mut read_half, &mut write_half).await;
                });
            }
        });

        (addr, requests)
    }

    async fn start_test_bridge() -> (RunningBridge, Arc<StdMutex<Vec<String>>>) {
        let (upstream_addr, requests) = spawn_mock_upstream().await;
        let bridge = start_bridge(
            upstream_addr.ip().to_string(),
            upstream_addr.port(),
            "http".to_string(),
            "upstream-user".to_string(),
            "upstream-pass".to_string(),
        )
        .await
        .unwrap();
        (bridge, requests)
    }

    async fn assert_no_upstream_traffic(requests: &Arc<StdMutex<Vec<String>>>) {
        // Yield the runtime so any (incorrect) spawned outbound work would
        // actually run before we assert the upstream saw nothing.
        tokio::time::sleep(std::time::Duration::from_millis(120)).await;
        assert!(
            requests.lock().unwrap().is_empty(),
            "upstream proxy must not receive any connection"
        );
    }

    /// Performs the method negotiation offering ONLY username/password, sends
    /// the RFC 1929 credentials, and returns the server's two replies.
    async fn negotiate(
        stream: &mut TcpStream,
        username: &[u8],
        password: &[u8],
    ) -> Result<(u8, u8), std::io::Error> {
        stream.write_all(&[0x05, 0x01, 0x02]).await?;
        let mut method_reply = [0u8; 2];
        stream.read_exact(&mut method_reply).await?;
        stream.write_all(&[0x01, username.len() as u8]).await?;
        stream.write_all(username).await?;
        stream.write_all(&[password.len() as u8]).await?;
        stream.write_all(password).await?;
        let mut auth_reply = [0u8; 2];
        stream.read_exact(&mut auth_reply).await?;
        Ok((method_reply[1], auth_reply[1]))
    }

    async fn expect_closed(client_stream: &mut TcpStream) {
        let mut eof_probe = [0u8; 1];
        match tokio::time::timeout(
            std::time::Duration::from_millis(2000),
            client_stream.read(&mut eof_probe),
        )
        .await
        {
            Ok(Ok(0)) => {}
            Ok(Err(_)) => {}
            Ok(Ok(n)) => panic!("expected session close, got {} byte(s)", n),
            Err(_) => panic!("expected the server to close the session, but it stayed open"),
        }
    }

    #[tokio::test]
    async fn no_auth_method_is_rejected_before_any_upstream_connection() {
        let (bridge, requests) = start_test_bridge().await;
        let mut client_stream = TcpStream::connect(bridge.local_addr).await.unwrap();
        client_stream.write_all(&[0x05, 0x01, 0x00]).await.unwrap();
        let mut method_reply = [0u8; 2];
        client_stream.read_exact(&mut method_reply).await.unwrap();
        assert_eq!(method_reply, [0x05, 0xff]);
        expect_closed(&mut client_stream).await;
        assert_no_upstream_traffic(&requests).await;
    }

    #[tokio::test]
    async fn wrong_password_is_rejected_and_session_closes() {
        let (bridge, requests) = start_test_bridge().await;
        let mut client_stream = TcpStream::connect(bridge.local_addr).await.unwrap();
        let (method, auth) = negotiate(
            &mut client_stream,
            bridge.credentials.username.as_bytes(),
            b"wrong-password",
        )
        .await
        .unwrap();
        assert_eq!(method, 0x02);
        assert_eq!(auth, 0x01);
        expect_closed(&mut client_stream).await;
        assert_no_upstream_traffic(&requests).await;
    }

    #[tokio::test]
    async fn wrong_username_is_rejected_and_session_closes() {
        let (bridge, requests) = start_test_bridge().await;
        let mut client_stream = TcpStream::connect(bridge.local_addr).await.unwrap();
        let (_, auth) = negotiate(
            &mut client_stream,
            b"not-the-bridge-user",
            bridge.credentials.password.as_bytes(),
        )
        .await
        .unwrap();
        assert_eq!(auth, 0x01);
        expect_closed(&mut client_stream).await;
        assert_no_upstream_traffic(&requests).await;
    }

    #[tokio::test]
    async fn malformed_auth_subnegotiation_fails_closed() {
        let (bridge, requests) = start_test_bridge().await;
        let mut client_stream = TcpStream::connect(bridge.local_addr).await.unwrap();
        client_stream.write_all(&[0x05, 0x01, 0x02]).await.unwrap();
        let mut method_reply = [0u8; 2];
        client_stream.read_exact(&mut method_reply).await.unwrap();
        assert_eq!(method_reply, [0x05, 0x02]);
        // Wrong sub-negotiation version: fail closed.
        client_stream.write_all(&[0x02, 0x00]).await.unwrap();
        expect_closed(&mut client_stream).await;
        assert_no_upstream_traffic(&requests).await;
    }

    #[tokio::test]
    async fn connect_request_without_authentication_is_rejected() {
        let (bridge, requests) = start_test_bridge().await;
        let mut client_stream = TcpStream::connect(bridge.local_addr).await.unwrap();
        // Raw CONNECT bytes sent immediately: parses as a method negotiation
        // that only offers NO-AUTH, which must be rejected before the request
        // is ever parsed.
        client_stream
            .write_all(&[0x05, 0x01, 0x00, 0x01, 0x7f, 0x00, 0x00, 0x01, 0x00, 0x50])
            .await
            .unwrap();
        let mut method_reply = [0u8; 2];
        client_stream.read_exact(&mut method_reply).await.unwrap();
        assert_eq!(method_reply, [0x05, 0xff]);
        expect_closed(&mut client_stream).await;
        assert_no_upstream_traffic(&requests).await;
    }

    #[tokio::test]
    async fn valid_credentials_allow_domain_connect_and_relay() {
        let (bridge, requests) = start_test_bridge().await;
        let mut client_stream = TcpStream::connect(bridge.local_addr).await.unwrap();
        let (method, auth) = negotiate(
            &mut client_stream,
            bridge.credentials.username.as_bytes(),
            bridge.credentials.password.as_bytes(),
        )
        .await
        .unwrap();
        assert_eq!(method, 0x02);
        assert_eq!(auth, 0x00);

        let domain = b"example.test";
        client_stream
            .write_all(&[0x05, 0x01, 0x00, 0x03, domain.len() as u8])
            .await
            .unwrap();
        client_stream.write_all(domain).await.unwrap();
        client_stream.write_all(&80u16.to_be_bytes()).await.unwrap();

        let mut connect_reply = [0u8; 10];
        client_stream.read_exact(&mut connect_reply).await.unwrap();
        assert_eq!(connect_reply[1], 0x00);

        client_stream.write_all(b"ping").await.unwrap();
        let mut echoed = [0u8; 4];
        client_stream.read_exact(&mut echoed).await.unwrap();
        assert_eq!(&echoed, b"ping");

        let recorded = requests.lock().unwrap().join("\n---\n");
        assert!(recorded.contains("CONNECT example.test:80 HTTP/1.1"));
        assert!(recorded.contains("Proxy-Authorization: Basic"));
    }

    #[tokio::test]
    async fn ipv4_destination_relays_after_authentication() {
        let (bridge, requests) = start_test_bridge().await;
        let mut client_stream = TcpStream::connect(bridge.local_addr).await.unwrap();
        negotiate(
            &mut client_stream,
            bridge.credentials.username.as_bytes(),
            bridge.credentials.password.as_bytes(),
        )
        .await
        .unwrap();
        client_stream
            .write_all(&[0x05, 0x01, 0x00, 0x01, 93, 184, 216, 34])
            .await
            .unwrap();
        client_stream
            .write_all(&443u16.to_be_bytes())
            .await
            .unwrap();
        let mut connect_reply = [0u8; 10];
        client_stream.read_exact(&mut connect_reply).await.unwrap();
        assert_eq!(connect_reply[1], 0x00);
        let recorded = requests.lock().unwrap().join("\n---\n");
        assert!(recorded.contains("CONNECT 93.184.216.34:443 HTTP/1.1"));
    }

    #[tokio::test]
    async fn ipv6_destination_relays_after_authentication() {
        let (bridge, requests) = start_test_bridge().await;
        let mut client_stream = TcpStream::connect(bridge.local_addr).await.unwrap();
        negotiate(
            &mut client_stream,
            bridge.credentials.username.as_bytes(),
            bridge.credentials.password.as_bytes(),
        )
        .await
        .unwrap();
        let mut ipv6 = [0u8; 16];
        ipv6[0] = 0x20;
        ipv6[1] = 0x01;
        ipv6[2] = 0x0d;
        ipv6[3] = 0xb8;
        ipv6[15] = 0x01;
        client_stream
            .write_all(&[0x05, 0x01, 0x00, 0x04])
            .await
            .unwrap();
        client_stream.write_all(&ipv6).await.unwrap();
        client_stream
            .write_all(&443u16.to_be_bytes())
            .await
            .unwrap();
        let mut connect_reply = [0u8; 10];
        client_stream.read_exact(&mut connect_reply).await.unwrap();
        assert_eq!(connect_reply[1], 0x00);
        let recorded = requests.lock().unwrap().join("\n---\n");
        assert!(recorded.contains("CONNECT [2001:db8:0:0:0:0:0:1]:443 HTTP/1.1"));
    }

    #[tokio::test]
    async fn bind_and_udp_associate_cannot_bypass_authentication() {
        let (bridge, requests) = start_test_bridge().await;

        for command in [0x02u8, 0x03u8] {
            let mut client_stream = TcpStream::connect(bridge.local_addr).await.unwrap();
            negotiate(
                &mut client_stream,
                bridge.credentials.username.as_bytes(),
                bridge.credentials.password.as_bytes(),
            )
            .await
            .unwrap();
            // Even authenticated, BIND/UDP ASSOCIATE have no upstream path.
            client_stream
                .write_all(&[0x05, command, 0x00, 0x01, 0, 0, 0, 0, 0, 0])
                .await
                .unwrap();
            let mut reply = [0u8; 10];
            client_stream.read_exact(&mut reply).await.unwrap();
            assert_eq!(reply[1], 0x07);
            expect_closed(&mut client_stream).await;
        }
        assert_no_upstream_traffic(&requests).await;
    }

    #[tokio::test]
    async fn destination_host_with_injected_headers_is_rejected() {
        let (bridge, requests) = start_test_bridge().await;
        let mut client_stream = TcpStream::connect(bridge.local_addr).await.unwrap();
        negotiate(
            &mut client_stream,
            bridge.credentials.username.as_bytes(),
            bridge.credentials.password.as_bytes(),
        )
        .await
        .unwrap();
        let hostile_domain = b"evil.test\r\nX-Injected: 1";
        client_stream
            .write_all(&[0x05, 0x01, 0x00, 0x03, hostile_domain.len() as u8])
            .await
            .unwrap();
        client_stream.write_all(hostile_domain).await.unwrap();
        client_stream.write_all(&80u16.to_be_bytes()).await.unwrap();
        let mut reply = [0u8; 10];
        client_stream.read_exact(&mut reply).await.unwrap();
        assert_eq!(reply[1], 0x08);
        expect_closed(&mut client_stream).await;
        assert_no_upstream_traffic(&requests).await;
    }

    #[tokio::test]
    async fn listener_is_loopback_only() {
        let (bridge, _requests) = start_test_bridge().await;
        assert!(bridge.local_addr.ip().is_loopback());
        assert_eq!(
            bridge.local_addr.ip(),
            std::net::IpAddr::from([127, 0, 0, 1])
        );
    }

    #[tokio::test]
    async fn credentials_are_generated_and_not_hard_coded() {
        let (first, _) = start_test_bridge().await;
        let (second, _) = start_test_bridge().await;
        assert_eq!(first.credentials.username, "shelf-drive-bridge");
        assert_eq!(first.credentials.password.len(), 64);
        assert!(first
            .credentials
            .password
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit()));
        assert_ne!(first.credentials.password, second.credentials.password);
        // The credential must never round-trip through Debug output.
        let debugged = format!("{:?}", first);
        assert!(!debugged.contains(&first.credentials.password));
        assert!(!debugged.contains(&first.credentials.username));
    }
}
