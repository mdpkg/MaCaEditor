/// AI ストリーミングの Tauri command とテスト可能な実行ヘルパー。
/// `run_ai_stream` は Channel に依存しないため unit test できる。
use std::sync::Arc;

use futures::StreamExt;

use crate::ai::cancel::CancellationRegistry;
use crate::ai::error::AiError;
use crate::ai::provider::AiProvider;
use crate::ai::streaming::AiStreamCoordinator;
use crate::ai::types::{AiRequest, AiStreamEvent};

/// 共有レジストリを保持する Tauri 管理状態。
/// `ai_stream` と `cancel_ai_request` で同じレジストリを参照する。
pub struct AiStreamState {
    pub registry: Arc<CancellationRegistry>,
}

static CHAT_SLOT: tokio::sync::Semaphore = tokio::sync::Semaphore::const_new(1);
#[cfg(test)]
pub(crate) static CHAT_TEST_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
pub const CHAT_RESPONSE_BYTES: usize = 64 * 1024;

#[derive(Debug, serde::Serialize)]
pub struct ChatCompletion {
    pub request_id: String,
    pub content: String,
}
pub fn validate_chat_request_id(id: &str) -> Result<(), AiError> {
    if id.len() == 36 && uuid::Uuid::parse_str(id).is_ok_and(|uuid| uuid.hyphenated().to_string() == id) { return Ok(()); }
    Err(AiError::InvalidConfiguration("invalid request ID".into()))
}

/// Unlike selection/diagram commands, chat resolves only after physical completion.
pub async fn run_chat_stream<P: AiProvider>(
    provider: &P,
    registry: Arc<CancellationRegistry>,
    request_id: String,
    sender: impl Fn(AiStreamEvent),
    request: AiRequest,
    connect_seconds: Option<u64>,
    request_seconds: Option<u64>,
) -> Result<ChatCompletion, AiError> {
    validate_chat_request_id(&request_id)?;
    if serde_json::to_vec(&request).map_err(|_| AiError::InvalidConfiguration("invalid request".into()))?.len() > 1024 * 1024 {
        return Err(AiError::InvalidConfiguration("chat request exceeds 1 MiB".into()));
    }
    let _permit = CHAT_SLOT.try_acquire()
        .map_err(|_| AiError::InvalidConfiguration("chat busy".into()))?;
    let token = registry.try_register(request_id.clone())
        .map_err(|_| AiError::InvalidConfiguration("duplicate request ID".into()))?;
    struct Registration(Arc<CancellationRegistry>, String);
    impl Drop for Registration {
        fn drop(&mut self) { self.0.unregister(&self.1); }
    }
    let _registration = Registration(registry, request_id.clone());
    let operation = async {
        // The outer timeout and cancellation cover connection establishment too.
        let connect = std::time::Duration::from_secs(connect_seconds.unwrap_or(10).clamp(1, 60));
        let mut stream = tokio::time::timeout(connect, provider.stream_with_connect_timeout(request, connect))
            .await.map_err(|_| AiError::Timeout("connect timeout".into()))??;
        sender(AiStreamEvent::Started { request_id: request_id.clone() });
        let mut content = String::new();
        while let Some(event) = stream.next().await {
            match event? {
                AiStreamEvent::Delta { content: delta, .. } => {
                    if content.len().saturating_add(delta.len()) > CHAT_RESPONSE_BYTES {
                        return Err(AiError::InvalidResponse("chat response exceeds 64 KiB".into()));
                    }
                    content.push_str(&delta);
                    sender(AiStreamEvent::Delta { request_id: request_id.clone(), content: delta });
                }
                AiStreamEvent::Error { error, .. } => return Err(error),
                AiStreamEvent::Cancelled { .. } => return Err(AiError::Cancelled),
                _ => {}
            }
        }
        Ok(ChatCompletion { request_id: request_id.clone(), content })
    };
    let result = tokio::select! {
        biased;
        _ = token.cancelled() => Err(AiError::Cancelled),
        result = tokio::time::timeout(std::time::Duration::from_secs(request_seconds.unwrap_or(300).clamp(1, 600)), operation) =>
            result.unwrap_or_else(|_| Err(AiError::Timeout("request timeout".into()))),
    };
    result.map_err(safe_chat_error)
}

