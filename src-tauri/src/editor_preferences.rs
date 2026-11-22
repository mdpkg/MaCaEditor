//! Preserve the existing store JSON on its fixed path without exposing a
//! generic frontend-controlled JSON filesystem API.
use std::path::Path;
use tauri::Manager;

const KEYS: [&str; 4] = ["vimMode", "showToc", "rspressMode", "drawingPreferences"];

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
    preferences.retain(|key, _| KEYS.contains(&key.as_str()));
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
