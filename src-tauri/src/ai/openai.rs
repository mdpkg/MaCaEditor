/// OpenAI Compatible Provider。
/// `async-openai` はこの実装内部に閉じ込め、
/// アプリケーション層へは MaCa Editor 独自型のみを公開する。
use async_openai::config::Config;
use async_openai::error::{ApiError, ApiErrorResponse, OpenAIError, WrappedError};
use async_openai::middleware::{retry::OpenAIRetryLayer, HttpRequestFactory, ReqwestService};
use async_openai::types::chat::{
    ChatCompletionRequestAssistantMessage, ChatCompletionRequestAssistantMessageContent,
    ChatCompletionRequestMessage, ChatCompletionRequestSystemMessage,
    ChatCompletionRequestSystemMessageContent, ChatCompletionRequestUserMessage,
    ChatCompletionRequestUserMessageContent, CreateChatCompletionRequest,
    CreateChatCompletionRequestArgs, CreateChatCompletionStreamResponse,
};
use eventsource_stream::{EventStreamError, Eventsource};
use futures::StreamExt;
use reqwest::StatusCode;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio_util::task::AbortOnDropHandle;
use tower::{service_fn, Layer, ServiceExt};

use crate::ai::error::{classify_http_status, AiError};
use crate::ai::provider::AiEventStream;
use crate::ai::types::{AiMessage, AiRequest, AiResponse, AiRole, AiStreamEvent};

/// OpenAI Compatible API へ接続する Provider。
pub struct OpenAiCompatibleProvider {
    client: async_openai::Client<async_openai::config::OpenAIConfig>,
    http: reqwest::Client,
    model: String,
}

impl OpenAiCompatibleProvider {
    pub fn new(base_url: &str, api_key: Option<&str>) -> Self {
        let mut config = async_openai::config::OpenAIConfig::new();
        config = config.with_api_base(base_url);
        if let Some(key) = api_key {
            if !key.trim().is_empty() {
                config = config.with_api_key(key);
            }
        }
        let http = reqwest::Client::new();
        let transport = http.clone();
        let service = service_fn(move |request| execute_http_request(transport.clone(), request, None));
        Self {
            client: async_openai::Client::build(http.clone(), config).with_http_service(service),
            http,
            model: "default".to_string(),
        }
    }

    pub fn with_model(mut self, model: impl Into<String>) -> Self {
        self.model = model.into();
        self
    }

    fn to_openai_request(
        &self,
        model: &str,
        request: &AiRequest,
        stream: bool,
    ) -> Result<CreateChatCompletionRequest, AiError> {
        let mut builder = CreateChatCompletionRequestArgs::default();
        let messages = request
            .messages
            .iter()
            .map(to_openai_message)
            .collect::<Vec<_>>();
        builder.model(model);
        builder.messages(messages);
        if let Some(t) = request.temperature {
            builder.temperature(t);
        }
        if let Some(n) = request.max_output_tokens {
            builder.max_tokens(n);
        }
        if stream {
            builder.stream(true);
        }
        builder.build().map_err(|e| AiError::InvalidConfiguration(e.to_string()))
    }
}

fn to_openai_message(message: &AiMessage) -> ChatCompletionRequestMessage {
    match message.role {
        AiRole::System => ChatCompletionRequestMessage::System(ChatCompletionRequestSystemMessage {
            content: ChatCompletionRequestSystemMessageContent::Text(message.content.clone()),
            name: None,
        }),
        AiRole::User => ChatCompletionRequestMessage::User(ChatCompletionRequestUserMessage {
            content: ChatCompletionRequestUserMessageContent::Text(message.content.clone()),
            name: None,
        }),
        AiRole::Assistant => {
            ChatCompletionRequestMessage::Assistant(ChatCompletionRequestAssistantMessage {
                content: Some(ChatCompletionRequestAssistantMessageContent::Text(
                    message.content.clone(),
                )),
                refusal: None,
                name: None,
                audio: None,
                tool_calls: None,
                #[allow(deprecated)]
                function_call: None,
            })
        }
    }
}

