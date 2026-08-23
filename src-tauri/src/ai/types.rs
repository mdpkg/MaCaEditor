/// AI メッセージのロール。
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum AiRole {
    System,
    User,
    Assistant,
}

/// AI への 1 メッセージ。
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct AiMessage {
    pub role: AiRole,
    pub content: String,
}

impl AiMessage {
    pub fn new(role: AiRole, content: impl Into<String>) -> Self {
        Self {
            role,
            content: content.into(),
        }
    }
}

/// AI へのリクエスト。
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct AiRequest {
    pub messages: Vec<AiMessage>,
    pub temperature: Option<f32>,
    pub max_output_tokens: Option<u32>,
}

impl AiRequest {
    pub fn new(messages: Vec<AiMessage>) -> Self {
        Self {
            messages,
            temperature: None,
            max_output_tokens: None,
        }
    }
}

/// AI からの応答。
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct AiResponse {
    pub content: String,
}

impl AiResponse {
    pub fn new(content: impl Into<String>) -> Self {
        Self {
            content: content.into(),
        }
    }
}

/// ストリーミング中のチャンク。
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct AiDelta {
    pub content: String,
}

impl AiDelta {
    pub fn new(content: impl Into<String>) -> Self {
        Self {
            content: content.into(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_request_with_optional_parameters() {
        let req = AiRequest {
            messages: vec![AiMessage::new(AiRole::User, "hello")],
            temperature: Some(0.7),
            max_output_tokens: Some(4096),
        };
        assert_eq!(req.messages.len(), 1);
        assert_eq!(req.temperature, Some(0.7));
        assert_eq!(req.max_output_tokens, Some(4096));
    }

    #[test]
    fn builds_response() {
        let resp = AiResponse::new("hi");
        assert_eq!(resp.content, "hi");
    }
}
