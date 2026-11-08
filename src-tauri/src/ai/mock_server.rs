/// mock OpenAI Compatible Server を使った integration test。
/// 外部インターネットや実 OpenAI API に依存しない。
use std::net::SocketAddr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::{TcpListener, TcpStream};

/// テスト用の mock OpenAI Compatible Server。
/// 指定された応答シナリオに従って SSE または HTTP エラーを返す。
pub struct MockOpenAiServer {
    addr: SocketAddr,
    stop: Arc<AtomicBool>,
}

impl MockOpenAiServer {
    /// サーバーを起動し、ランダムポートで待ち受ける。
    pub async fn start(scenario: Scenario) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let stop = Arc::new(AtomicBool::new(false));
        let stop_clone = stop.clone();

        tokio::spawn(async move {
            loop {
                if stop_clone.load(Ordering::Relaxed) {
                    break;
                }
                let (stream, _) = match listener.accept().await {
                    Ok(pair) => pair,
                    Err(_) => break,
                };
                let scenario = scenario.clone();
                tokio::spawn(async move {
                    handle_connection(stream, scenario).await;
                });
            }
        });

        Self { addr, stop }
    }

    pub fn base_url(&self) -> String {
        format!("http://{}/v1", self.addr)
    }
}

impl Drop for MockOpenAiServer {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
    }
}

