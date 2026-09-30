use std::sync::Arc;
use tauri::State;

/// Holds the streaming config (token manager + port)
pub struct StreamConfig {
    pub manager: Arc<crate::stream_token::StreamTokenManager>,
    pub port: u16,
}

/// Returned to the frontend so it can construct stream URLs dynamically
#[derive(serde::Serialize)]
pub struct StreamInfo {
    pub token: String,
    pub base_url: String,
    /// Decimal string preserves the full opaque u64 across JavaScript's
    /// 53-bit integer boundary.
    pub operation_token: Option<String>,
}

/// Returns the streaming server's base URL and a short-lived, resource-scoped
/// capability token to the frontend.
#[tauri::command]
pub fn cmd_get_stream_info(
    file_id: Option<i64>,
    _folder_id: Option<String>,
    config: State<'_, StreamConfig>,
    crypto_state: State<'_, crate::crypto::state::CryptoState>,
) -> StreamInfo {
    let host = "localhost";
    let operation_token = crypto_state
        .current_session()
        .and_then(|session| {
            crypto_state
                .create_operation_handle(session, crate::crypto::state::OperationClass::MediaStream)
                .ok()
        })
        .map(|handle| handle.to_string());

    let resource_id = file_id
        .map(|id| id.to_string())
        .unwrap_or_else(|| "default".to_string());
    let token = config.manager.issue_token(&resource_id, None);

    StreamInfo {
        token,
        base_url: format!("http://{}:{}", host, config.port),
        operation_token,
    }
}
