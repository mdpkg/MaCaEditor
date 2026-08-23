/// AI Provider の種類。
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum AiProviderKind {
    OpenAiCompatible,
}

/// AI 設定。
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct AiConfig {
    pub provider: AiProviderKind,
    pub base_url: String,
    pub api_key: Option<String>,
    pub model: String,
    pub temperature: Option<f32>,
    pub max_output_tokens: Option<u32>,
    pub connect_timeout_seconds: Option<u64>,
    pub request_timeout_seconds: Option<u64>,
}

impl AiConfig {
    pub fn new(
        provider: AiProviderKind,
        base_url: String,
        api_key: Option<String>,
        model: String,
        temperature: Option<f32>,
        max_output_tokens: Option<u32>,
        connect_timeout_seconds: Option<u64>,
        request_timeout_seconds: Option<u64>,
    ) -> Self {
        Self {
            provider,
            base_url,
            api_key,
            model,
            temperature,
            max_output_tokens,
            connect_timeout_seconds,
            request_timeout_seconds,
        }
    }
}

#[derive(Debug, PartialEq, thiserror::Error)]
pub enum ConfigError {
    #[error("base URL is empty")]
    EmptyBaseUrl,
    #[error("base URL must be an absolute URL with http or https scheme")]
    InvalidBaseUrl,
    #[error("model is empty")]
    EmptyModel,
    #[error("temperature must be between 0.0 and 2.0")]
    InvalidTemperature,
    #[error("timeout must be a positive number")]
    InvalidTimeout,
    #[error("timeout is too large")]
    TimeoutTooLarge,
}

/// Timeout の妥当な上限（秒）。ローカル LLM の遅さを考慮しつつ、誤設定を防ぐ。
pub const MAX_TIMEOUT_SECONDS: u64 = 3600;

/// AI 設定を検証する。
pub fn validate_config(config: &AiConfig) -> Result<(), ConfigError> {
    if config.base_url.trim().is_empty() {
        return Err(ConfigError::EmptyBaseUrl);
    }
    let url = tauri::Url::parse(config.base_url.trim())
        .map_err(|_| ConfigError::InvalidBaseUrl)?;
    match url.scheme() {
        "http" | "https" => {}
        _ => return Err(ConfigError::InvalidBaseUrl),
    }
    if config.model.trim().is_empty() {
        return Err(ConfigError::EmptyModel);
    }
    if let Some(t) = config.temperature {
        if !(0.0..=2.0).contains(&t) {
            return Err(ConfigError::InvalidTemperature);
        }
    }
    for timeout in [config.connect_timeout_seconds, config.request_timeout_seconds]
        .into_iter()
        .flatten()
    {
        if timeout == 0 {
            return Err(ConfigError::InvalidTimeout);
        }
        if timeout > MAX_TIMEOUT_SECONDS {
            return Err(ConfigError::TimeoutTooLarge);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn valid_config() -> AiConfig {
        AiConfig::new(
            AiProviderKind::OpenAiCompatible,
            "http://localhost:11434/v1".to_string(),
            None,
            "qwen2.5".to_string(),
            Some(0.7),
            Some(4096),
            Some(10),
            Some(300),
        )
    }

    #[test]
    fn accepts_valid_config() {
        assert!(validate_config(&valid_config()).is_ok());
    }

    #[test]
    fn accepts_https_base_url() {
        let mut c = valid_config();
        c.base_url = "https://api.openai.com/v1".to_string();
        assert!(validate_config(&c).is_ok());
    }

    #[test]
    fn rejects_empty_base_url() {
        let mut c = valid_config();
        c.base_url = "".to_string();
        assert_eq!(validate_config(&c), Err(ConfigError::EmptyBaseUrl));
    }

    #[test]
    fn rejects_non_http_scheme() {
        let mut c = valid_config();
        c.base_url = "ftp://example.com/v1".to_string();
        assert_eq!(validate_config(&c), Err(ConfigError::InvalidBaseUrl));
    }

    #[test]
    fn rejects_empty_model() {
        let mut c = valid_config();
        c.model = "".to_string();
        assert_eq!(validate_config(&c), Err(ConfigError::EmptyModel));
    }

    #[test]
    fn rejects_temperature_out_of_range() {
        let mut c = valid_config();
        c.temperature = Some(3.0);
        assert_eq!(validate_config(&c), Err(ConfigError::InvalidTemperature));
    }

    #[test]
    fn accepts_optional_api_key() {
        let c = valid_config();
        assert!(c.api_key.is_none());
        assert!(validate_config(&c).is_ok());
    }

    #[test]
    fn accepts_timeouts() {
        let c = valid_config();
        assert!(validate_config(&c).is_ok());
    }

    #[test]
    fn rejects_zero_timeout() {
        let mut c = valid_config();
        c.connect_timeout_seconds = Some(0);
        assert_eq!(validate_config(&c), Err(ConfigError::InvalidTimeout));
    }

    #[test]
    fn rejects_negative_timeout() {
        let mut c = valid_config();
        c.request_timeout_seconds = Some(u64::MAX);
        assert_eq!(validate_config(&c), Err(ConfigError::TimeoutTooLarge));
    }

    #[test]
    fn rejects_timeout_above_max() {
        let mut c = valid_config();
        c.connect_timeout_seconds = Some(MAX_TIMEOUT_SECONDS + 1);
        assert_eq!(validate_config(&c), Err(ConfigError::TimeoutTooLarge));
    }

    #[test]
    fn accepts_timeout_at_max() {
        let mut c = valid_config();
        c.request_timeout_seconds = Some(MAX_TIMEOUT_SECONDS);
        assert!(validate_config(&c).is_ok());
    }

    #[test]
    fn rejects_zero_request_timeout() {
        let mut c = valid_config();
        c.request_timeout_seconds = Some(0);
        assert_eq!(validate_config(&c), Err(ConfigError::InvalidTimeout));
    }
}
