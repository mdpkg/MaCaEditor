/// AI エラー。
#[derive(Debug, Clone, PartialEq, thiserror::Error, serde::Serialize, serde::Deserialize)]
pub enum AiError {
    #[error("AI configuration is invalid: {0}")]
    InvalidConfiguration(String),
    #[error("connection failed: {0}")]
    ConnectionFailed(String),
    #[error("authentication failed: {0}")]
    AuthenticationFailed(String),
    #[error("permission denied: {0}")]
    PermissionDenied(String),
    #[error("model not found: {0}")]
    ModelNotFound(String),
    #[error("rate limited: {0}")]
    RateLimited(String),
    #[error("request timed out: {0}")]
    Timeout(String),
    #[error("server error: {0}")]
    ServerError(String),
    #[error("invalid response: {0}")]
    InvalidResponse(String),
    #[error("request cancelled")]
    Cancelled,
    #[error("unknown error: {0}")]
    Unknown(String),
}

/// HTTP ステータスから AiError を分類する。
/// 401 / 403 は認証・権限、429 はレート制限、
/// 400 / 404 はモデル・設定、5xx はサーバーエラーとして扱う。
pub fn classify_http_status(status: u16, message: &str) -> AiError {
    match status {
        400 => AiError::InvalidConfiguration(message.to_string()),
        401 => AiError::AuthenticationFailed(message.to_string()),
        403 => AiError::PermissionDenied(message.to_string()),
        404 => AiError::ModelNotFound(message.to_string()),
        429 => AiError::RateLimited(message.to_string()),
        408 => AiError::Timeout(message.to_string()),
        500..=599 => AiError::ServerError(message.to_string()),
        _ => AiError::Unknown(message.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_http_status() {
        assert!(matches!(
            classify_http_status(401, "bad key"),
            AiError::AuthenticationFailed(_)
        ));
        assert!(matches!(
            classify_http_status(403, "denied"),
            AiError::PermissionDenied(_)
        ));
        assert!(matches!(
            classify_http_status(404, "missing"),
            AiError::ModelNotFound(_)
        ));
        assert!(matches!(
            classify_http_status(429, "slow down"),
            AiError::RateLimited(_)
        ));
        assert!(matches!(
            classify_http_status(500, "boom"),
            AiError::ServerError(_)
        ));
        assert!(matches!(
            classify_http_status(400, "bad request"),
            AiError::InvalidConfiguration(_)
        ));
    }
}
