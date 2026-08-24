/// AI タスクの種類。
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum AiTaskKind {
    Rewrite,
    Summarize,
    Proofread,
}

/// タスク固有の指示。
#[derive(Debug, Clone, PartialEq)]
pub struct TaskInstruction {
    pub system_prompt: String,
    pub instruction: String,
}

impl TaskInstruction {
    pub fn new(system_prompt: impl Into<String>, instruction: impl Into<String>) -> Self {
        Self {
            system_prompt: system_prompt.into(),
            instruction: instruction.into(),
        }
    }
}

/// Prompt を組み立てるビルダー。
/// system prompt / user input / context / task-specific instruction を区別して構築する。
pub struct PromptBuilder {
    system_prompt: String,
    user_input: String,
    context: String,
    instruction: String,
}

impl PromptBuilder {
    pub fn new() -> Self {
        Self {
            system_prompt: String::new(),
            user_input: String::new(),
            context: String::new(),
            instruction: String::new(),
        }
    }

    pub fn with_system_prompt(mut self, value: impl Into<String>) -> Self {
        self.system_prompt = value.into();
        self
    }

    pub fn with_user_input(mut self, value: impl Into<String>) -> Self {
        self.user_input = value.into();
        self
    }

    pub fn with_context(mut self, value: impl Into<String>) -> Self {
        self.context = value.into();
        self
    }

    pub fn with_instruction(mut self, value: impl Into<String>) -> Self {
        self.instruction = value.into();
        self
    }

    /// 組み立てたメッセージ列を返す。
    /// system prompt は System メッセージ、それ以外は User メッセージとして分離する。
    pub fn build(self) -> Vec<crate::ai::types::AiMessage> {
        let mut messages = Vec::new();
        if !self.system_prompt.trim().is_empty() {
            messages.push(crate::ai::types::AiMessage::new(
                crate::ai::types::AiRole::System,
                self.system_prompt,
            ));
        }
        let mut user_parts = Vec::new();
        if !self.context.trim().is_empty() {
            user_parts.push(format!("[context]\n{}", self.context.trim()));
        }
        if !self.instruction.trim().is_empty() {
            user_parts.push(format!("[instruction]\n{}", self.instruction.trim()));
        }
        if !self.user_input.trim().is_empty() {
            user_parts.push(self.user_input.trim().to_string());
        }
        if !user_parts.is_empty() {
            messages.push(crate::ai::types::AiMessage::new(
                crate::ai::types::AiRole::User,
                user_parts.join("\n\n"),
            ));
        }
        messages
    }
}

