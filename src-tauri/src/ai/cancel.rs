/// Atomic registration and bounded early-cancel / completed-ID retention.
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tokio_util::sync::CancellationToken;

const RETENTION: Duration = Duration::from_secs(60);
const MAX_RECENT: usize = 256;
#[derive(Default)]
struct State {
    tokens: HashMap<String, CancellationToken>,
    recent: HashMap<String, (Instant, bool)>, // true = cancelled before registration
}
impl State {
    fn prune(&mut self, now: Instant) {
        self.recent.retain(|_, (at, _)| now.saturating_duration_since(*at) < RETENTION);
        while self.recent.len() >= MAX_RECENT {
            let oldest = self.recent.iter().min_by_key(|(_, (at, _))| *at).map(|(id, _)| id.clone());
            if let Some(id) = oldest { self.recent.remove(&id); } else { break; }
        }
    }
}
pub struct CancellationRegistry { state: Mutex<State> }
impl CancellationRegistry {
    pub fn new() -> Self { Self { state: Mutex::new(State::default()) } }
    pub fn try_register(&self, id: String) -> Result<CancellationToken, ()> {
        let mut state = self.state.lock().unwrap();
        state.prune(Instant::now());
        if state.tokens.contains_key(&id) { return Err(()); }
        if let Some((_, cancelled)) = state.recent.get(&id) {
            if !cancelled { return Err(()); }
            state.recent.remove(&id);
            let token = CancellationToken::new();
            token.cancel();
            state.tokens.insert(id, token.clone());
            return Ok(token);
        }
        let token = CancellationToken::new();
        state.tokens.insert(id, token.clone());
        Ok(token)
    }
    /// Legacy callers receive an already-cancelled token on duplicate registration.
    pub fn register(&self, id: impl Into<String>) -> CancellationToken {
        self.try_register(id.into()).unwrap_or_else(|_| {
            let token = CancellationToken::new(); token.cancel(); token
        })
    }
    pub fn cancel(&self, id: &str) -> bool {
        let mut state = self.state.lock().unwrap();
        if let Some(token) = state.tokens.get(id) { token.cancel(); return true; }
        let now = Instant::now(); state.prune(now);
        state.recent.entry(id.into()).or_insert((now, true));
        false
    }
    pub fn unregister(&self, id: &str) {
        let mut state = self.state.lock().unwrap();
        state.tokens.remove(id);
        let now = Instant::now(); state.prune(now);
        state.recent.insert(id.into(), (now, false));
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

    #[test]
    fn register_returns_distinct_tokens_per_request() {
        let registry = CancellationRegistry::new();
        let token_a = registry.register("a");
        let token_b = registry.register("b");
        assert!(!std::ptr::eq(&token_a, &token_b));
        // 片方をキャンセルしても他方は影響されない
        assert!(registry.cancel("a"));
        assert!(token_a.is_cancelled());
        assert!(!token_b.is_cancelled());
    }
}

#[cfg(test)]
mod early_cancel_tests {
    use super::*;
    #[test]
    fn cancel_before_registration_prevents_work() {
        let registry = CancellationRegistry::new();
        registry.cancel("early");
        assert!(registry.register("early").is_cancelled());
    }
    #[test]
    fn duplicate_active_id_does_not_replace_original_token() {
        let registry = CancellationRegistry::new();
        let original = registry.register("id");
        let duplicate = registry.register("id");
        registry.cancel("id");
        assert!(original.is_cancelled());
        assert!(duplicate.is_cancelled());
    }
}


#[cfg(test)]
mod retention_tests {
    use super::*;
    #[test]
    fn bounded_retention_expires_without_sleep_and_late_cancel_cannot_reuse_completed_id() {
        let registry = CancellationRegistry::new();
        for n in 0..1000 { registry.cancel(&format!("early-{n}")); }
        assert!(registry.state.lock().unwrap().recent.len() <= MAX_RECENT);
        registry.register("done"); registry.unregister("done"); registry.cancel("done");
        assert!(registry.try_register("done".into()).is_err());
        let mut state = registry.state.lock().unwrap();
        let expired = Instant::now() - RETENTION;
        state.recent.insert("old".into(), (expired, true));
        state.prune(Instant::now());
        assert!(!state.recent.contains_key("old"));
    }
}
