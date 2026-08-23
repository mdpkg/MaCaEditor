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
use crate::ai::types::{AiMessage, AiRequest, AiResponse, AiRole};

/// OpenAI Compatible API へ接続する Provider。
pub struct OpenAiCompatibleProvider {
    client: async_openai::Client<async_openai::config::OpenAIConfig>,
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
        }
    }

    fn to_openai_request(
        &self,
        model: &str,
        request: &AiRequest,
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

impl crate::ai::provider::AiProvider for OpenAiCompatibleProvider {
    async fn complete(
        &self,
        request: AiRequest,
    ) -> Result<AiResponse, AiError> {
        let model = "default";
        let openai_request = self.to_openai_request(model, &request)?;
        let response = self
            .client
            .chat()
            .create(openai_request)
            .await
            .map_err(map_openai_error)?;
        from_openai_response(response)
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
    fn maps_application_request_to_openai_request() {
        let provider = OpenAiCompatibleProvider::new("http://localhost:11434/v1", None);
        let request = provider
            .to_openai_request("qwen2.5", &sample_request())
            .unwrap();
        assert_eq!(request.model, "qwen2.5");
        assert_eq!(request.messages.len(), 2);
        assert_eq!(request.temperature, Some(0.7));
        assert_eq!(request.max_tokens, Some(4096));
    }

    #[test]
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
}