/// サーバーの応答シナリオ。
#[derive(Debug, Clone)]
pub enum Scenario {
    /// 正常な SSE ストリーミング。
    Streaming,
    /// 完了マーカーを送らずに接続を閉じる。
    StopMidStream,
    /// 最初の断片の後に指定の SSE イベントを送る。
    StreamEvent(String),
    /// 接続は確立するが応答を返さない（Timeout 相当）。
    Hang,
    /// 指定ステータスの HTTP エラー。
    HttpError(u16, &'static str),
}

async fn handle_connection(mut stream: TcpStream, scenario: Scenario) {
    let mut reader = BufReader::new(&mut stream);
    let mut request_line = String::new();
    if reader.read_line(&mut request_line).await.is_err() {
        return;
    }
    // ヘッダーを読み飛ばす
    loop {
        let mut line = String::new();
        if reader.read_line(&mut line).await.is_err() {
            return;
        }
        if line == "\r\n" || line == "\n" {
            break;
        }
    }

    match scenario {
        Scenario::HttpError(status, code) => {
            let body = serde_json::json!({
                "error": { "message": "mock error", "type": "mock", "code": code }
            })
            .to_string();
            let response = format!(
                "HTTP/1.1 {} Mock Error\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                status,
                body.len(),
                body
            );
            let _ = stream.write_all(response.as_bytes()).await;
            let _ = stream.flush().await;
        }
        Scenario::Hang => {
            // 応答を返さず、接続を保持する。
            tokio::time::sleep(std::time::Duration::from_secs(60)).await;
        }
        Scenario::Streaming | Scenario::StopMidStream | Scenario::StreamEvent(_) => {
            let headers = "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\n";
            let _ = stream.write_all(headers.as_bytes()).await;
            let _ = stream.flush().await;

            let chunks = [
                chunk_json("hello"),
                chunk_json(" "),
                chunk_json("world"),
            ];
            for (i, chunk) in chunks.iter().enumerate() {
                let _ = stream.write_all(format!("data: {}\n\n", chunk).as_bytes()).await;
                if let (0, Scenario::StreamEvent(event)) = (i, &scenario) {
                    let _ = stream.write_all(event.as_bytes()).await;
                }
                let _ = stream.flush().await;
                if matches!(scenario, Scenario::StopMidStream) && i == 1 {
                    // 途中で接続を切る
                    return;
                }
                tokio::time::sleep(std::time::Duration::from_millis(10)).await;
            }
            let _ = stream.write_all(b"data: [DONE]\n\n").await;
            let _ = stream.flush().await;
        }
    }
}

fn chunk_json(content: &str) -> String {
    format!(
        r#"{{"id":"chatcmpl-mock","object":"chat.completion.chunk","created":1,"model":"mock","choices":[{{"index":0,"delta":{{"content":"{}"}},"finish_reason":null}}]}}"#,
        content
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai::error::AiError;
    use crate::ai::openai::OpenAiCompatibleProvider;
    use crate::ai::provider::AiProvider;
    use crate::ai::types::{AiMessage, AiRequest, AiRole};
    use futures::StreamExt;

    fn sample_request() -> AiRequest {
        AiRequest::new(vec![AiMessage::new(AiRole::User, "hi")])
    }

    #[tokio::test]
    async fn streams_delta_chunks_from_mock_server() {
        let server = MockOpenAiServer::start(Scenario::Streaming).await;
        let provider = OpenAiCompatibleProvider::new(&server.base_url(), None);
        let mut stream = provider.stream(sample_request()).await.unwrap();

        let mut contents = Vec::new();
        while let Some(item) = stream.next().await {
            if let crate::ai::types::AiStreamEvent::Delta { content, .. } = item.unwrap() {
                contents.push(content);
            }
        }
        assert_eq!(contents, vec!["hello", " ", "world"]);
    }

    #[tokio::test]
    async fn classifies_service_errors_during_streaming_and_preserves_the_payload() {
        let cases: &[(&str, &str, fn(String) -> AiError)] = &[
            (
                "data: ",
                r#"{"error":{"message":"Too many requests","type":"invalid_request_error","code":"rate_limit_exceeded"}}"#,
                AiError::RateLimited,
            ),
            (
                "event: error\ndata: ",
                r#"{"message":"Temporary overload","code":"server_is_overloaded"}"#,
                AiError::ServerError,
            ),
            (
                "data: ",
                r#"{"error":{"message":"Project budget exhausted","code":"project_spend_limit_exceeded"}}"#,
                AiError::QuotaExceeded,
            ),
            (
                "data: ",
                r#"{"error":{"message":"Invalid credentials","code":"invalid_api_key"}}"#,
                AiError::AuthenticationFailed,
            ),
            (
                "event: error\ndata: ",
                r#"{"message":"Request timed out","type":"request_timeout"}"#,
                AiError::Timeout,
            ),
            (
                "data: ",
                r#"{"error":{"message":"Service rejected the request","code":"vendor_code"}}"#,
                AiError::Unknown,
            ),
        ];
        for (prefix, payload, kind) in cases {
            let server =
                MockOpenAiServer::start(Scenario::StreamEvent(format!("{prefix}{payload}\n\n")))
                    .await;
            let provider = OpenAiCompatibleProvider::new(&server.base_url(), None);
            let mut stream = provider.stream(sample_request()).await.unwrap();
            assert!(matches!(
                stream.next().await,
                Some(Ok(crate::ai::types::AiStreamEvent::Delta { .. }))
            ));
            assert_eq!(stream.next().await, Some(Err(kind(payload.to_string()))));
            assert!(stream.next().await.is_none());
        }
    }

    #[tokio::test]
    async fn keeps_malformed_events_as_invalid_responses() {
        for event in ["data: {broken\n\n", "event: error\ndata: [DONE]\n\n"] {
            let server = MockOpenAiServer::start(Scenario::StreamEvent(event.to_owned())).await;
            let provider = OpenAiCompatibleProvider::new(&server.base_url(), None);
            let mut stream = provider.stream(sample_request()).await.unwrap();
            assert!(stream.next().await.unwrap().is_ok());
            let payload = event.trim_end().rsplit_once("data: ").unwrap().1;
            assert!(matches!(
                stream.next().await,
                Some(Err(AiError::InvalidResponse(detail))) if detail.ends_with(payload)
            ));
            assert!(stream.next().await.is_none());
        }
    }

    #[tokio::test]
    async fn rejects_eof_without_a_completion_marker() {
        let server = MockOpenAiServer::start(Scenario::StopMidStream).await;
        let provider = OpenAiCompatibleProvider::new(&server.base_url(), None);
        let mut stream = provider.stream(sample_request()).await.unwrap();

        assert!(stream.next().await.unwrap().is_ok());
        assert!(stream.next().await.unwrap().is_ok());
        assert_eq!(
            stream.next().await.unwrap(),
            Err(crate::ai::error::AiError::StreamInterrupted(
                "stream ended without a completion marker".to_string(),
            )),
        );
        assert!(stream.next().await.is_none());
    }

    #[tokio::test]
    async fn distinguishes_401_error_codes_for_both_request_paths() {
        for (code, expected) in [
            (
                "invalid_api_key",
                AiError::AuthenticationFailed("mock error\n\ncode: invalid_api_key".to_string()),
            ),
            (
                "invalid_project",
                AiError::InvalidProject("mock error\n\ncode: invalid_project".to_string()),
            ),
        ] {
            let server = MockOpenAiServer::start(Scenario::HttpError(401, code)).await;
            let provider = OpenAiCompatibleProvider::new(&server.base_url(), None);
            assert_eq!(provider.test_connection("mock").await, Err(expected.clone()));
            assert!(matches!(
                provider.stream(sample_request()).await,
                Err(error) if error == expected
            ));
        }
    }

    #[tokio::test]
    async fn maps_429_to_rate_limited() {
        let server = MockOpenAiServer::start(Scenario::HttpError(429, "mock")).await;
        let provider = OpenAiCompatibleProvider::new(&server.base_url(), None);
        let result = provider.stream(sample_request()).await;
        assert!(matches!(
            result,
            Err(crate::ai::error::AiError::RateLimited(_))
        ));
    }

    #[tokio::test]
    async fn maps_500_to_server_error() {
        let server = MockOpenAiServer::start(Scenario::HttpError(500, "mock")).await;
        let provider = OpenAiCompatibleProvider::new(&server.base_url(), None);
        let result = provider.stream(sample_request()).await;
        assert!(matches!(
            result,
            Err(crate::ai::error::AiError::ServerError(_))
        ));
    }
}
