use std::sync::Mutex;

use notify::{EventKind, RecursiveMode, Watcher};
use tauri::Emitter;

#[derive(Default)]
pub struct FolderWatcherState {
    watcher: Mutex<Option<notify::RecommendedWatcher>>,
}

#[derive(Clone, serde::Serialize)]
struct FolderChangedEvent {
    path: String,
}

#[tauri::command]
pub fn watch_folder(
    app: tauri::AppHandle,
    state: tauri::State<'_, FolderWatcherState>,
    path: String,
) -> Result<(), String> {
    let loaded = crate::folder_document::load_folder(std::path::Path::new(&path))
        .map_err(|error| error.to_string())?;
    let root = loaded.root;
    let event_path = path;
    let mut watcher = notify::recommended_watcher(move |result: notify::Result<notify::Event>| {
        let Ok(event) = result else { return };
        if is_content_change(&event.kind) {
            let _ = app.emit(
                "folder-changed",
                FolderChangedEvent {
                    path: event_path.clone(),
                },
            );
        }
    })
    .map_err(|error| error.to_string())?;
    watcher
        .watch(&root, RecursiveMode::Recursive)
        .map_err(|error| error.to_string())?;
    *state
        .watcher
        .lock()
        .map_err(|_| "folder watcher lock is poisoned")? = Some(watcher);
    Ok(())
}

fn is_content_change(kind: &EventKind) -> bool {
    matches!(
        kind,
        EventKind::Create(_) | EventKind::Modify(_) | EventKind::Remove(_)
    )
}

#[tauri::command]
pub fn stop_watching_folder(state: tauri::State<'_, FolderWatcherState>) -> Result<(), String> {
    *state
        .watcher
        .lock()
        .map_err(|_| "folder watcher lock is poisoned")? = None;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::is_content_change;
    use notify::event::{AccessKind, CreateKind, ModifyKind, RemoveKind};
    use notify::EventKind;

    #[test]
    fn emits_only_for_content_changing_events() {
        assert!(is_content_change(&EventKind::Create(CreateKind::File)));
        assert!(is_content_change(&EventKind::Modify(ModifyKind::Any)));
        assert!(is_content_change(&EventKind::Remove(RemoveKind::File)));
        assert!(!is_content_change(&EventKind::Access(AccessKind::Read)));
    }
}
