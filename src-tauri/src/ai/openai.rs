/// OpenAI Compatible Provider。
/// `async-openai` はこの実装内部に閉じ込め、
/// アプリケーション層へは MaCa Editor 独自型のみを公開する。
use async_openai::types::chat::{
    ChatCompletionRequestAssistantMessage, ChatCompletionRequestAssistantMessageContent,
    ChatCompletionRequestMessage, ChatCompletionRequestSystemMessage,
    ChatCompletionRequestSystemMessageContent, ChatCompletionRequestUserMessage,
    ChatCompletionRequestUserMessageContent, CreateChatCompletionRequest,
    CreateChatCompletionRequestArgs,
};

use crate::ai::error::{classify_http_status, AiError};
use crate::ai::types::{AiMessage, AiRequest, AiResponse, AiRole, AiStreamEvent};

/// OpenAI Compatible API へ接続する Provider。
pub struct OpenAiCompatibleProvider {
    client: async_openai::Client<async_openai::config::OpenAIConfig>,
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
        Self {
            client: async_openai::Client::with_config(config),
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
    chunk: &async_openai::types::chat::CreateChatCompletionStreamResponse,
) -> Option<String> {
    let content = chunk.choices.first()?.delta.content.clone()?;
    if content.trim().is_empty() {
        return None;
    }
    Some(content)
}

/// stream chunk を `AiStreamEvent::Delta` へ変換する。
/// content が無い chunk（role のみ・finish chunk・空 chunk）は None を返し、
/// UI へは実際に content がある chunk のみを流す。
fn chunk_to_stream_event(
    chunk: &async_openai::types::chat::CreateChatCompletionStreamResponse,
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

    async fn stream(
        &self,
        request: AiRequest,
    ) -> Result<Box<dyn futures::Stream<Item = Result<AiStreamEvent, AiError>> + Send + Unpin>, AiError> {
        let openai_request = self.to_openai_request(&self.model, &request, true)?;
        let stream = self
            .client
            .chat()
            .create_stream(openai_request)
            .await
            .map_err(map_openai_error)?;
        use futures::StreamExt;
        let filtered = stream.filter_map(|item| {
            let mapped = item.map_err(map_openai_error);
            async move {
                match mapped {
                    Ok(chunk) => chunk_to_stream_event(&chunk).map(Ok),
                    Err(error) => Some(Err(error)),
                }
            }
        });
        Ok(Box::new(Box::pin(filtered)))
    }
}

fn map_openai_error(error: async_openai::error::OpenAIError) -> AiError {
    match error {
        async_openai::error::OpenAIError::ApiError(api_error) => {
            classify_http_status(
                api_error.status_code.as_u16(),
                &api_error.api_error.message,
            )
        }
        async_openai::error::OpenAIError::Reqwest(reqwest_error) => {
            if reqwest_error.is_timeout() {
                AiError::Timeout(reqwest_error.to_string())
            } else if reqwest_error.is_connect() {
                AiError::ConnectionFailed(reqwest_error.to_string())
            } else {
                AiError::Unknown(reqwest_error.to_string())
            }
        }
        async_openai::error::OpenAIError::JSONDeserialize(_, _) => {
            AiError::InvalidResponse("invalid api response".to_string())
        }
        async_openai::error::OpenAIError::InvalidArgument(message) => {
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
}
