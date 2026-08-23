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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai::types::AiRole;

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