/// Chat diagnostics never echo provider bodies, URLs, document data or credentials.
fn safe_chat_error(error: AiError) -> AiError {
    macro_rules! safe { ($kind:ident) => { AiError::$kind("chat request failed; review connection settings or retry".into()) }; }
    match error {
        AiError::Cancelled => AiError::Cancelled,
        AiError::InvalidConfiguration(_) => safe!(InvalidConfiguration), AiError::ConnectionFailed(_) => safe!(ConnectionFailed),
        AiError::AuthenticationFailed(_) => safe!(AuthenticationFailed), AiError::InvalidProject(_) => safe!(InvalidProject),
        AiError::PermissionDenied(_) => safe!(PermissionDenied), AiError::ModelNotFound(_) => safe!(ModelNotFound),
        AiError::RateLimited(_) => safe!(RateLimited), AiError::QuotaExceeded(_) => safe!(QuotaExceeded),
        AiError::Timeout(_) => safe!(Timeout), AiError::ServerError(_) => safe!(ServerError),
        AiError::InvalidResponse(_) => safe!(InvalidResponse), AiError::StreamInterrupted(_) => safe!(StreamInterrupted),
        AiError::Unknown(_) => safe!(Unknown),
    }
}

/// ストリーミングを開始し、各イベントを sender へ送る。
/// 戻り値は発行した request ID。
pub async fn run_ai_stream<P, F>(
    coordinator: &AiStreamCoordinator<P>,
    sender: F,
    request: AiRequest,
    connect_timeout_seconds: Option<u64>,
    request_timeout_seconds: Option<u64>,
) -> Result<String, AiError>
where
    P: AiProvider,
    F: Fn(AiStreamEvent) + Send + Sync + 'static,
{
    let mut stream = coordinator
        .start(request, connect_timeout_seconds, request_timeout_seconds)
        .await?;

    let first = stream
        .next()
        .await
        .ok_or_else(|| AiError::InvalidResponse("no started event".to_string()))??;
    let request_id = match &first {
        AiStreamEvent::Started { request_id } => request_id.clone(),
        _ => return Err(AiError::InvalidResponse("expected started event".to_string())),
    };
    sender(first);

    let request_id_for_task = request_id.clone();
    tokio::spawn(async move {
        while let Some(item) = stream.next().await {
            match item {
                Ok(event) => sender(event),
                Err(error) => sender(AiStreamEvent::Error {
                    request_id: request_id_for_task.clone(),
                    error,
                }),
            }
        }
    });

    Ok(request_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai::mock::MockAiProvider;
    use crate::ai::types::{AiMessage, AiRole};
    use std::sync::Mutex;
    #[test]
    fn chat_request_ids_require_bounded_canonical_uuids() {
        let id = uuid::Uuid::new_v4().to_string();
        assert!(validate_chat_request_id(&id).is_ok());
        assert!(validate_chat_request_id(&id.replace('-', "")).is_err());
        assert!(validate_chat_request_id(&format!("urn:uuid:{id}")).is_err());
        assert!(validate_chat_request_id(&"x".repeat(1000000)).is_err());
    }

    fn sample_request() -> AiRequest {
        AiRequest::new(vec![AiMessage::new(AiRole::User, "hi")])
    }

    fn collector() -> (
        Arc<Mutex<Vec<AiStreamEvent>>>,
        impl Fn(AiStreamEvent) + Send + Sync + 'static,
    ) {
        let events = Arc::new(Mutex::new(Vec::new()));
        let events_clone = events.clone();
        (events, move |event| events_clone.lock().unwrap().push(event))
    }

    #[tokio::test]
    async fn sends_started_delta_and_completed_through_sender() {
        let coordinator = AiStreamCoordinator::new(MockAiProvider::new("answer"));
        let (events, sender) = collector();
        let request_id = run_ai_stream(&coordinator, sender, sample_request(), None, None)
            .await
            .unwrap();
        assert!(!request_id.is_empty());
        // タスクが完了するまで少し待つ
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        let events = events.lock().unwrap().clone();
        assert!(matches!(events[0], AiStreamEvent::Started { .. }));
        assert!(matches!(events[1], AiStreamEvent::Delta { .. }));
        assert!(matches!(events[2], AiStreamEvent::Completed { .. }));
    }

    #[tokio::test]
    async fn cancel_stops_stream_and_emits_cancelled() {
        let registry = Arc::new(CancellationRegistry::new());
        let coordinator =
            AiStreamCoordinator::with_registry(MockAiProvider::new("answer"), registry.clone());
        let (events, sender) = collector();
        let request_id = run_ai_stream(&coordinator, sender, sample_request(), None, None)
            .await
            .unwrap();
        assert!(registry.cancel(&request_id));
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        let events = events.lock().unwrap().clone();
        assert!(matches!(events[0], AiStreamEvent::Started { .. }));
        assert!(events.iter().any(|e| matches!(e, AiStreamEvent::Cancelled { .. })));
        // Cancelled の後は Completed が来ない
        assert!(!events.iter().any(|e| matches!(e, AiStreamEvent::Completed { .. })));
    }

    #[tokio::test]
    async fn error_events_are_forwarded_with_request_id() {
        // stream がエラーを返す provider。
        struct ErrorProvider;
        impl crate::ai::provider::AiProvider for ErrorProvider {
            async fn complete(
                &self,
                _request: crate::ai::types::AiRequest,
            ) -> Result<crate::ai::types::AiResponse, crate::ai::error::AiError> {
                Ok(crate::ai::types::AiResponse::new(""))
            }
            async fn stream(
                &self,
                _request: crate::ai::types::AiRequest,
            ) -> Result<
                Box<dyn futures::Stream<Item = Result<crate::ai::types::AiStreamEvent, crate::ai::error::AiError>> + Send + Unpin>,
                crate::ai::error::AiError,
            > {
                use futures::stream;
                let item: Result<crate::ai::types::AiStreamEvent, crate::ai::error::AiError> =
                    Err(crate::ai::error::AiError::ServerError("boom".to_string()));
                Ok(Box::new(stream::iter(vec![item])))
            }
        }

        let coordinator = AiStreamCoordinator::new(ErrorProvider);
        let (events, sender) = collector();
        let _request_id = run_ai_stream(&coordinator, sender, sample_request(), None, None)
            .await
            .unwrap();
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        let events = events.lock().unwrap().clone();
        assert!(matches!(events[0], AiStreamEvent::Started { .. }));
        assert!(matches!(
            events.as_slice(),
            [AiStreamEvent::Started { .. }, AiStreamEvent::Error { request_id, error: AiError::ServerError(_) }]
                if !request_id.is_empty()
        ));
    }
}

#[cfg(test)]
mod chat_completion_tests {
    use super::*;
    use crate::ai::{mock::MockAiProvider, types::{AiMessage, AiRole}};
    #[tokio::test]
    async fn chat_command_returns_the_full_answer_and_releases_registration() {
        let _guard = CHAT_TEST_LOCK.lock().await;
        let registry = Arc::new(CancellationRegistry::new());
        let id = uuid::Uuid::new_v4().to_string();
        let result = run_chat_stream(&MockAiProvider::new("full answer"), registry.clone(), id.clone(), |_| {},
            AiRequest::new(vec![AiMessage::new(AiRole::User, "hi")]), None, None).await.unwrap();
        assert_eq!(result.content, "full answer");
        assert_eq!(result.request_id, id);
        assert!(!registry.cancel(&id));
    }
    #[tokio::test]
    async fn early_cancel_does_not_call_provider() {
        let _guard = CHAT_TEST_LOCK.lock().await;
        let registry = Arc::new(CancellationRegistry::new());
        let id = uuid::Uuid::new_v4().to_string();
        registry.cancel(&id);
        let result = run_chat_stream(&MockAiProvider::new("must not run"), registry, id, |_| {},
            AiRequest::new(vec![]), None, None).await;
        assert!(matches!(result, Err(AiError::Cancelled)));
    }
}


#[cfg(test)]
mod chat_deadline_tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    struct PendingProvider(Arc<AtomicUsize>);
    impl AiProvider for PendingProvider {
        async fn complete(&self, _: AiRequest) -> Result<crate::ai::types::AiResponse, AiError> { unreachable!() }
        async fn stream(&self, _: AiRequest) -> Result<crate::ai::provider::AiEventStream, AiError> {
            self.0.fetch_add(1, Ordering::SeqCst);
            futures::future::pending().await
        }
    }
    #[tokio::test(start_paused = true)]
    async fn deadline_covers_connection_and_busy_requests_do_not_queue() {
        // A separate local semaphore cannot prove the application-wide exclusion.
        // Wait for other helper tests through their test-only lock.
        let _guard = CHAT_TEST_LOCK.lock().await;
        let calls = Arc::new(AtomicUsize::new(0));
        let provider = PendingProvider(calls.clone());
        let registry = Arc::new(CancellationRegistry::new());
        let id = uuid::Uuid::new_v4().to_string();
        let request = run_chat_stream(&provider, registry.clone(), id.clone(), |_| {}, AiRequest::new(vec![]), Some(10), Some(2));
        tokio::pin!(request);
        assert!(futures::poll!(&mut request).is_pending());
        let busy = run_chat_stream(&provider, registry.clone(), uuid::Uuid::new_v4().to_string(), |_| {}, AiRequest::new(vec![]), None, None).await;
        assert!(matches!(busy, Err(AiError::InvalidConfiguration(_))));
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        tokio::time::advance(std::time::Duration::from_secs(2)).await;
        assert!(matches!(request.await, Err(AiError::Timeout(_))));
        assert!(!registry.cancel(&id));
        // Starting a new request, then cancelling during connection, settles promptly.
        let id = uuid::Uuid::new_v4().to_string();
        let request = run_chat_stream(&provider, registry.clone(), id.clone(), |_| {}, AiRequest::new(vec![]), None, None);
        tokio::pin!(request);
        assert!(futures::poll!(&mut request).is_pending());
        assert!(registry.cancel(&id));
        assert!(matches!(request.await, Err(AiError::Cancelled)));
    }
}
