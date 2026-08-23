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
