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
    window: tauri::Window,
    state: tauri::State<'_, FolderWatcherState>,
    path: String,
) -> Result<(), String> {
    crate::document_access::require_document(&window, std::path::Path::new(&path), true)?;
    let loaded = crate::folder_document::load_folder(std::path::Path::new(&path))
        .map_err(|error| error.to_string())?;
    let root = loaded.root;
    let event_path = path;
    let mut watcher = notify::recommended_watcher(move |result: notify::Result<notify::Event>| {
        let Ok(event) = result else { return };
        if is_document_change(&event) {
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

fn is_document_change(event: &notify::Event) -> bool {
    is_content_change(&event.kind)
        && (event.paths.is_empty()
            || event.paths.iter().any(|path| {
                !path.components().any(|part| {
                    let name = part.as_os_str().to_string_lossy();
                    name == ".maca-save"
                        || (name.starts_with(".maca-save-") && name.ends_with(".tmp"))
                })
            }))
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
    use super::{is_content_change, is_document_change};
    use notify::event::{AccessKind, CreateKind, ModifyKind, RemoveKind};
    use notify::EventKind;

    #[test]
    fn emits_only_for_content_changing_events() {
        assert!(is_content_change(&EventKind::Create(CreateKind::File)));
        assert!(is_content_change(&EventKind::Modify(ModifyKind::Any)));
        assert!(is_content_change(&EventKind::Remove(RemoveKind::File)));
        assert!(!is_content_change(&EventKind::Access(AccessKind::Read)));
    }

    #[test]
    fn ignores_staging_but_keeps_publication_and_external_edits() {
        let event = |path: &str| {
            notify::Event::new(EventKind::Modify(ModifyKind::Any)).add_path(path.into())
        };
        assert!(!is_document_change(&event("book/.maca-save/0")));
        assert!(!is_document_change(&event("book/.maca-save-uuid.tmp")));
        assert!(is_document_change(&event("book/index.md")));
        assert!(is_document_change(
            &event("book/.maca-save/0").add_path("book/index.md".into())
        ));
    }
}
