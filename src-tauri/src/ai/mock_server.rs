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
    /// 途中で接続を切る（Cancel 相当）。
    StopMidStream,
    /// 接続は確立するが応答を返さない（Timeout 相当）。
    Hang,
    /// 指定ステータスの HTTP エラー。
    HttpError(u16),
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
        Scenario::HttpError(status) => {
            let body = format!(
                r#"{{"error":{{"message":"mock error","type":"mock","code":"mock"}}}}"#
            );
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
        Scenario::Streaming | Scenario::StopMidStream => {
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
            match item {
                Ok(crate::ai::types::AiStreamEvent::Delta { content, .. }) => {
                    contents.push(content);
                }
                Ok(_) => {}
                Err(_) => {}
            }
        }
        // " " は trim で空扱いになるためスキップされる
        assert_eq!(contents, vec!["hello", "world"]);
    }

    #[tokio::test]
    async fn maps_http_error_to_ai_error() {
        let server = MockOpenAiServer::start(Scenario::HttpError(401)).await;
        let provider = OpenAiCompatibleProvider::new(&server.base_url(), None);
        let result = provider.stream(sample_request()).await;
        assert!(matches!(
            result,
            Err(crate::ai::error::AiError::AuthenticationFailed(_))
        ));
    }

    #[tokio::test]
    async fn maps_429_to_rate_limited() {
        let server = MockOpenAiServer::start(Scenario::HttpError(429)).await;
        let provider = OpenAiCompatibleProvider::new(&server.base_url(), None);
        let result = provider.stream(sample_request()).await;
        assert!(matches!(
            result,
            Err(crate::ai::error::AiError::RateLimited(_))
        ));
    }

    #[tokio::test]
    async fn maps_500_to_server_error() {
        let server = MockOpenAiServer::start(Scenario::HttpError(500)).await;
        let provider = OpenAiCompatibleProvider::new(&server.base_url(), None);
        let result = provider.stream(sample_request()).await;
        assert!(matches!(
            result,
            Err(crate::ai::error::AiError::ServerError(_))
        ));
    }
}
