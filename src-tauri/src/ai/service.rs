/// AiService。
/// 後続 Phase から利用される汎用 Chat Completion API を提供する。
use std::sync::Arc;

use crate::ai::error::AiError;
use crate::ai::provider::AiProvider;
use crate::ai::types::{AiRequest, AiResponse};

pub struct AiService<P: AiProvider> {
    provider: Arc<P>,
}

impl<P: AiProvider> AiService<P> {
    pub fn new(provider: P) -> Self {
        Self {
            provider: Arc::new(provider),
        }
    }

    pub async fn complete(&self, request: AiRequest) -> Result<AiResponse, AiError> {
        self.provider.complete(request).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai::mock::MockAiProvider;
    use crate::ai::types::{AiMessage, AiRole};

    #[tokio::test]
    async fn delegates_to_provider() {
        let service = AiService::new(MockAiProvider::new("answer"));
        let request = AiRequest::new(vec![AiMessage::new(AiRole::User, "hi")]);
        let response = service.complete(request).await.unwrap();
        assert_eq!(response.content, "answer");
    }
}
