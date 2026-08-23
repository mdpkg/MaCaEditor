/// AI Provider の機能差を表す能力モデル。
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct AiProviderCapabilities {
    pub streaming: bool,
    pub model_listing: bool,
    pub json_schema: bool,
    pub tool_calling: bool,
    pub vision: bool,
}

impl AiProviderCapabilities {
    pub fn new(
        streaming: bool,
        model_listing: bool,
        json_schema: bool,
        tool_calling: bool,
        vision: bool,
    ) -> Self {
        Self {
            streaming,
            model_listing,
            json_schema,
            tool_calling,
            vision,
        }
    }

    /// OpenAI Compatible の既定能力。
    /// 実際のサーバーは機能差があるため、後続 Phase で検出を拡張できる。
    pub fn openai_compatible_default() -> Self {
        Self::new(true, true, false, false, false)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn openai_compatible_default_has_streaming_and_model_listing() {
        let caps = AiProviderCapabilities::openai_compatible_default();
        assert!(caps.streaming);
        assert!(caps.model_listing);
        assert!(!caps.json_schema);
        assert!(!caps.tool_calling);
        assert!(!caps.vision);
    }
}