/// 選択テキストを対象とした AI タスクのリクエストを組み立てる。
/// task 固有の prompt はここで管理し、UI 層には置かない。
pub fn build_request(
    task: AiTaskKind,
    selected_text: &str,
) -> crate::ai::types::AiRequest {
    let (system_prompt, instruction) = match task {
        AiTaskKind::Rewrite => (
            "You are a professional editor that rewrites Markdown text while preserving meaning.",
            concat!(
                "Rewrite the selected Markdown text to be clearer and more natural without changing its meaning. ",
                "Preserve Markdown structure. Do not add headings, change code inside code blocks, or alter URLs. ",
                "Do not invent facts. Return only the rewritten text.",
            ),
        ),
        AiTaskKind::Summarize => (
            "You are a professional editor that summarizes Markdown text.",
            concat!(
                "Summarize the selected text while keeping important information. ",
                "If the original is a paragraph, return a short paragraph. If it is a list, preserve the structure where possible. ",
                "Do not convert everything to bullet points. Return only the summary.",
            ),
        ),
        AiTaskKind::Proofread => (
            "You are a professional proofreader for Markdown text.",
            concat!(
                "Fix typos, unnatural grammar, punctuation, inconsistent notation, and obvious readability issues. ",
                "Do not drastically summarize, change the overall style, add new facts, or unnecessarily change Markdown structure. ",
                "Return only the corrected text.",
            ),
        ),
    };
    let messages = PromptBuilder::new()
        .with_system_prompt(system_prompt)
        .with_user_input(selected_text)
        .with_instruction(instruction)
        .build();
    crate::ai::types::AiRequest::new(messages)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai::types::AiRole;

    fn user_content(request: &crate::ai::types::AiRequest) -> String {
        request
            .messages
            .iter()
            .find(|m| m.role == AiRole::User)
            .map(|m| m.content.clone())
            .unwrap_or_default()
    }

    fn system_content(request: &crate::ai::types::AiRequest) -> String {
        request
            .messages
            .iter()
            .find(|m| m.role == AiRole::System)
            .map(|m| m.content.clone())
            .unwrap_or_default()
    }

    #[test]
    fn rewrite_prompt_includes_selected_text() {
        let request = build_request(AiTaskKind::Rewrite, "hello world");
        assert!(user_content(&request).contains("hello world"));
    }

    #[test]
    fn rewrite_prompt_requests_meaning_preservation() {
        let request = build_request(AiTaskKind::Rewrite, "text");
        let instruction = user_content(&request);
        assert!(instruction.contains("without changing its meaning"));
        assert!(instruction.contains("Do not invent facts"));
    }

    #[test]
    fn rewrite_prompt_requests_markdown_preservation() {
        let request = build_request(AiTaskKind::Rewrite, "text");
        let instruction = user_content(&request);
        assert!(instruction.contains("Preserve Markdown structure"));
        assert!(instruction.contains("code blocks"));
    }

    #[test]
    fn rewrite_prompt_requests_result_only() {
        let request = build_request(AiTaskKind::Rewrite, "text");
        let instruction = user_content(&request);
        assert!(instruction.contains("Return only the rewritten text"));
    }

    #[test]
    fn summarize_prompt_requests_summary_and_preservation() {
        let request = build_request(AiTaskKind::Summarize, "text");
        let instruction = user_content(&request);
        assert!(instruction.contains("Summarize"));
        assert!(instruction.contains("keeping important information"));
        assert!(instruction.contains("preserve the structure"));
        assert!(instruction.contains("Return only the summary"));
    }

    #[test]
    fn proofread_prompt_requests_correction_without_rewrite() {
        let request = build_request(AiTaskKind::Proofread, "text");
        let instruction = user_content(&request);
        assert!(instruction.contains("Fix typos"));
        assert!(instruction.contains("Do not drastically summarize"));
        assert!(instruction.contains("add new facts"));
        assert!(instruction.contains("Return only the corrected text"));
    }

    #[test]
    fn build_request_has_system_prompt() {
        let request = build_request(AiTaskKind::Rewrite, "text");
        assert!(!system_content(&request).is_empty());
    }

    #[test]
    fn separates_system_prompt_from_user_input() {
        let messages = PromptBuilder::new()
            .with_system_prompt("You are a helpful editor.")
            .with_user_input("Rewrite this text.")
            .build();
        assert_eq!(messages.len(), 2);
        assert_eq!(messages[0].role, AiRole::System);
        assert_eq!(messages[1].role, AiRole::User);
        assert_eq!(messages[0].content, "You are a helpful editor.");
        assert_eq!(messages[1].content, "Rewrite this text.");
    }

    #[test]
    fn includes_context_and_instruction_in_user_message() {
        let messages = PromptBuilder::new()
            .with_system_prompt("sys")
            .with_user_input("text")
            .with_context("doc")
            .with_instruction("do it")
            .build();
        assert_eq!(messages.len(), 2);
        assert!(messages[1].content.contains("[context]"));
        assert!(messages[1].content.contains("[instruction]"));
        assert!(messages[1].content.contains("text"));
    }

    #[test]
    fn omits_empty_system_prompt() {
        let messages = PromptBuilder::new().with_user_input("hi").build();
        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0].role, AiRole::User);
    }

    #[test]
    fn omits_all_empty_parts() {
        let messages = PromptBuilder::new().build();
        assert!(messages.is_empty());
    }

    #[test]
    fn trims_whitespace_only_parts() {
        let messages = PromptBuilder::new()
            .with_system_prompt("   ")
            .with_user_input("  ")
            .with_context("  ")
            .with_instruction("  ")
            .build();
        assert!(messages.is_empty());
    }
}
