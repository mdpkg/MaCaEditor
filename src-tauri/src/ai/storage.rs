/// AI 設定の保存と API Key の安全な保存を扱う。
/// 設定本体は JSON として保存し、API Key は OS の credential store に保存する。
use std::path::PathBuf;

use crate::ai::config::{AiConfig, validate_config};

const SERVICE_NAME: &str = "maca-editor";
const KEY_ENTRY: &str = "ai-api-key";

/// AI 設定を保存する。
/// API Key は keyring に保存し、設定 JSON には保存しない。
pub fn save_ai_config(config: &AiConfig) -> Result<(), String> {
    validate_config(config).map_err(|e| e.to_string())?;

    // API Key を keyring に保存
    if let Some(key) = &config.api_key {
        if !key.trim().is_empty() {
            let entry = keyring::Entry::new(SERVICE_NAME, KEY_ENTRY)
                .map_err(|e| e.to_string())?;
            entry.set_password(key).map_err(|e| e.to_string())?;
        }
    }

    // 設定本体（API Key を除く）を JSON として保存
    let mut persisted = config.clone();
    persisted.api_key = None;
    let json = serde_json::to_string_pretty(&persisted).map_err(|e| e.to_string())?;
    std::fs::write(ai_config_path(), json).map_err(|e| e.to_string())
}

/// AI 設定を読み込む。
/// API Key は keyring から取得する。
pub fn load_ai_config() -> Result<AiConfig, String> {
    let json = std::fs::read_to_string(ai_config_path()).map_err(|e| e.to_string())?;
    let mut config: AiConfig =
        serde_json::from_str(&json).map_err(|e| e.to_string())?;
    config.api_key = load_api_key();
    Ok(config)
}

/// API Key を keyring から読み込む。
pub fn load_api_key() -> Option<String> {
    let entry = keyring::Entry::new(SERVICE_NAME, KEY_ENTRY).ok()?;
    entry.get_password().ok()
}

/// API Key を keyring から削除する。
pub fn delete_api_key() -> Result<(), String> {
    let entry = keyring::Entry::new(SERVICE_NAME, KEY_ENTRY)
        .map_err(|e| e.to_string())?;
    entry.delete_credential().map_err(|e| e.to_string())
}

fn ai_config_path() -> PathBuf {
    let dir = std::env::temp_dir();
    dir.join("maca-editor-ai-config.json")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn config_path_is_absolute() {
        assert!(ai_config_path().is_absolute());
    }

    #[test]
    fn provider_kind_serializes() {
        let json = serde_json::to_string(&crate::ai::config::AiProviderKind::OpenAiCompatible)
            .unwrap();
        assert_eq!(json, "\"OpenAiCompatible\"");
    }

    #[test]
    fn config_round_trips_through_json() {
        let config = crate::ai::config::AiConfig::new(
            crate::ai::config::AiProviderKind::OpenAiCompatible,
            "http://localhost:11434/v1".to_string(),
            None,
            "qwen2.5".to_string(),
            Some(0.7),
            Some(4096),
            Some(10),
            Some(300),
        );
        let json = serde_json::to_string(&config).unwrap();
        let decoded: crate::ai::config::AiConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(decoded, config);
    }
}
