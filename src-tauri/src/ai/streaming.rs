/// ストリーミング実行の調整役。
/// request ID の発行、Cancel、Timeout をここで扱い、
/// 上位層（Tauri command）へは request ID 付きイベント列を返す。
use std::sync::Arc;

use futures::Stream;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use crate::ai::cancel::CancellationRegistry;
use crate::ai::error::AiError;
use crate::ai::provider::AiProvider;
use crate::ai::types::{AiRequest, AiStreamEvent};

/// 既定の Connect Timeout（秒）。
pub const DEFAULT_CONNECT_TIMEOUT_SECONDS: u64 = 10;
/// 既定の Request Timeout（秒）。ローカル LLM の遅さを考慮して大きめに取る。
pub const DEFAULT_REQUEST_TIMEOUT_SECONDS: u64 = 300;

pub struct AiStreamCoordinator<P: AiProvider> {
    provider: Arc<P>,
    registry: Arc<CancellationRegistry>,
}

impl<P: AiProvider> AiStreamCoordinator<P> {
    pub fn new(provider: P) -> Self {
        Self {
            provider: Arc::new(provider),
            registry: Arc::new(CancellationRegistry::new()),
        }
    }

    /// 外部からレジストリを注入する（Tauri 管理状態と共有するため）。
    pub fn with_registry(provider: P, registry: Arc<CancellationRegistry>) -> Self {
        Self {
            provider: Arc::new(provider),
            registry,
        }
    }

    /// 新しい request ID を発行する。
    pub fn new_request_id(&self) -> String {
        Uuid::new_v4().to_string()
    }

    /// request ID を指定してキャンセルする。
    /// 存在しない ID は idempotent に成功扱いする。
    pub fn cancel(&self, request_id: &str) -> bool {
        self.registry.cancel(request_id)
    }

    /// 実行完了後に登録を解除する。存在しない ID は何もしない。
    pub fn unregister(&self, request_id: &str) {
        self.registry.unregister(request_id);
    }

    /// ストリーミングを開始し、request ID 付きイベント列を返す。
    /// 接続失敗は即時エラーとして返す。
    pub async fn start(
        &self,
        request: AiRequest,
        connect_timeout_seconds: Option<u64>,
        request_timeout_seconds: Option<u64>,
    ) -> Result<Box<dyn Stream<Item = Result<AiStreamEvent, AiError>> + Send + Unpin>, AiError> {
        let request_id = self.new_request_id();
        let token = self.registry.register(request_id.clone());

        let connect_timeout = connect_timeout_seconds.unwrap_or(DEFAULT_CONNECT_TIMEOUT_SECONDS);
        let request_timeout = request_timeout_seconds.unwrap_or(DEFAULT_REQUEST_TIMEOUT_SECONDS);

        // Connect Timeout: 接続開始までに timeout したら Timeout エラー
        let source = tokio::time::timeout(
            std::time::Duration::from_secs(connect_timeout),
            self.provider.stream(request),
        )
        .await;

        let inner = match source {
            Err(_) => {
                self.registry.unregister(&request_id);
                return Err(AiError::Timeout("connect timeout".to_string()));
            }
            Ok(Err(e)) => {
                self.registry.unregister(&request_id);
                return Err(e);
            }
            Ok(Ok(inner)) => inner,
        };

        let started = AiStreamEvent::Started {
            request_id: request_id.clone(),
        };
        let stream = wrap_stream(inner, token, self.registry.clone(), request_id.clone(), request_timeout);
        use futures::StreamExt;
        Ok(Box::new(futures::stream::iter(vec![Ok(started)]).chain(stream)))
    }
}

