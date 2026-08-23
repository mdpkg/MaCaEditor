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

/// ストリーミング中のイベント。
/// request ID で複数 request を区別できるようにする。
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AiStreamEvent {
    Started {
        request_id: String,
    },
    Delta {
        request_id: String,
        content: String,
    },
    Completed {
        request_id: String,
    },
    Error {
        request_id: String,
        error: crate::ai::error::AiError,
    },
    Cancelled {
        request_id: String,
    },
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

    #[test]
    fn stream_event_serializes_with_type_tag() {
        let event = AiStreamEvent::Delta {
            request_id: "r1".to_string(),
            content: "hi".to_string(),
        };
        let json = serde_json::to_string(&event).unwrap();
        assert!(json.contains("\"type\":\"delta\""));
        assert!(json.contains("\"request_id\":\"r1\""));
    }

    #[test]
    fn stream_event_deserializes() {
        let json = r#"{"type":"completed","request_id":"r1"}"#;
        let event: AiStreamEvent = serde_json::from_str(json).unwrap();
        assert_eq!(
            event,
            AiStreamEvent::Completed {
                request_id: "r1".to_string()
            }
        );
    }
}
