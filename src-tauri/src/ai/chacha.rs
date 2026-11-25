use super::{
    cancel::CancellationRegistry,
    types::{AiRequest, AiRole},
};
use sha2::{Digest, Sha256};
use std::{future::Future, sync::Arc, time::Duration};

static CHACHA_SLOT: tokio::sync::Semaphore = tokio::sync::Semaphore::const_new(1);
pub fn try_enter() -> Result<tokio::sync::SemaphorePermit<'static>, ChachaFailure> {
    CHACHA_SLOT
        .try_acquire()
        .map_err(|_| ChachaFailure::new("busy"))
}
pub fn connection_revision(config: &super::config::AiConfig) -> Result<String, ChachaFailure> {
    let bytes = serde_json::to_vec(config).map_err(|_| ChachaFailure::new("connection"))?;
    Ok(format!("{:x}", Sha256::digest(bytes)))
}

#[derive(serde::Serialize)]
pub struct ChachaConnection {
    pub endpoint: String,
    pub model: String,
    pub revision: String,
}

/// Deliberately carries no server body, URL, key, source or generated text.
#[derive(Debug, serde::Serialize)]
pub struct ChachaFailure {
    pub kind: &'static str,
    pub retry_after: Option<String>,
}
impl ChachaFailure {
    pub fn new(kind: &'static str) -> Self {
        Self {
            kind,
            retry_after: None,
        }
    }
}

pub fn validate_request(request: &AiRequest) -> Result<(), ChachaFailure> {
    let invalid = || ChachaFailure::new("invalid");
    if serde_json::to_vec(request).map_err(|_| invalid())?.len() > 65536
        || request.messages.len() != 3
    {
        return Err(invalid());
    }
    let messages = &request.messages;
    if messages[0].role != AiRole::System
        || messages[1].role != AiRole::System
        || messages[2].role != AiRole::User
        || messages[0].content.chars().count() > 4096
        || messages[1].content.chars().count() > 10100
    {
        return Err(invalid());
    }
    let context: serde_json::Value =
        serde_json::from_str(&messages[2].content).map_err(|_| invalid())?;
    let object = context.as_object().ok_or_else(invalid)?;
    if !object
        .get("target")
        .and_then(serde_json::Value::as_str)
        .is_some_and(|text| !text.trim().is_empty())
        || object.iter().any(|(key, value)| {
            !["target", "previous", "next", "heading"].contains(&key.as_str()) || !value.is_string()
        })
        || object
            .values()
            .filter_map(serde_json::Value::as_str)
            .map(|text| text.chars().count())
            .sum::<usize>()
            > 2000
    {
        return Err(invalid());
    }
    Ok(())
}

