use crate::ai::error::AiError;
use crate::ai::types::{AiRequest, AiResponse, AiStreamEvent};
use futures::Stream;

/// AI Provider の抽象境界。
/// `async-openai` 固有の型はこの trait の実装内部に閉じ込める。
/// native async trait を意図的に使用するため、`async_fn_in_trait` 警告を抑制する。
#[allow(async_fn_in_trait)]
pub trait AiProvider {
    async fn complete(
        &self,
        request: AiRequest,
    ) -> Result<AiResponse, AiError>;

    /// ストリーミング応答を返す。
    /// 既定実装は非対応としてエラーを返す。
    async fn stream(
        &self,
        _request: AiRequest,
    ) -> Result<Box<dyn Stream<Item = Result<AiStreamEvent, AiError>> + Send + Unpin>, AiError> {
        Err(AiError::InvalidConfiguration(
            "streaming is not supported".to_string(),
        ))
    }
}