fn from_openai_response(
    response: async_openai::types::chat::CreateChatCompletionResponse,
) -> Result<AiResponse, AiError> {
    let content = response
        .choices
        .first()
        .and_then(|choice| choice.message.content.clone())
        .ok_or_else(|| AiError::InvalidResponse("empty response".to_string()))?;
    Ok(AiResponse::new(content))
}

impl OpenAiCompatibleProvider {
    /// Model 一覧を取得する。
    /// Models API が未実装・非互換でも致命的エラーにしない。
    pub async fn list_models(&self) -> Result<Vec<String>, AiError> {
        let models = self
            .client
            .models()
            .list()
            .await
            .map_err(map_openai_error)?;
        let mut names = models
            .data
            .into_iter()
            .map(|m| m.id)
            .collect::<Vec<_>>();
        names.sort();
        Ok(names)
    }

    /// 最小の Chat Completion を送信して接続を確認する。
    pub async fn test_connection(&self, model: &str) -> Result<(), AiError> {
        let request = AiRequest::new(vec![AiMessage::new(AiRole::User, "ping")]);
        let openai_request = self.to_openai_request(model, &request, false)?;
        self.client
            .chat()
            .create(openai_request)
            .await
            .map_err(map_openai_error)?;
        Ok(())
    }
}

/// stream chunk からユーザー向けテキスト delta を抽出する。
/// content が無い chunk（role のみ・finish chunk・空 chunk）は None を返す。
fn delta_content_from_chunk(
    chunk: &CreateChatCompletionStreamResponse,
) -> Option<String> {
    let content = chunk.choices.first()?.delta.content.clone()?;
    if content.is_empty() {
        return None;
    }
    Some(content)
}

/// stream chunk を `AiStreamEvent::Delta` へ変換する。
/// content が無い chunk（role のみ・finish chunk・空 chunk）は None を返し、
/// UI へは実際に content がある chunk のみを流す。
fn chunk_to_stream_event(
    chunk: &CreateChatCompletionStreamResponse,
) -> Option<AiStreamEvent> {
    delta_content_from_chunk(chunk).map(|content| AiStreamEvent::Delta {
        request_id: String::new(),
        content,
    })
}

impl crate::ai::provider::AiProvider for OpenAiCompatibleProvider {
    async fn complete(
        &self,
        request: AiRequest,
    ) -> Result<AiResponse, AiError> {
        let openai_request = self.to_openai_request(&self.model, &request, false)?;
        let response = self
            .client
            .chat()
            .create(openai_request)
            .await
            .map_err(map_openai_error)?;
        from_openai_response(response)
    }

    async fn stream(&self, request: AiRequest) -> Result<AiEventStream, AiError> {
        self.open_stream(request, None).await
    }

    async fn stream_with_connect_timeout(
        &self,
        request: AiRequest,
        timeout: Duration,
    ) -> Result<AiEventStream, AiError> {
        let last_error = RetryError::default();
        match tokio::time::timeout(timeout, self.open_stream(request, Some(last_error.clone()))).await {
            Ok(result) => result,
            Err(_) => Err(last_error
                .lock()
                .unwrap()
                .take()
                .map(|error| error.lock().unwrap().clone())
                .unwrap_or_else(|| AiError::Timeout("connect timeout".to_owned()))),
        }
    }
}

type RetryError = Arc<Mutex<Option<Arc<Mutex<AiError>>>>>;

impl OpenAiCompatibleProvider {
    async fn open_stream(
        &self,
        request: AiRequest,
        last_error: Option<RetryError>,
    ) -> Result<AiEventStream, AiError> {
        let request = self.to_openai_request(&self.model, &request, true)?;
        let config = self.client.config().clone();
        let http = self.http.clone();
        let factory = HttpRequestFactory::new(move || {
            let request = http
                .post(config.url("/chat/completions"))
                .headers(config.headers())
                .query(&config.query())
                .header(reqwest::header::ACCEPT, "text/event-stream")
                .json(&request)
                .build();
            async { request.map_err(OpenAIError::Reqwest) }
        });
        let response = execute_http_request(self.http.clone(), factory, last_error)
            .await
            .map_err(map_openai_error)?;
        let status = response.status();
        if !status.is_success() {
            let body = read_body(response).await?;
            if status.is_server_error() {
                return Err(classify_http_status(status.as_u16(), &body));
            }
            let wrapped = serde_json::from_str::<WrappedError>(&body)
                .map_err(|error| invalid_response(error, &body))?;
            return Err(map_api_error(status, wrapped.error));
        }
        let content_type = response.headers().get(reqwest::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.split(';').next())
            .map(str::trim);
        if content_type.is_some_and(|value| !value.eq_ignore_ascii_case("text/event-stream")) {
            let body = read_body(response).await?;
            return Err(AiError::InvalidResponse(format!(
                "expected an SSE response\n\n{body}"
            )));
        }

        Ok(Box::new(Box::pin(stream_events(response))))
    }
}

