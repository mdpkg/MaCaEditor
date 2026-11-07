use tauri::ipc::Channel;

#[cfg(windows)]
mod windows;
#[cfg(windows)]
pub use windows::PrintMonitor;

#[cfg(windows)]
#[tauri::command]
pub async fn watch_print(
    channel: Channel<String>,
    monitor: tauri::State<'_, PrintMonitor>,
) -> Result<Option<String>, String> {
    monitor.register(channel).await.map(Some)
}

#[cfg(not(windows))]
#[tauri::command]
pub fn watch_print(channel: Channel<String>) -> Option<String> {
    drop(channel);
    None
}