pub async fn execute_cancellable(
    registry: Arc<CancellationRegistry>,
    id: String,
    timeout: Duration,
    operation: impl Future<Output = Result<String, ChachaFailure>>,
) -> Result<String, ChachaFailure> {
    let token = registry.register(id.clone());
    let result = tokio::select! {
        biased;
        _ = token.cancelled() => Err(ChachaFailure::new("cancelled")),
        result = tokio::time::timeout(timeout, operation) => result.unwrap_or_else(|_| Err(ChachaFailure::new("timeout"))),
    };
    registry.unregister(&id);
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai::{
        cancel::CancellationRegistry,
        mock_server::{MockOpenAiServer, Scenario},
        openai::OpenAiCompatibleProvider,
        types::{AiMessage, AiRequest, AiRole},
    };
    use std::{sync::Arc, time::Duration};

    fn request() -> AiRequest {
        AiRequest::new(vec![
            AiMessage::new(AiRole::System, "fixed"),
            AiMessage::new(AiRole::System, "reader"),
            AiMessage::new(AiRole::User, r#"{"target":"paragraph"}"#),
        ])
    }
    #[test]
    fn serializes_chacha_requests_without_blocking_explicit_ai_and_detects_connection_changes() {
        let permit = try_enter().unwrap();
        assert_eq!(try_enter().unwrap_err().kind, "busy");
        drop(permit);
        assert!(try_enter().is_ok());
        let config = super::super::config::AiConfig::new(
            super::super::config::AiProviderKind::OpenAiCompatible,
            "http://localhost/v1".into(),
            Some("secret".into()),
            "model".into(),
            None,
            None,
            None,
            None,
        );
        let revision = connection_revision(&config).unwrap();
        assert!(!revision.contains("secret"));
        let mut changed = config.clone();
        changed.api_key = Some("new-secret".into());
        assert_ne!(connection_revision(&changed).unwrap(), revision);
        changed = config.clone();
        changed.base_url = "http://elsewhere/v1".into();
        assert_ne!(connection_revision(&changed).unwrap(), revision);
    }
    #[test]
    fn accepts_only_bounded_context_without_history_or_extra_fields() {
        assert!(validate_request(&request()).is_ok());
        for context in [
            r#"{"target":"text","files":["secret"]}"#.to_string(),
            serde_json::json!({"target":"a".repeat(2001)}).to_string(),
            "not json".into(),
        ] {
            let mut value = request();
            value.messages[2].content = context;
            assert!(validate_request(&value).is_err());
        }
        let mut value = request();
        value
            .messages
            .push(AiMessage::new(AiRole::Assistant, "history"));
        assert!(validate_request(&value).is_err());
    }
    #[tokio::test]
    async fn reuses_the_provider_but_does_not_retry_or_expose_error_bodies() {
        let server = MockOpenAiServer::start(Scenario::RetryAfter(429, 123, "PRIVATE BODY")).await;
        let provider = OpenAiCompatibleProvider::new(&server.base_url(), None);
        let error = provider
            .complete_chacha(request(), Duration::from_secs(1))
            .await
            .unwrap_err();
        assert_eq!(error.kind, "rate");
        assert_eq!(error.retry_after.as_deref(), Some("123"));
        assert_eq!(server.request_count(), 1);
        assert!(!serde_json::to_string(&error).unwrap().contains("PRIVATE"));
        let server =
            MockOpenAiServer::start(Scenario::HttpBody(401, "text/plain", "PRIVATE KEY")).await;
        let error = OpenAiCompatibleProvider::new(&server.base_url(), None)
            .complete_chacha(request(), Duration::from_secs(1))
            .await
            .unwrap_err();
        assert_eq!(error.kind, "auth");
        assert!(!serde_json::to_string(&error).unwrap().contains("PRIVATE"));
    }
    #[tokio::test]
    async fn accepts_a_completion_and_rejects_oversized_response_bodies() {
        let server = MockOpenAiServer::start(Scenario::HttpBody(
            200,
            "application/json",
            r#"{"choices":[{"message":{"content":"{\"type\":\"none\"}"}}]}"#,
        ))
        .await;
        assert_eq!(
            OpenAiCompatibleProvider::new(&server.base_url(), None)
                .complete_chacha(request(), Duration::from_secs(1))
                .await
                .unwrap(),
            r#"{"type":"none"}"#
        );
        let server = MockOpenAiServer::start(Scenario::HttpBody(
            200,
            "application/json",
            Box::leak("a".repeat(8193).into_boxed_str()),
        ))
        .await;
        assert_eq!(
            OpenAiCompatibleProvider::new(&server.base_url(), None)
                .complete_chacha(request(), Duration::from_secs(1))
                .await
                .unwrap_err()
                .kind,
            "invalid"
        );
    }
    #[tokio::test]
    async fn cancels_during_connection_and_bounds_the_entire_operation() {
        let registry = Arc::new(CancellationRegistry::new());
        let started = Arc::new(tokio::sync::Notify::new());
        let task_registry = registry.clone();
        let task_started = started.clone();
        let task = tokio::spawn(async move {
            execute_cancellable(
                task_registry,
                "id".into(),
                Duration::from_secs(60),
                async move {
                    task_started.notify_one();
                    std::future::pending::<Result<String, ChachaFailure>>().await
                },
            )
            .await
        });
        started.notified().await;
        assert!(registry.cancel("id"));
        assert_eq!(task.await.unwrap().unwrap_err().kind, "cancelled");
        let result = execute_cancellable(
            registry.clone(),
            "timeout".into(),
            Duration::from_millis(1),
            std::future::pending(),
        )
        .await;
        assert_eq!(result.unwrap_err().kind, "timeout");
        assert!(!registry.cancel("timeout"));
    }
}
