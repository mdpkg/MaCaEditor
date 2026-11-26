use super::{config::{AiConfig, validate_config}, error::AiError, types::{AiMessage, AiRole}};

#[derive(Debug, Clone, serde::Serialize)]
pub struct ChatConnection { pub revision: String, pub endpoint: String, pub model: String }
pub fn chat_connection(config: &AiConfig) -> Result<ChatConnection, AiError> {
    validate_config(config).map_err(|_| AiError::InvalidConfiguration("invalid saved connection".into()))?;
    let endpoint = reqwest::Url::parse(config.base_url.trim())
        .map_err(|_| AiError::InvalidConfiguration("invalid saved connection".into()))?.origin().ascii_serialization();
    let revision = super::chacha::connection_revision(config)
        .map_err(|_| AiError::InvalidConfiguration("invalid saved connection".into()))?;
    Ok(ChatConnection { endpoint, revision, model: config.model.clone() })
}
/// Return the same owned snapshot that was validated; never reload it for dispatch.
pub fn accept_connection(config: AiConfig, expected: &str) -> Result<AiConfig, AiError> {
    if chat_connection(&config)?.revision != expected {
        return Err(AiError::InvalidConfiguration("chat_connection_changed".into()));
    }
    Ok(config)
}
pub fn validate_chat_input(filename: &str, history: &[AiMessage], question: &str) -> Result<(), AiError> {
    let invalid = || AiError::InvalidConfiguration("invalid chat input or history limit; start or clear a conversation".into());
    if filename.is_empty() || filename.starts_with('/') || filename.contains(['\\', ':']) ||
        filename.split('/').any(|part| part == ".." || part == "." || part.is_empty()) ||
        question.trim().is_empty() || question.chars().count() > 10000 || history.len() > 198 || history.len() % 2 != 0 {
        return Err(invalid());
    }
    if history.chunks_exact(2).any(|pair| pair[0].role != AiRole::User || pair[1].role != AiRole::Assistant ||
        pair[0].content.chars().count() > 10000 || pair[1].content.len() > 65536) { return Err(invalid()); }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai::config::{AiConfig, AiProviderKind};
    fn config() -> AiConfig { AiConfig::new(AiProviderKind::OpenAiCompatible, "https://user:password@example.test/v1?key=secret".into(), Some("PRIVATE-KEY".into()), "model".into(), None, None, None, None) }
    #[test]
    fn connection_display_omits_credentials_and_binding_rejects_changed_config() {
        let config = config();
        let connection = chat_connection(&config).unwrap();
        assert_eq!(connection.endpoint, "https://example.test");
        assert!(!serde_json::to_string(&connection).unwrap().contains("PRIVATE"));
        assert!(accept_connection(config.clone(), &connection.revision).is_ok());
        let mut changed = config;
        changed.model = "new-model".into();
        assert!(accept_connection(changed, &connection.revision).is_err());
    }
    #[test]
    fn history_requires_completed_pairs_and_question_uses_unicode_count() {
        use crate::ai::types::{AiMessage, AiRole};
        assert!(validate_chat_input("index.md", &[], &"😀".repeat(10000)).is_ok());
        assert!(validate_chat_input("index.md", &[], &"😀".repeat(10001)).is_err());
        assert!(validate_chat_input("index.md", &[AiMessage::new(AiRole::User, "orphan")], "q").is_err());
        assert!(validate_chat_input("C:/private/file.md", &[], "q").is_err());
    }
}
