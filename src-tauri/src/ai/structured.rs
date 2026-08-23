/// 構造化出力の拡張ポイント。
/// 将来、native structured output / prompt-based JSON / local parse の
/// fallback を追加できるようにするための抽象。
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct StructuredOutput {
    pub format: String,
    pub schema: Option<String>,
}

impl StructuredOutput {
    pub fn new(format: impl Into<String>, schema: Option<String>) -> Self {
        Self {
            format: format.into(),
            schema,
        }
    }

    pub fn json(schema: Option<String>) -> Self {
        Self::new("json", schema)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_json_structured_output() {
        let out = StructuredOutput::json(Some("{\"type\":\"object\"}".to_string()));
        assert_eq!(out.format, "json");
        assert!(out.schema.is_some());
    }

    #[test]
    fn builds_structured_output_without_schema() {
        let out = StructuredOutput::new("text", None);
        assert_eq!(out.format, "text");
        assert!(out.schema.is_none());
    }
}