async fn execute_http_request(
    http: reqwest::Client,
    request: HttpRequestFactory,
    last_error: Option<RetryError>,
) -> Result<reqwest::Response, OpenAIError> {
    let service = service_fn(move |request| {
        let transport = ReqwestService::new(http.clone());
        let last_error = last_error.clone();
        async move {
            let response = transport.oneshot(request).await?;
            if let Some(last_error) = last_error {
                return remember_retryable_error(response, &last_error).await;
            }
            Ok(response)
        }
    });
    let response = OpenAIRetryLayer::default()
        .layer(service)
        .oneshot(request)
        .await;
    let response = match response {
        // The retry layer deserializes only 429 responses and drops their status if parsing fails.
        Err(OpenAIError::JSONDeserialize(_, body)) => {
            return Err(unstructured_http_error(StatusCode::TOO_MANY_REQUESTS, &body));
        }
        other => other?,
    };

    let status = response.status();
    if !matches!(
        status,
        StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN | StatusCode::REQUEST_TIMEOUT
    ) {
        return Ok(response);
    }
    let bytes = response.bytes().await.map_err(OpenAIError::Reqwest)?;
    match serde_json::from_slice::<WrappedError>(&bytes) {
        Ok(wrapped) => Err(OpenAIError::ApiError(ApiErrorResponse {
            status_code: status,
            api_error: wrapped.error,
        })),
        Err(_) => Err(unstructured_http_error(status, &String::from_utf8_lossy(&bytes))),
    }
}

// Keep the last HTTP failure available if the connect deadline expires in the retry layer.
async fn remember_retryable_error(
    response: reqwest::Response,
    last_error: &RetryError,
) -> Result<reqwest::Response, OpenAIError> {
    let status = response.status();
    if status != StatusCode::TOO_MANY_REQUESTS && !status.is_server_error() {
        *last_error.lock().unwrap() = None;
        return Ok(response);
    }

    // Each attempt owns its diagnostic so a discarded response cannot overwrite a later one.
    let diagnostic = Arc::new(Mutex::new(classify_http_status(
        status.as_u16(),
        &format!("HTTP {}", status.as_u16()),
    )));
    *last_error.lock().unwrap() = Some(diagnostic.clone());
    let headers = response.headers().clone();
    let version = response.version();
    let body = if status.is_server_error() {
        // The SDK decides whether to retry 5xx from its headers. Read the body separately so
        // a stalled body cannot stop the next attempt. Dropping the response stops that read.
        let reader = AbortOnDropHandle::new(tokio::spawn(async move {
            let bytes = response.bytes().await?;
            *diagnostic.lock().unwrap() =
                classify_http_status(status.as_u16(), &String::from_utf8_lossy(&bytes));
            Ok::<_, reqwest::Error>(bytes)
        }));
        reqwest::Body::wrap_stream(futures::stream::once(async move {
            reader
                .await
                .map_err(std::io::Error::other)?
                .map_err(std::io::Error::other)
        }))
    } else {
        // The SDK also reads 429 bodies before retrying to check for exhausted quota.
        let bytes = response.bytes().await.map_err(OpenAIError::Reqwest)?;
        *diagnostic.lock().unwrap() = match serde_json::from_slice::<WrappedError>(&bytes) {
            Ok(wrapped) => map_api_error(status, wrapped.error),
            Err(_) => map_openai_error(unstructured_http_error(
                status,
                &String::from_utf8_lossy(&bytes),
            )),
        };
        reqwest::Body::from(bytes)
    };

    let mut response = tauri::http::Response::new(body);
    *response.status_mut() = status;
    *response.version_mut() = version;
    *response.headers_mut() = headers;
    Ok(response.into())
}

