/// AI 設定の保存と API Key の安全な保存を扱う。
/// 設定本体は JSON として保存し、API Key は OS の credential store に保存する。
use std::path::{Path, PathBuf};

use crate::ai::config::{AiConfig, validate_config};

const SERVICE_NAME: &str = "maca-editor";
const KEY_ENTRY: &str = "ai-api-key";

/// AI 設定を保存する。
/// API Key は keyring に保存し、設定 JSON には保存しない。
pub fn save_ai_config(config: &AiConfig) -> Result<(), String> {
    validate_config(config).map_err(|e| e.to_string())?;

    // 設定本体（API Key を除く）を JSON として保存
    let mut persisted = config.clone();
    persisted.api_key = None;
    let json = serde_json::to_string_pretty(&persisted).map_err(|e| e.to_string())?;
    let path = ai_config_path();

    if let Some(key) = &config.api_key {
        let entry = keyring::Entry::new(SERVICE_NAME, KEY_ENTRY).map_err(|e| e.to_string())?;
        if key.trim().is_empty() {
            return save_without_api_key(&path, &json, &entry);
        }
        entry.set_password(key).map_err(|e| e.to_string())?;
    }
    std::fs::write(path, json).map_err(|e| e.to_string())
}

fn save_without_api_key(path: &Path, json: &str, entry: &keyring::Entry) -> Result<(), String> {
    let previous_key = match entry.get_secret() {
        Ok(secret) => match entry.delete_credential() {
            Ok(()) => Some(secret),
            Err(keyring::Error::NoEntry) => None,
            Err(error) => return Err(error.to_string()),
        },
        Err(keyring::Error::NoEntry) => None,
        Err(error) => return Err(error.to_string()),
    };

    if let Err(error) = std::fs::write(path, json) {
        if let Some(secret) = previous_key {
            entry
                .set_secret(&secret)
                .map_err(|restore_error| format!("{error}\n{restore_error}"))?;
        }
        return Err(error.to_string());
    }
    Ok(())
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

/// Checks whether the saved settings can be used without reading the API key.
pub fn has_ai_configuration() -> Result<bool, String> {
    let json = match std::fs::read_to_string(ai_config_path()) {
        Ok(json) => json,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(error) => return Err(error.to_string()),
    };
    let config: AiConfig = serde_json::from_str(&json).map_err(|error| error.to_string())?;
    Ok(validate_config(&config).is_ok())
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
    fn saves_an_explicit_blank_without_a_credential_and_retries_cleanly() {
        let path =
            std::env::temp_dir().join(format!("maca-ai-config-{}.json", uuid::Uuid::new_v4()));
        let entry =
            keyring::Entry::new_with_credential(Box::new(keyring::mock::MockCredential::default()));
        entry.set_password("test credential").unwrap();

        save_without_api_key(&path, "test configuration", &entry).unwrap();
        save_without_api_key(&path, "updated configuration", &entry).unwrap();

        assert!(matches!(entry.get_secret(), Err(keyring::Error::NoEntry)));
        assert_eq!(
            std::fs::read_to_string(&path).unwrap(),
            "updated configuration"
        );
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn restores_the_credential_when_saving_an_explicit_blank_fails() {
        let missing_parent =
            std::env::temp_dir().join(format!("maca-ai-config-{}", uuid::Uuid::new_v4()));
        let path = missing_parent.join("config.json");
        let entry =
            keyring::Entry::new_with_credential(Box::new(keyring::mock::MockCredential::default()));
        entry.set_password("test credential").unwrap();

        assert!(save_without_api_key(&path, "test configuration", &entry).is_err());
        assert_eq!(entry.get_password().unwrap(), "test credential");
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
