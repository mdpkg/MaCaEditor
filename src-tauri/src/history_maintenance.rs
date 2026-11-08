use std::path::PathBuf;
use std::time::Duration;

use tokio::sync::mpsc::{self, Sender};

use crate::saved_history;

const SAVE_QUIET_PERIOD: Duration = Duration::from_millis(500);

pub struct HistoryMaintenance(Sender<()>);

impl HistoryMaintenance {
    pub fn start(database: PathBuf) -> Self {
        let (requests, mut pending) = mpsc::channel(1);
        tauri::async_runtime::spawn(async move {
            while pending.recv().await.is_some() {
                loop {
                    match tokio::time::timeout(SAVE_QUIET_PERIOD, pending.recv()).await {
                        Ok(Some(())) => continue,
                        Ok(None) => return,
                        Err(_) => break,
                    }
                }
                let database = database.clone();
                match tokio::task::spawn_blocking(move || saved_history::reclaim_pending(&database))
                    .await
                {
                    Ok(Ok(())) => {}
                    Ok(Err(error)) => eprintln!("edit history space reclamation deferred: {error}"),
                    Err(error) => eprintln!("edit history space reclamation task failed: {error}"),
                }
            }
        });
        let maintenance = Self(requests);
        maintenance.request();
        maintenance
    }

    pub fn request(&self) {
        // A queued request already covers any work committed before the next pass.
        let _ = self.0.try_send(());
    }
}
