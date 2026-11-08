use tauri::ipc::Channel;

#[derive(serde::Serialize)]
#[cfg_attr(test, derive(Debug, PartialEq, Eq, serde::Deserialize))]
#[serde(tag = "kind", content = "detail", rename_all = "camelCase")]
pub enum PrintMonitorEvent {
    JobFailed(String),
    MonitoringFailed(String),
}

#[cfg(windows)]
mod windows;
#[cfg(windows)]
pub use windows::PrintMonitor;

#[cfg(windows)]
#[tauri::command]
pub async fn watch_print(
    channel: Channel<PrintMonitorEvent>,
    monitor: tauri::State<'_, PrintMonitor>,
) -> Result<Option<String>, String> {
    monitor.register(channel).await.map(Some)
}

#[cfg(not(windows))]
#[tauri::command]
pub fn watch_print(channel: Channel<PrintMonitorEvent>) -> Option<String> {
    drop(channel);
    None
}
