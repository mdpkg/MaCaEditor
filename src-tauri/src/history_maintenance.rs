use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tokio::sync::watch::{self, Receiver, Sender};

use crate::saved_history::{self, ReclaimAttempt};

const SAVE_QUIET_PERIOD: Duration = Duration::from_millis(500);

#[derive(Clone, Copy, Default)]
struct SaveActivity {
    active: usize,
    saving: usize,
    generation: u64,
}

#[derive(Clone, Copy, serde::Serialize)]
#[serde(tag = "phase", rename_all = "snake_case")]
pub enum ReclaimPhase {
    Queued,
    PausedForSave,
    Reclaiming,
    Completed {
        released_bytes: Option<u64>,
        request_count: Option<usize>,
    },
    Failed,
}

#[derive(Clone, Copy, serde::Serialize)]
pub struct ReclaimStatus {
    request_id: i64,
    estimated_bytes: Option<i64>,
    #[serde(flatten)]
    phase: ReclaimPhase,
}

type LatestBatch = Arc<Mutex<Option<ReclaimStatus>>>;

pub struct HistoryMaintenance {
    activity: Sender<SaveActivity>,
    latest: LatestBatch,
}

pub struct SaveGuard {
    activity: Sender<SaveActivity>,
    saving: bool,
}

impl Drop for SaveGuard {
    fn drop(&mut self) {
        self.activity.send_modify(|activity| {
            activity.active -= 1;
            activity.saving -= usize::from(self.saving);
        });
    }
}

impl HistoryMaintenance {
    pub fn start(database: PathBuf) -> Self {
        let (activity, changes) = watch::channel(SaveActivity::default());
        let latest = LatestBatch::default();
        tauri::async_runtime::spawn(run(database, changes, latest.clone()));
        Self { activity, latest }
    }

    pub fn begin_save(&self) -> SaveGuard {
        self.begin_activity(true)
    }

    pub fn begin_write(&self) -> SaveGuard {
        self.begin_activity(false)
    }

    fn begin_activity(&self, saving: bool) -> SaveGuard {
        let mut latest = self.latest.lock().unwrap();
        self.activity.send_modify(|activity| {
            activity.active += 1;
            activity.saving += usize::from(saving);
            activity.generation = activity.generation.wrapping_add(1);
        });
        if let Some(batch) = latest.as_mut() {
            if !matches!(batch.phase, ReclaimPhase::Completed { .. }) {
                if saving {
                    batch.phase = ReclaimPhase::PausedForSave;
                } else if matches!(batch.phase, ReclaimPhase::Reclaiming) {
                    batch.phase = ReclaimPhase::Queued;
                }
            }
        }
        SaveGuard {
            activity: self.activity.clone(),
            saving,
        }
    }

    pub fn track_batch(&self, request_id: i64, estimated_bytes: Option<i64>) {
        let mut latest = self.latest.lock().unwrap();
        if latest.is_none_or(|batch| batch.request_id < request_id) {
            let phase = if self.activity.borrow().saving > 0 {
                ReclaimPhase::PausedForSave
            } else {
                ReclaimPhase::Queued
            };
            *latest = Some(ReclaimStatus {
                request_id,
                estimated_bytes,
                phase,
            });
        }
    }

    pub fn status(&self) -> Option<ReclaimStatus> {
        *self.latest.lock().unwrap()
    }
}

async fn run(database: PathBuf, mut changes: Receiver<SaveActivity>, latest: LatestBatch) {
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

        {
            let mut latest = latest.lock().unwrap();
            if changes.borrow().generation != activity.generation {
                continue;
            }
            if let Some(batch) = latest.as_mut() {
                if !matches!(batch.phase, ReclaimPhase::Completed { .. }) {
                    batch.phase = ReclaimPhase::Reclaiming;
                }
            }
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
        let retry = matches!(&result, Ok(Err(error)) if error.is_busy());
        {
            let mut latest = latest.lock().unwrap();
            if let Some(batch) = latest.as_mut() {
                if !matches!(batch.phase, ReclaimPhase::Completed { .. }) {
                    update_batch(
                        batch,
                        &result,
                        changes.borrow().generation == activity.generation,
                    );
                }
            }
        }
        match result {
            Ok(Err(_)) if retry => continue, // A competing connection can release its lock without a notification.
            Ok(Err(error)) => eprintln!("edit history space reclamation deferred: {error}"),
            Err(error) => eprintln!("edit history space reclamation task failed: {error}"),
            Ok(Ok(_)) => {}
        }
        if changes.changed().await.is_err() {
            return;
        }
    }
}

