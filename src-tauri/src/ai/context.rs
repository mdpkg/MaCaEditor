/// 将来 `.mdpkg` 全体を AI へ渡すための context 抽象の土台。
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct AiContextFile {
    pub path: String,
    pub content: String,
}

impl AiContextFile {
    pub fn new(path: impl Into<String>, content: impl Into<String>) -> Self {
        Self {
            path: path.into(),
            content: content.into(),
        }
    }
}

/// AI リクエストに添える文脈情報。
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct AiRequestContext {
    pub current_document: Option<String>,
    pub selected_text: Option<String>,
    pub cursor_context: Option<String>,
    pub package_files: Vec<AiContextFile>,
}

impl AiRequestContext {
    pub fn new() -> Self {
        Self {
            current_document: None,
            selected_text: None,
            cursor_context: None,
            package_files: Vec::new(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn context_starts_empty() {
        let ctx = AiRequestContext::new();
        assert!(ctx.current_document.is_none());
        assert!(ctx.selected_text.is_none());
        assert!(ctx.package_files.is_empty());
    }

    #[test]
    fn context_can_hold_package_files() {
        let mut ctx = AiRequestContext::new();
        ctx.package_files.push(AiContextFile::new("README.md", "# hi"));
        assert_eq!(ctx.package_files.len(), 1);
    }

    #[test]
    fn context_can_hold_selection_and_cursor() {
        let mut ctx = AiRequestContext::new();
        ctx.selected_text = Some("selected".to_string());
        ctx.cursor_context = Some("cursor".to_string());
        assert_eq!(ctx.selected_text.as_deref(), Some("selected"));
        assert_eq!(ctx.cursor_context.as_deref(), Some("cursor"));
    }
}
