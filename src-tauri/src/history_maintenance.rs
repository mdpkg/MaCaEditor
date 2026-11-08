use std::path::PathBuf;
use std::time::Duration;

use tokio::sync::watch::{self, Receiver, Sender};

use crate::saved_history;

const SAVE_QUIET_PERIOD: Duration = Duration::from_millis(500);

#[derive(Clone, Copy, Default)]
struct SaveActivity {
    active: usize,
    generation: u64,
}

pub struct HistoryMaintenance(Sender<SaveActivity>);
pub struct SaveGuard(Sender<SaveActivity>);

impl Drop for SaveGuard {
    fn drop(&mut self) {
        self.0.send_modify(|activity| activity.active -= 1);
    }
}

impl HistoryMaintenance {
    pub fn start(database: PathBuf) -> Self {
        let (activity, changes) = watch::channel(SaveActivity::default());
        tauri::async_runtime::spawn(run(database, changes));
        Self(activity)
    }

    pub fn begin_save(&self) -> SaveGuard {
        self.0.send_modify(|activity| {
            activity.active += 1;
            activity.generation = activity.generation.wrapping_add(1);
        });
        SaveGuard(self.0.clone())
    }
}

async fn run(database: PathBuf, mut changes: Receiver<SaveActivity>) {
    loop {
        let activity = *changes.borrow_and_update();
        if activity.active > 0 {
            if changes.changed().await.is_err() {
                return;
            }
            continue;
        }
        match tokio::time::timeout(SAVE_QUIET_PERIOD, changes.changed()).await {
            Ok(Ok(())) => continue,
            Ok(Err(_)) => return,
            Err(_) => {}
        }

        let path = database.clone();
        let observed = changes.clone();
        let result = tokio::task::spawn_blocking(move || {
            saved_history::reclaim_pending(&path, move || {
                observed.has_changed().is_err()
                    || observed.borrow().generation != activity.generation
            })
        })
        .await;
        match result {
            Ok(Ok(())) => {}
            Ok(Err(error)) if error.is_busy() => {
                // An independent connection can release its lock without a local save notification.
                continue;
            }
            Ok(Err(error)) => eprintln!("edit history space reclamation deferred: {error}"),
            Err(error) => eprintln!("edit history space reclamation task failed: {error}"),
        }
        if changes.changed().await.is_err() {
            return;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn save_activity_remains_busy_until_every_save_finishes() {
        let (sender, receiver) = watch::channel(SaveActivity::default());
        let maintenance = HistoryMaintenance(sender);
        let first = maintenance.begin_save();
        let second = maintenance.begin_save();
        assert_eq!(receiver.borrow().active, 2);
        drop(first);
        assert_eq!(receiver.borrow().active, 1);
        drop(second);
        assert_eq!(receiver.borrow().active, 0);
        assert_eq!(receiver.borrow().generation, 2);
    }
}
