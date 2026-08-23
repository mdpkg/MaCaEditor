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
        assert!(events.iter().any(|e| matches!(
            e,
            AiStreamEvent::Error { request_id, error: AiError::ServerError(_) }
                if !request_id.is_empty()
        )));
    }
}