fn unstructured_http_error(status: StatusCode, body: &str) -> OpenAIError {
    let message = if body.is_empty() {
        format!("HTTP {}", status.as_u16())
    } else {
        format!("HTTP {}\n\n{body}", status.as_u16())
    };
    OpenAIError::ApiError(ApiErrorResponse {
        status_code: status,
        api_error: ApiError {
            message,
            r#type: None,
            param: None,
            code: None,
        },
    })
}

async fn read_body(response: reqwest::Response) -> Result<String, AiError> {
    let bytes = response
        .bytes()
        .await
        .map_err(|error| map_openai_error(error.into()))?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

fn stream_events(
    response: reqwest::Response,
) -> impl futures::Stream<Item = Result<AiStreamEvent, AiError>> {
    // The SDK's typed stream hides [DONE], so it cannot distinguish it from an early EOF.
    let events = response.bytes_stream().eventsource();
    futures::stream::try_unfold((events, false), |(mut events, mut saw_finish)| async move {
        while let Some(event) = events.next().await {
            let event = event.map_err(|error| match error {
                EventStreamError::Transport(_) => AiError::StreamInterrupted(error.to_string()),
                EventStreamError::Utf8(ref utf8) => AiError::InvalidResponse(format!(
                    "{error}\n\n{}", String::from_utf8_lossy(utf8.as_bytes())
                )),
                EventStreamError::Parser(_) => AiError::InvalidResponse(error.to_string()),
            })?;
            if event.event != "error" && event.data == "[DONE]" {
                return Ok(None);
            }
            if event.event == "keepalive" {
                continue;
            }
            let chunk = parse_stream_chunk(&event.data, event.event == "error")?;
            saw_finish |= chunk
                .choices
                .first()
                .is_some_and(|choice| choice.finish_reason.is_some());
            if let Some(delta) = chunk_to_stream_event(&chunk) {
                return Ok(Some((delta, (events, saw_finish))));
            }
        }
        if saw_finish {
            return Ok(None);
        }
        Err(AiError::StreamInterrupted(
            "stream ended without a completion marker".to_string(),
        ))
    })
}

fn parse_stream_chunk(
    data: &str,
    is_error_event: bool,
) -> Result<CreateChatCompletionStreamResponse, AiError> {
    if is_error_event {
        let error = serde_json::from_str::<WrappedError>(data)
            .map(|wrapped| wrapped.error)
            .or_else(|_| serde_json::from_str::<ApiError>(data))
            .map_err(|error| invalid_response(error, data))?;
        return Err(map_stream_api_error(error, data));
    }

    serde_json::from_str(data).map_err(|parse_error| {
        match serde_json::from_str::<WrappedError>(data) {
            Ok(wrapped) => map_stream_api_error(wrapped.error, data),
            Err(_) => invalid_response(parse_error, data),
        }
    })
}

fn is_quota_code(code: &str) -> bool {
    matches!(
        code,
        "insufficient_quota"
            | "credit_balance_exhausted"
            | "organization_spend_limit_exceeded"
            | "project_spend_limit_exceeded"
            | "organization_usage_limit_exceeded"
    )
}

fn api_error_kind(code: &str) -> Option<fn(String) -> AiError> {
    Some(match code {
        "invalid_project" => AiError::InvalidProject,
        "invalid_api_key" | "authentication_error" => AiError::AuthenticationFailed,
        "permission_denied" | "permission_error" => AiError::PermissionDenied,
        "model_not_found" => AiError::ModelNotFound,
        "invalid_request_error" => AiError::InvalidConfiguration,
        "rate_limit_exceeded" | "rate_limit_error" | "slow_down" => AiError::RateLimited,
        code if is_quota_code(code) => AiError::QuotaExceeded,
        "request_timeout" | "timeout" => AiError::Timeout,
        "server_error" | "internal_error" | "internal_server_error" | "server_is_overloaded"
        | "server_overloaded" | "service_unavailable_error" => AiError::ServerError,
        _ => return None,
    })
}

fn map_stream_api_error(error: ApiError, data: &str) -> AiError {
    let kind = error
        .code
        .as_deref()
        .and_then(api_error_kind)
        .or_else(|| error.r#type.as_deref().and_then(api_error_kind))
        .unwrap_or(AiError::Unknown);
    kind(data.to_owned())
}

fn invalid_response(error: serde_json::Error, body: &str) -> AiError {
    AiError::InvalidResponse(format!("{error}\n\n{body}"))
}

fn map_api_error(status: reqwest::StatusCode, error: ApiError) -> AiError {
    let code = error.code.as_deref().filter(|code| !code.is_empty());
    let detail = match code {
        Some(code) => format!("{}\n\ncode: {code}", error.message),
        None => error.message,
    };
    if code == Some("invalid_project") {
        return AiError::InvalidProject(detail);
    }
    if status == reqwest::StatusCode::TOO_MANY_REQUESTS {
        let quota_exceeded = code.is_some_and(is_quota_code)
            || (code.and_then(api_error_kind).is_none()
                && error.r#type.as_deref().is_some_and(is_quota_code));
        if quota_exceeded {
            return AiError::QuotaExceeded(detail);
        }
    }
    classify_http_status(status.as_u16(), &detail)
}

fn map_openai_error(error: OpenAIError) -> AiError {
    match error {
        OpenAIError::ApiError(error) => map_api_error(error.status_code, error.api_error),
        OpenAIError::Reqwest(reqwest_error) => {
            if reqwest_error.is_timeout() {
                AiError::Timeout(reqwest_error.to_string())
            } else if reqwest_error.is_connect() {
                AiError::ConnectionFailed(reqwest_error.to_string())
            } else {
                AiError::Unknown(reqwest_error.to_string())
            }
        }
        OpenAIError::JSONDeserialize(error, body) => {
            invalid_response(error, &body)
        }
        OpenAIError::InvalidArgument(message) => {
            AiError::InvalidConfiguration(message)
        }
        other => AiError::Unknown(other.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai::types::AiRole;

    fn sample_request() -> AiRequest {
        AiRequest {
            messages: vec![
                AiMessage::new(AiRole::System, "You are helpful."),
                AiMessage::new(AiRole::User, "Hello"),
            ],
            temperature: Some(0.7),
            max_output_tokens: Some(4096),
        }
    }

    #[test]
    #[allow(deprecated)]
    fn maps_application_request_to_openai_request() {
        let provider = OpenAiCompatibleProvider::new("http://localhost:11434/v1", None);
        let request = provider
            .to_openai_request("qwen2.5", &sample_request(), false)
            .unwrap();
        assert_eq!(request.model, "qwen2.5");
        assert_eq!(request.messages.len(), 2);
        assert_eq!(request.temperature, Some(0.7));
        assert_eq!(request.max_tokens, Some(4096));
        assert_eq!(request.stream, None);
    }

    #[test]
    fn maps_streaming_request_with_stream_flag() {
        let provider = OpenAiCompatibleProvider::new("http://localhost:11434/v1", None);
        let request = provider
            .to_openai_request("qwen2.5", &sample_request(), true)
            .unwrap();
        assert_eq!(request.stream, Some(true));
    }

    #[test]
    fn configured_model_is_retained_for_provider_requests() {
        let provider = OpenAiCompatibleProvider::new("http://localhost:11434/v1", None)
            .with_model("configured-model");
        assert_eq!(provider.model, "configured-model");
    }

    #[test]
    #[allow(deprecated)]
    fn maps_openai_response_to_application_response() {
        let json = r#"{
            "id": "chatcmpl-1",
            "object": "chat.completion",
            "created": 1,
            "model": "qwen2.5",
            "choices": [{
                "index": 0,
                "message": { "role": "assistant", "content": "hi" },
                "finish_reason": "stop"
            }]
        }"#;
        let response: async_openai::types::chat::CreateChatCompletionResponse =
            serde_json::from_str(json).unwrap();
        let mapped = from_openai_response(response).unwrap();
        assert_eq!(mapped.content, "hi");
    }

    #[test]
    fn maps_empty_response_to_invalid_response_error() {
        let json = r#"{
            "id": "chatcmpl-1",
            "object": "chat.completion",
            "created": 1,
            "model": "qwen2.5",
            "choices": []
        }"#;
        let response: async_openai::types::chat::CreateChatCompletionResponse =
            serde_json::from_str(json).unwrap();
        assert!(matches!(
            from_openai_response(response),
            Err(AiError::InvalidResponse(_))
        ));
    }

    #[test]
    fn extracts_content_delta_from_chunk() {
        let json = r#"{
            "id": "chatcmpl-1",
            "object": "chat.completion.chunk",
            "created": 1,
            "model": "qwen2.5",
            "choices": [{
                "index": 0,
                "delta": { "content": "hello" },
                "finish_reason": null
            }]
        }"#;
        let chunk: async_openai::types::chat::CreateChatCompletionStreamResponse =
            serde_json::from_str(json).unwrap();
        assert_eq!(delta_content_from_chunk(&chunk).as_deref(), Some("hello"));
    }

    #[test]
    fn ignores_chunk_without_content() {
        let json = r#"{
            "id": "chatcmpl-1",
            "object": "chat.completion.chunk",
            "created": 1,
            "model": "qwen2.5",
            "choices": [{
                "index": 0,
                "delta": { "role": "assistant" },
                "finish_reason": null
            }]
        }"#;
        let chunk: async_openai::types::chat::CreateChatCompletionStreamResponse =
            serde_json::from_str(json).unwrap();
        assert_eq!(delta_content_from_chunk(&chunk), None);
    }

    #[test]
    fn ignores_empty_content_chunk() {
        let json = r#"{
            "id": "chatcmpl-1",
            "object": "chat.completion.chunk",
            "created": 1,
            "model": "qwen2.5",
            "choices": [{
                "index": 0,
                "delta": { "content": "" },
                "finish_reason": null
            }]
        }"#;
        let chunk: async_openai::types::chat::CreateChatCompletionStreamResponse =
            serde_json::from_str(json).unwrap();
        assert_eq!(delta_content_from_chunk(&chunk), None);
    }

    #[test]
    fn preserves_whitespace_only_content() {
        let chunk = serde_json::from_value(serde_json::json!({
            "id": "chatcmpl-1",
            "object": "chat.completion.chunk",
            "created": 1,
            "model": "qwen2.5",
            "choices": [{"index": 0, "delta": {"content": "\n  "}, "finish_reason": null}]
        })).unwrap();
        assert_eq!(delta_content_from_chunk(&chunk).as_deref(), Some("\n  "));
    }

    #[test]
    fn maps_chunk_with_content_to_delta_event() {
        let json = r#"{
            "id": "chatcmpl-1",
            "object": "chat.completion.chunk",
            "created": 1,
            "model": "qwen2.5",
            "choices": [{
                "index": 0,
                "delta": { "content": "hello" },
                "finish_reason": null
            }]
        }"#;
        let chunk: async_openai::types::chat::CreateChatCompletionStreamResponse =
            serde_json::from_str(json).unwrap();
        let event = chunk_to_stream_event(&chunk);
        assert!(matches!(
            event,
            Some(AiStreamEvent::Delta { content, .. }) if content == "hello"
        ));
    }

    #[test]
    fn skips_chunk_without_content_in_stream_mapping() {
        let json = r#"{
            "id": "chatcmpl-1",
            "object": "chat.completion.chunk",
            "created": 1,
            "model": "qwen2.5",
            "choices": [{
                "index": 0,
                "delta": { "role": "assistant" },
                "finish_reason": null
            }]
        }"#;
        let chunk: async_openai::types::chat::CreateChatCompletionStreamResponse =
            serde_json::from_str(json).unwrap();
        assert!(chunk_to_stream_event(&chunk).is_none());
    }

    #[test]
    fn maps_api_error_to_http_status_classification() {
        let api_error = async_openai::error::ApiErrorResponse {
            status_code: reqwest::StatusCode::UNAUTHORIZED,
            api_error: async_openai::error::ApiError {
                message: "bad key".to_string(),
                r#type: None,
                param: None,
                code: None,
            },
        };
        let mapped = map_openai_error(async_openai::error::OpenAIError::ApiError(api_error));
        assert!(matches!(mapped, AiError::AuthenticationFailed(_)));
    }

    #[test]
    fn maps_429_to_rate_limited() {
        let api_error = async_openai::error::ApiErrorResponse {
            status_code: reqwest::StatusCode::TOO_MANY_REQUESTS,
            api_error: async_openai::error::ApiError {
                message: "slow down".to_string(),
                r#type: None,
                param: None,
                code: None,
            },
        };
        let mapped = map_openai_error(async_openai::error::OpenAIError::ApiError(api_error));
        assert!(matches!(mapped, AiError::RateLimited(_)));
    }

    #[test]
    fn distinguishes_quota_errors_from_temporary_rate_limits() {
        let cases = [
            (Some("credit_balance_exhausted"), None, true),
            (Some("organization_spend_limit_exceeded"), None, true),
            (Some("project_spend_limit_exceeded"), None, true),
            (Some("organization_usage_limit_exceeded"), None, true),
            (Some("insufficient_quota"), None, true),
            (None, Some("insufficient_quota"), true),
            (Some("slow_down"), Some("insufficient_quota"), false),
            (Some("rate_limit_exceeded"), None, false),
            (None, None, false),
        ];
        for (code, error_type, quota_exceeded) in cases {
            let error = ApiError {
                message: "upstream message".to_owned(),
                r#type: error_type.map(str::to_owned),
                param: None,
                code: code.map(str::to_owned),
            };
            let detail = code.map_or_else(
                || "upstream message".to_owned(),
                |code| format!("upstream message\n\ncode: {code}"),
            );
            let expected = if quota_exceeded {
                AiError::QuotaExceeded(detail)
            } else {
                AiError::RateLimited(detail)
            };
            assert_eq!(
                map_api_error(reqwest::StatusCode::TOO_MANY_REQUESTS, error),
                expected
            );
        }
    }

    #[test]
    fn maps_500_to_server_error() {
        let api_error = async_openai::error::ApiErrorResponse {
            status_code: reqwest::StatusCode::INTERNAL_SERVER_ERROR,
            api_error: async_openai::error::ApiError {
                message: "boom".to_string(),
                r#type: None,
                param: None,
                code: None,
            },
        };
        let mapped = map_openai_error(async_openai::error::OpenAIError::ApiError(api_error));
        assert!(matches!(mapped, AiError::ServerError(_)));
    }

    #[test]
    fn maps_404_to_model_not_found() {
        let api_error = async_openai::error::ApiErrorResponse {
            status_code: reqwest::StatusCode::NOT_FOUND,
            api_error: async_openai::error::ApiError {
                message: "missing".to_string(),
                r#type: None,
                param: None,
                code: None,
            },
        };
        let mapped = map_openai_error(async_openai::error::OpenAIError::ApiError(api_error));
        assert!(matches!(mapped, AiError::ModelNotFound(_)));
    }

    #[test]
    fn maps_403_to_permission_denied() {
        let api_error = async_openai::error::ApiErrorResponse {
            status_code: reqwest::StatusCode::FORBIDDEN,
            api_error: async_openai::error::ApiError {
                message: "denied".to_string(),
                r#type: None,
                param: None,
                code: None,
            },
        };
        let mapped = map_openai_error(async_openai::error::OpenAIError::ApiError(api_error));
        assert!(matches!(mapped, AiError::PermissionDenied(_)));
    }

    #[test]
    fn maps_400_to_invalid_configuration() {
        let api_error = async_openai::error::ApiErrorResponse {
            status_code: reqwest::StatusCode::BAD_REQUEST,
            api_error: async_openai::error::ApiError {
                message: "bad request".to_string(),
                r#type: None,
                param: None,
                code: None,
            },
        };
        let mapped = map_openai_error(async_openai::error::OpenAIError::ApiError(api_error));
        assert!(matches!(mapped, AiError::InvalidConfiguration(_)));
    }

    #[test]
    fn retains_the_body_of_an_invalid_response() {
        let body = "<html>Unexpected response</html>";
        let error = serde_json::from_str::<serde_json::Value>(body).unwrap_err();
        let mapped = map_openai_error(OpenAIError::JSONDeserialize(error, body.to_string()));
        assert!(matches!(mapped, AiError::InvalidResponse(detail) if detail.ends_with(body)));
    }
}
