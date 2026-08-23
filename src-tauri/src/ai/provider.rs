use crate::ai::error::AiError;
use crate::ai::types::{AiRequest, AiResponse};

/// AI Provider の抽象境界。
/// `async-openai` 固有の型はこの trait の実装内部に閉じ込める。
pub trait AiProvider {
    async fn complete(
        &self,
        request: AiRequest,
    ) -> Result<AiResponse, AiError>;
}
