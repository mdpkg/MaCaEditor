/// テスト用の Mock AI Provider。
/// ネットワークに接続せず、固定応答を返す。
pub struct MockAiProvider {
    response: String,
}

impl MockAiProvider {
    pub fn new(response: impl Into<String>) -> Self {
        Self {
            response: response.into(),
        }
    }
}

impl crate::ai::provider::AiProvider for MockAiProvider {
    async fn complete(
        &self,
        _request: crate::ai::types::AiRequest,
    ) -> Result<crate::ai::types::AiResponse, crate::ai::error::AiError> {
        Ok(crate::ai::types::AiResponse::new(self.response.clone()))
    }

    async fn stream(
        &self,
        _request: crate::ai::types::AiRequest,
    ) -> Result<
        Box<dyn futures::Stream<Item = Result<crate::ai::types::AiStreamEvent, crate::ai::error::AiError>> + Send + Unpin>,
        crate::ai::error::AiError,
    > {
        use futures::stream;
        let response = self.response.clone();
        let item: Result<crate::ai::types::AiStreamEvent, crate::ai::error::AiError> =
            Ok(crate::ai::types::AiStreamEvent::Delta {
                request_id: String::new(),
                content: response,
            });
        Ok(Box::new(stream::iter(vec![item])))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai::provider::AiProvider;
    use crate::ai::types::{AiMessage, AiRequest, AiRole};

    #[tokio::test]
    async fn returns_fixed_response() {
        let provider = MockAiProvider::new("mock answer");
        let request = AiRequest::new(vec![AiMessage::new(AiRole::User, "hi")]);
        let response = provider.complete(request).await.unwrap();
        assert_eq!(response.content, "mock answer");
    }
}
