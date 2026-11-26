/// AI 設定の保存と API Key の安全な保存を扱う。
/// 設定本体は JSON として保存し、API Key は OS の credential store に保存する。
use std::path::{Path, PathBuf};

use crate::ai::config::{AiConfig, validate_config};

const SERVICE_NAME: &str = "maca-editor";
const KEY_ENTRY: &str = "ai-api-key";
static CONFIG_ACCESS: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// AI 設定を保存する。
/// API Key は keyring に保存し、設定 JSON には保存しない。
pub fn save_ai_config(path: &Path, config: &AiConfig) -> Result<(), String> {
    validate_config(config).map_err(|e| e.to_string())?;

    // 設定本体（API Key を除く）を JSON として保存
    let mut persisted = config.clone();
    persisted.api_key = None;
    let json = serde_json::to_string_pretty(&persisted).map_err(|e| e.to_string())?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    if let Some(key) = &config.api_key {
        let entry = keyring::Entry::new(SERVICE_NAME, KEY_ENTRY).map_err(|e| e.to_string())?;
        if key.trim().is_empty() {
            return save_without_api_key(path, &json, &entry);
        }
        return commit_credential(&entry, key, || crate::atomic_save::atomic_save(path, json.as_bytes()).map_err(|error| error.to_string()));
    }
    let _access = CONFIG_ACCESS.lock().map_err(|_| "configuration access unavailable")?;
    crate::atomic_save::atomic_save(path, json.as_bytes()).map_err(|e| e.to_string())
}

fn save_without_api_key(path: &Path, json: &str, entry: &keyring::Entry) -> Result<(), String> {
    commit_credential(entry, "", || crate::atomic_save::atomic_save(path, json.as_bytes()).map_err(|error| error.to_string()))
}
fn commit_credential(entry: &keyring::Entry, key: &str, commit: impl FnOnce() -> Result<(), String>) -> Result<(), String> {
    let _access = CONFIG_ACCESS.lock().map_err(|_| "configuration access unavailable")?;
    let previous = match entry.get_secret() {
        Ok(secret) => Some(secret),
        Err(keyring::Error::NoEntry) => None,
        Err(error) => return Err(error.to_string()),
    };
    if key.trim().is_empty() {
        match entry.delete_credential() { Ok(()) | Err(keyring::Error::NoEntry) => {}, Err(error) => return Err(error.to_string()) }
    } else { entry.set_password(key).map_err(|error| error.to_string())?; }
    if let Err(error) = commit() {
        let restored = if let Some(secret) = previous { entry.set_secret(&secret) }
            else { match entry.delete_credential() { Ok(()) | Err(keyring::Error::NoEntry) => Ok(()), Err(error) => Err(error) } };
        if restored.is_err() {
            return Err("configuration save and credential rollback failed".into());
        }
        return Err(error);
    }
    Ok(())
}

/// AI 設定を読み込む。
/// API Key は keyring から取得する。
pub fn load_ai_config(path: &Path) -> Result<AiConfig, String> {
    read_snapshot(path, load_api_key)
}
fn read_snapshot(path: &Path, key: impl FnOnce() -> Option<String>) -> Result<AiConfig, String> {
    let _access = CONFIG_ACCESS.lock().map_err(|_| "configuration access unavailable")?;
    let json = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
    let mut config: AiConfig =
        serde_json::from_str(&json).map_err(|e| e.to_string())?;
    config.api_key = key();
    Ok(config)
}

/// Checks whether the saved settings can be used without reading the API key.
pub fn has_ai_configuration(path: &Path) -> Result<bool, String> {
    let json = match std::fs::read_to_string(path) {
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
    let _access = CONFIG_ACCESS.lock().map_err(|_| "configuration access unavailable")?;
    let entry = keyring::Entry::new(SERVICE_NAME, KEY_ENTRY)
        .map_err(|e| e.to_string())?;
    entry.delete_credential().map_err(|e| e.to_string())
}

pub fn ai_config_path(config_directory: &Path) -> PathBuf {
    config_directory.join("ai-config.json")
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn failed_nonblank_key_save_restores_the_previous_credential() {
        let entry = keyring::Entry::new_with_credential(Box::new(keyring::mock::MockCredential::default()));
        entry.set_password("old-key").unwrap();
        assert!(commit_credential(&entry, "new-key", || Err("cannot commit config".into())).is_err());
        assert_eq!(entry.get_password().unwrap(), "old-key");
    }
    #[test]
    fn a_config_reader_waits_for_the_entire_credential_and_json_commit() {
        use std::sync::{Arc, mpsc};
        let path = std::env::temp_dir().join(format!("maca-config-snapshot-{}.json", uuid::Uuid::new_v4()));
        let entry = Arc::new(keyring::Entry::new_with_credential(Box::new(keyring::mock::MockCredential::default())));
        entry.set_password("old-key").unwrap();
        let config = AiConfig::new(crate::ai::config::AiProviderKind::OpenAiCompatible, "https://old.test/v1".into(), None, "old-model".into(), None, None, None, None);
        std::fs::write(&path, serde_json::to_vec(&config).unwrap()).unwrap();
        let (entered_tx, entered_rx) = mpsc::channel(); let (release_tx, release_rx) = mpsc::channel();
        let writer_entry = entry.clone(); let writer_path = path.clone();
        let writer = std::thread::spawn(move || commit_credential(&writer_entry, "new-key", || {
            entered_tx.send(()).unwrap(); release_rx.recv().unwrap();
            let mut config = config; config.model = "new-model".into();
            std::fs::write(writer_path, serde_json::to_vec(&config).unwrap()).map_err(|error| error.to_string())
        }));
        entered_rx.recv().unwrap();
        let (read_tx, read_rx) = mpsc::channel(); let reader_entry = entry.clone(); let reader_path = path.clone();
        let reader = std::thread::spawn(move || { read_tx.send(read_snapshot(&reader_path, || reader_entry.get_password().ok())).unwrap(); });
        let early = read_rx.recv_timeout(std::time::Duration::from_millis(50));
        release_tx.send(()).unwrap(); writer.join().unwrap().unwrap();
        assert!(early.is_err());
        let loaded = read_rx.recv().unwrap().unwrap(); reader.join().unwrap();
        assert_eq!(loaded.model, "new-model"); assert_eq!(loaded.api_key.as_deref(), Some("new-key"));
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn config_path_uses_the_application_directory() {
        let dir = std::env::temp_dir().join("application-config");
        assert_eq!(ai_config_path(&dir), dir.join("ai-config.json"));
    }

    #[test]
    fn persists_configuration_in_a_created_application_directory() {
        let root = std::env::temp_dir().join(format!("maca-config-{}", uuid::Uuid::new_v4()));
        let path = ai_config_path(&root.join("settings"));
        let config = AiConfig::new(
            crate::ai::config::AiProviderKind::OpenAiCompatible,
            "http://localhost:11434/v1".into(), None, "test-model".into(),
            Some(0.7), Some(4096), Some(10), Some(300),
        );
        assert!(!has_ai_configuration(&path).unwrap());
        save_ai_config(&path, &config).unwrap();
        assert!(has_ai_configuration(&path).unwrap());
        let persisted: AiConfig = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert_eq!(persisted.model, "test-model");
        assert!(persisted.api_key.is_none());
        std::fs::remove_dir_all(root).unwrap();
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
