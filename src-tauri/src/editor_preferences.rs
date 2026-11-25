//! Preserve the existing store JSON on its fixed path without exposing a
//! generic frontend-controlled JSON filesystem API.
use std::path::Path;
use tauri::Manager;

const KEYS: [&str; 4] = ["vimMode", "showToc", "rspressMode", "drawingPreferences"];
const CHACHA_KEY: &str = "chachaPreferences";

fn read(path: &Path) -> Result<serde_json::Map<String, serde_json::Value>, String> {
    if !path.exists() {
        return Ok(Default::default());
    }
    let data = crate::bounded_io::read_file(path, 64 * 1024).map_err(|error| error.to_string())?;
    serde_json::from_slice(&data).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn read_editor_preferences(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let path = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("settings.json");
    let mut preferences = read(&path)?;
    preferences.retain(|key, _| KEYS.contains(&key.as_str()) || key == CHACHA_KEY);
    Ok(preferences.into())
}

#[tauri::command]
pub fn save_editor_preferences(
    app: tauri::AppHandle,
    preferences: serde_json::Value,
) -> Result<(), String> {
    let path = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("settings.json");
    save(&path, preferences)
}

fn save(path: &Path, preferences: serde_json::Value) -> Result<(), String> {
    let values = preferences
        .as_object()
        .ok_or("preferences must be an object")?;
    if values.len() == 1 && values.contains_key(CHACHA_KEY) {
        let chacha = values[CHACHA_KEY].as_object().ok_or("invalid chacha preferences")?;
        if chacha.len() != 2
            || !chacha.get("prompt").and_then(serde_json::Value::as_str)
                .is_some_and(|text| text.chars().count() <= 10000)
            || !chacha.get("frequency").and_then(serde_json::Value::as_str)
                .is_some_and(|value| matches!(value, "restrained" | "standard" | "frequent"))
        {
            return Err("invalid chacha preferences".into());
        }
        return merge_and_save(path, values);
    }
    if values.len() != KEYS.len() || !KEYS.iter().all(|key| values.contains_key(*key)) {
        return Err("unsupported preference keys".into());
    }
    for key in &KEYS[..3] {
        if !values[*key].is_boolean() {
            return Err("preference must be boolean".into());
        }
    }
    let drawing = values["drawingPreferences"]
        .as_object()
        .ok_or("invalid drawing preferences")?;
    if drawing.len() != 3
        || !["gridVisible", "snap", "smartGuidesEnabled"]
            .iter()
            .all(|key| drawing.get(*key).is_some_and(serde_json::Value::is_boolean))
    {
        return Err("invalid drawing preferences".into());
    }
    merge_and_save(path, values)
}

fn merge_and_save(path: &Path, values: &serde_json::Map<String, serde_json::Value>) -> Result<(), String> {
    let mut existing = read(path)?;
    existing.extend(values.clone());
    let bytes = serde_json::to_vec(&existing).map_err(|error| error.to_string())?;
    std::fs::create_dir_all(path.parent().ok_or("invalid settings path")?)
        .map_err(|error| error.to_string())?;
    crate::atomic_save::atomic_save(path, &bytes).map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn chacha_preferences_are_independent_validated_and_never_store_consent() {
        let root = std::env::temp_dir().join(format!("maca-chacha-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&root).unwrap();
        let path = root.join("settings.json");
        std::fs::write(&path, br#"{"vimMode":true,"legacy":"keep"}"#).unwrap();
        let settings = serde_json::json!({"chachaPreferences":{"prompt":"reader","frequency":"standard"}});
        save(&path, settings.clone()).unwrap();
        let saved = read(&path).unwrap();
        assert_eq!(saved["vimMode"], true);
        assert_eq!(saved["legacy"], "keep");
        assert_eq!(saved["chachaPreferences"], settings["chachaPreferences"]);
        for invalid in [
            serde_json::json!({"prompt":"reader","frequency":"standard","enabled":true}),
            serde_json::json!({"prompt":"reader","frequency":"unknown"}),
            serde_json::json!({"prompt":false,"frequency":"standard"}),
            serde_json::json!({"prompt":"x".repeat(10001),"frequency":"standard"}),
        ] {
            assert!(save(&path, serde_json::json!({"chachaPreferences":invalid})).is_err());
            assert_eq!(read(&path).unwrap(), saved);
        }
        save(&path, serde_json::json!({"chachaPreferences":{"prompt":"😀".repeat(10000),"frequency":"frequent"}})).unwrap();
        assert_eq!(read(&path).unwrap()["chachaPreferences"]["prompt"].as_str().unwrap().chars().count(), 10000);
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn preserves_existing_settings_format_and_unknown_legacy_values() {
        let root = std::env::temp_dir().join(format!("maca-preferences-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&root).unwrap();
        let path = root.join("settings.json");
        std::fs::write(&path, br#"{"legacy":"keep","vimMode":false}"#).unwrap();
        save(
            &path,
            serde_json::json!({"vimMode":true,"showToc":false,"rspressMode":true,
            "drawingPreferences":{"gridVisible":true,"snap":false,"smartGuidesEnabled":true}}),
        )
        .unwrap();
        let values = read(&path).unwrap();
        assert_eq!(values["legacy"], "keep");
        assert_eq!(values["vimMode"], true);
        assert!(save(&path, serde_json::json!({"path":"outside"})).is_err());
        assert_eq!(read(&path).unwrap(), values);
        std::fs::remove_dir_all(root).unwrap();
    }
}
