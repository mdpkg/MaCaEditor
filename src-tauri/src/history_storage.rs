use std::path::PathBuf;
use tauri::{AppHandle, Manager};

pub(crate) fn history_database(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_local_data_dir()
        .map(|path| path.join("edit-history.sqlite3"))
        .map_err(|error| error.to_string())
}