/// 内部ストリームを Cancel / Timeout 対応に包む。
/// Cancel 後は後続 chunk を流さず、Cancelled を一度だけ通知する。
fn wrap_stream<S>(
    inner: S,
    token: CancellationToken,
    registry: Arc<CancellationRegistry>,
    request_id: String,
    request_timeout_seconds: u64,
) -> impl Stream<Item = Result<AiStreamEvent, AiError>> + Send + Unpin
where
    S: Stream<Item = Result<AiStreamEvent, AiError>> + Send + Unpin + 'static,
{
    use futures::StreamExt;

    let mut inner = inner;
    let mut cancelled = false;
    let mut completed = false;
    let mut timed_out = false;

    let timeout_duration = std::time::Duration::from_secs(request_timeout_seconds);
    let mut timeout = Box::pin(tokio::time::sleep(timeout_duration));

    let mut first = true;

    futures::stream::poll_fn(move |cx| {
        // キャンセル済みなら後続を流さない
        if token.is_cancelled() {
            if !cancelled {
                cancelled = true;
                registry.unregister(&request_id);
                return std::task::Poll::Ready(Some(Ok(AiStreamEvent::Cancelled {
                    request_id: request_id.clone(),
                })));
            }
            return std::task::Poll::Ready(None);
        }

        // Request Timeout を確認
        if first {
            first = false;
            timeout = Box::pin(tokio::time::sleep(timeout_duration));
        }
        use futures::FutureExt;
        if std::task::Poll::Ready(()) == timeout.as_mut().poll_unpin(cx) {
            if !timed_out {
                timed_out = true;
                registry.unregister(&request_id);
                return std::task::Poll::Ready(Some(Err(AiError::Timeout(
                    "request timeout".to_string(),
                ))));
            }
            return std::task::Poll::Ready(None);
        }

        match inner.poll_next_unpin(cx) {
            std::task::Poll::Ready(Some(item)) => {
                match item {
                    Ok(AiStreamEvent::Delta { content, .. }) => {
                        std::task::Poll::Ready(Some(Ok(AiStreamEvent::Delta {
                            request_id: request_id.clone(),
                            content,
                        })))
                    }
                    Ok(other) => std::task::Poll::Ready(Some(Ok(other))),
                    Err(e) => {
                        registry.unregister(&request_id);
                        std::task::Poll::Ready(Some(Err(e)))
                    }
                }
            }
            std::task::Poll::Ready(None) => {
                if !completed {
                    completed = true;
                    registry.unregister(&request_id);
                    std::task::Poll::Ready(Some(Ok(AiStreamEvent::Completed {
                        request_id: request_id.clone(),
                    })))
                } else {
                    std::task::Poll::Ready(None)
                }
            }
            std::task::Poll::Pending => std::task::Poll::Pending,
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai::mock::MockAiProvider;
    use crate::ai::types::{AiMessage, AiRole};

    fn sample_request() -> AiRequest {
        AiRequest::new(vec![AiMessage::new(AiRole::User, "hi")])
    }

    #[tokio::test]
    async fn starts_with_request_id() {
        let coordinator = AiStreamCoordinator::new(MockAiProvider::new("answer"));
        let mut stream = coordinator
            .start(sample_request(), None, None)
            .await
            .unwrap();
        use futures::StreamExt;
        let first = stream.next().await.unwrap().unwrap();
        match first {
            AiStreamEvent::Started { request_id } => assert!(!request_id.is_empty()),
            _ => panic!("expected started"),
        }
    }

    #[tokio::test]
    async fn emits_delta_then_completed() {
        let coordinator = AiStreamCoordinator::new(MockAiProvider::new("answer"));
        let mut stream = coordinator
            .start(sample_request(), None, None)
            .await
            .unwrap();
        use futures::StreamExt;
        let mut events = Vec::new();
        while let Some(item) = stream.next().await {
            events.push(item.unwrap());
        }
        assert!(matches!(events[0], AiStreamEvent::Started { .. }));
        assert!(matches!(events[1], AiStreamEvent::Delta { .. }));
        assert!(matches!(events[2], AiStreamEvent::Completed { .. }));
    }

    #[tokio::test]
    async fn cancel_emits_cancelled_and_stops() {
        let coordinator = AiStreamCoordinator::new(MockAiProvider::new("answer"));
        let mut stream = coordinator
            .start(sample_request(), None, None)
            .await
            .unwrap();
        use futures::StreamExt;
        let _ = stream.next().await; // started
        let _ = stream.next().await; // delta
        let request_id = coordinator.new_request_id();
        // 実際の request ID を取得するため、start で発行された ID を使う
        // ここでは簡易に、registry 経由でキャンセルする
        let _ = request_id;
        // 代わりに、start の request_id を取得するため再取得
        drop(stream);
        let mut stream = coordinator
            .start(sample_request(), None, None)
            .await
            .unwrap();
        let started = stream.next().await.unwrap().unwrap();
        let request_id = match started {
            AiStreamEvent::Started { request_id } => request_id,
            _ => panic!(),
        };
        let _ = stream.next().await; // delta
        assert!(coordinator.cancel(&request_id));
        let next = stream.next().await.unwrap().unwrap();
        assert!(matches!(next, AiStreamEvent::Cancelled { .. }));
        // 後続は流れない
        assert!(stream.next().await.is_none());
    }

    #[tokio::test]
    async fn cancelling_unknown_request_is_idempotent() {
        let coordinator = AiStreamCoordinator::new(MockAiProvider::new("answer"));
        assert!(!coordinator.cancel("missing"));
        assert!(!coordinator.cancel("missing"));
    }

    #[tokio::test]
    async fn connect_timeout_returns_timeout_error() {
        // 接続に時間がかかる provider を用意し、短い connect timeout で打ち切る。
        struct SlowProvider;
        impl crate::ai::provider::AiProvider for SlowProvider {
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
                tokio::time::sleep(std::time::Duration::from_secs(60)).await;
                Err(crate::ai::error::AiError::Unknown("never".to_string()))
            }
        }

        let coordinator = AiStreamCoordinator::new(SlowProvider);
        let result = coordinator
            .start(sample_request(), Some(1), None)
            .await;
        assert!(matches!(result, Err(AiError::Timeout(_))));
    }

    #[tokio::test]
    async fn unregisters_request_after_completion() {
        let registry = Arc::new(CancellationRegistry::new());
        let coordinator = AiStreamCoordinator::with_registry(MockAiProvider::new("answer"), registry.clone());
        let mut stream = coordinator
            .start(sample_request(), None, None)
            .await
            .unwrap();
        use futures::StreamExt;
        let started = stream.next().await.unwrap().unwrap();
        let request_id = match started {
            AiStreamEvent::Started { request_id } => request_id,
            _ => panic!("expected started"),
        };
        // 完了まで読み切る
        while let Some(_) = stream.next().await {}
        // 完了後はレジストリから解除されている
        assert!(!registry.cancel(&request_id));
    }

    #[tokio::test]
    async fn request_timeout_emits_timeout_error() {
        // 1 つの delta を返した後、応答が止まる provider。
        struct HangingProvider;
        impl crate::ai::provider::AiProvider for HangingProvider {
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
                    Ok(crate::ai::types::AiStreamEvent::Delta {
                        request_id: String::new(),
                        content: "hi".to_string(),
                    });
                Ok(Box::new(stream::iter(vec![item]).chain(stream::pending())))
            }
        }

        let coordinator = AiStreamCoordinator::new(HangingProvider);
        let mut stream = coordinator
            .start(sample_request(), None, Some(1))
            .await
            .unwrap();
        use futures::StreamExt;
        let mut events = Vec::new();
        while let Some(item) = stream.next().await {
            events.push(item);
        }
        assert!(matches!(events[0], Ok(AiStreamEvent::Started { .. })));
        assert!(matches!(events[1], Ok(AiStreamEvent::Delta { .. })));
        assert!(matches!(events[2], Err(AiError::Timeout(_))));
        // Timeout 後はレジストリから解除されている
        let started = &events[0];
        let request_id = match started {
            Ok(AiStreamEvent::Started { request_id }) => request_id.clone(),
            _ => panic!("expected started"),
        };
        assert!(!coordinator.cancel(&request_id));
    }
}
