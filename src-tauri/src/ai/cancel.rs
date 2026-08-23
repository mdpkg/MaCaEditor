/// 実行中 AI request のキャンセル管理。
/// request ID から CancellationToken を引けるようにする。
use std::collections::HashMap;
use std::sync::Mutex;

use tokio_util::sync::CancellationToken;

pub struct CancellationRegistry {
    tokens: Mutex<HashMap<String, CancellationToken>>,
}

impl CancellationRegistry {
    pub fn new() -> Self {
        Self {
            tokens: Mutex::new(HashMap::new()),
        }
    }

    /// request ID を登録し、トークンを返す。
    pub fn register(&self, request_id: impl Into<String>) -> CancellationToken {
        let token = CancellationToken::new();
        self.tokens
            .lock()
            .unwrap()
            .insert(request_id.into(), token.clone());
        token
    }

    /// request ID を指定してキャンセルする。
    /// 存在しない ID は idempotent に成功扱いする。
    pub fn cancel(&self, request_id: &str) -> bool {
        let token = self.tokens.lock().unwrap().remove(request_id);
        match token {
            Some(token) => {
                token.cancel();
                true
            }
            None => false,
        }
    }

    /// 実行完了後に登録を解除する。
    pub fn unregister(&self, request_id: &str) {
        self.tokens.lock().unwrap().remove(request_id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn registers_and_cancels_request() {
        let registry = CancellationRegistry::new();
        let token = registry.register("r1");
        assert!(!token.is_cancelled());
        assert!(registry.cancel("r1"));
        assert!(token.is_cancelled());
    }

    #[test]
    fn cancelling_unknown_request_is_idempotent() {
        let registry = CancellationRegistry::new();
        assert!(!registry.cancel("missing"));
        assert!(!registry.cancel("missing"));
    }

    #[test]
    fn unregister_removes_token() {
        let registry = CancellationRegistry::new();
        registry.register("r1");
        registry.unregister("r1");
        assert!(!registry.cancel("r1"));
    }
}