fn update_batch(
    batch: &mut ReclaimStatus,
    result: &Result<Result<ReclaimAttempt, saved_history::HistoryError>, tokio::task::JoinError>,
    same_generation: bool,
) {
    let completed_elsewhere = ReclaimPhase::Completed {
        released_bytes: None,
        request_count: None,
    };
    match result {
        Ok(Ok(ReclaimAttempt::Published {
            first_request_id,
            through_request_id,
            released_bytes,
            request_count,
        })) if batch.request_id <= *through_request_id => {
            batch.phase = if batch.request_id >= *first_request_id {
                ReclaimPhase::Completed {
                    released_bytes: *released_bytes,
                    request_count: Some(*request_count),
                }
            } else {
                completed_elsewhere
            };
        }
        Ok(Ok(ReclaimAttempt::Idle)) if same_generation => batch.phase = completed_elsewhere,
        Ok(Err(error)) if same_generation && error.is_busy() => batch.phase = ReclaimPhase::Queued,
        Ok(Err(_)) | Err(_) if same_generation => batch.phase = ReclaimPhase::Failed,
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::saved_history::{delete_missing_saved_edit_histories, PendingCheckpoint};

    #[tokio::test]
    async fn a_batch_waits_for_saves_then_reports_the_published_allocation() {
        let root =
            std::env::temp_dir().join(format!("maca-reclaim-status-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&root).unwrap();
        let database = root.join("history.sqlite3");
        let document = format!("package:{}", root.join("removed.mdpkg").display());
        let bytes = 48 * 1024 * 1024;
        PendingCheckpoint::prepare(
            database.clone(),
            document.clone(),
            "saved",
            true,
            "history".into(),
            [Ok(vec![0xab; bytes])],
        )
        .unwrap()
        .complete("saved")
        .unwrap();
        let maintenance = HistoryMaintenance::start(database);
        let save = maintenance.begin_save();
        let deletion =
            delete_missing_saved_edit_histories(&root.join("history.sqlite3"), &[document])
                .unwrap();
        maintenance.track_batch(deletion.request_id.unwrap(), Some(bytes as i64));
        assert!(matches!(
            maintenance.status().unwrap().phase,
            ReclaimPhase::PausedForSave
        ));
        tokio::time::sleep(SAVE_QUIET_PERIOD).await;
        assert!(matches!(
            maintenance.status().unwrap().phase,
            ReclaimPhase::PausedForSave
        ));
        drop(save);

        let mut resumed = false;
        let released = tokio::time::timeout(Duration::from_secs(15), async {
            loop {
                match maintenance.status().unwrap().phase {
                    ReclaimPhase::Reclaiming => resumed = true,
                    ReclaimPhase::Completed {
                        released_bytes,
                        request_count,
                    } => {
                        assert_eq!(request_count, Some(1));
                        break released_bytes.unwrap();
                    }
                    ReclaimPhase::Failed => panic!("reclamation failed"),
                    _ => {}
                }
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
        })
        .await
        .unwrap();
        assert!(resumed);
        assert!(released >= bytes as u64);
        assert_eq!(
            maintenance.status().unwrap().estimated_bytes,
            Some(bytes as i64)
        );
        drop(maintenance);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn save_activity_remains_busy_until_every_save_finishes() {
        let (sender, receiver) = watch::channel(SaveActivity::default());
        let maintenance = HistoryMaintenance {
            activity: sender,
            latest: LatestBatch::default(),
        };
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
