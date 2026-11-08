use std::collections::HashSet;
use std::fs::{self, Metadata};
use std::io::{self, ErrorKind};
use std::path::Path;

use rusqlite::TransactionBehavior;

use super::{connect, enqueue_reclaim, Result};

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
enum Access {
    Available,
    Missing,
    Unavailable,
    Denied,
    WrongKind,
}

#[derive(Debug, serde::Serialize)]
pub struct SavedEditHistory {
    id: String,
    path: String,
    saved_at: Option<i64>,
    access: Access,
    size_bytes: i64,
}

fn access_status(
    kind: &str,
    path: &Path,
    metadata: &impl Fn(&Path) -> io::Result<Metadata>,
) -> Access {
    match metadata(path) {
        Ok(info)
            if (kind == "folder" && info.is_dir()) || (kind == "package" && info.is_file()) =>
        {
            Access::Available
        }
        Ok(_) => Access::WrongKind,
        Err(error) if error.kind() == ErrorKind::PermissionDenied => Access::Denied,
        Err(error) if error.kind() == ErrorKind::NotFound => {
            // NotFound can also mean a disconnected volume or an inaccessible ancestor.
            match path.parent().map(metadata) {
                Some(Ok(parent)) if parent.is_dir() => Access::Missing,
                Some(Err(error)) if error.kind() == ErrorKind::PermissionDenied => Access::Denied,
                _ => Access::Unavailable,
            }
        }
        Err(_) => Access::Unavailable,
    }
}

fn display_path(path: &str) -> String {
    if cfg!(windows) {
        if let Some(unc) = path.strip_prefix(r"\\?\UNC\") {
            return format!(r"\\{unc}");
        }
        if let Some(drive) = path
            .strip_prefix(r"\\?\")
            .filter(|rest| rest.as_bytes().get(1) == Some(&b':'))
        {
            return drive.into();
        }
    }
    path.into()
}

pub fn list_saved_edit_histories(database: &Path) -> Result<Vec<SavedEditHistory>> {
    list_with_metadata(database, probe_access)
}

fn probe_access(path: &Path) -> io::Result<Metadata> {
    let entry = fs::symlink_metadata(path)?;
    let inspect = || {
        let info = if entry.is_symlink() {
            fs::metadata(path)?
        } else {
            entry
        };
        if info.is_file() {
            fs::File::open(path)?;
        } else if info.is_dir() {
            fs::read_dir(path)?;
        }
        Ok::<_, io::Error>(info)
    };
    inspect().map_err(|error| {
        // An existing entry may point to an unavailable location or change during the probe.
        if error.kind() == ErrorKind::NotFound {
            ErrorKind::NotConnected.into()
        } else {
            error
        }
    })
}

fn list_with_metadata(
    database: &Path,
    metadata: impl Fn(&Path) -> io::Result<Metadata>,
) -> Result<Vec<SavedEditHistory>> {
    if !database.try_exists()? {
        return Ok(Vec::new());
    }
    let rows = {
        let db = connect(database)?;
        let mut query = db.prepare(
            "WITH document_payloads AS (
                SELECT DISTINCT c.document, cp.digest
                FROM checkpoint c JOIN checkpoint_payload cp ON cp.checkpoint = c.id
             ), attachment_sizes AS (
                SELECT document, sum(octet_length(p.data)) AS bytes
                FROM document_payloads JOIN payload p USING(digest) GROUP BY document
             )
             SELECT c.document, max(c.saved_at) FILTER (WHERE c.committed = 1),
                    sum(octet_length(c.data)) + coalesce(max(a.bytes), 0)
             FROM checkpoint c LEFT JOIN attachment_sizes a USING(document)
             GROUP BY c.document",
        )?;
        let rows = query.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get(1)?, row.get(2)?))
        })?;
        rows.collect::<rusqlite::Result<Vec<_>>>()?
    };
    // File-system probes can be slow on network drives. Release SQLite before probing.
    Ok(rows
        .into_iter()
        .filter_map(|(id, saved_at, size_bytes)| {
            let (kind, path) = id.split_once(':')?;
            let access = access_status(kind, Path::new(path), &metadata);
            let path = display_path(path);
            Some(SavedEditHistory {
                id,
                path,
                saved_at,
                access,
                size_bytes,
            })
        })
        .collect())
}

pub fn estimate_reclaimable_history_bytes(database: &Path, ids: &[String]) -> Result<i64> {
    if ids.is_empty() || !database.try_exists()? {
        return Ok(0);
    }
    let db = connect(database)?;
    let ids = serde_json::to_string(ids).map_err(io::Error::other)?;
    // Count a payload once, and keep it if any checkpoint outside the selection refers to it.
    Ok(db.query_row(
        "WITH selected AS (
            SELECT DISTINCT value AS document FROM json_each(?1)
         ), checkpoints AS (
            SELECT c.id, octet_length(c.data) AS bytes FROM selected JOIN checkpoint c USING(document)
         ), selected_payloads AS (
            SELECT DISTINCT cp.digest FROM checkpoints c JOIN checkpoint_payload cp ON cp.checkpoint = c.id
         )
         SELECT coalesce((SELECT sum(bytes) FROM checkpoints), 0) +
                coalesce((
                    SELECT sum(octet_length(p.data)) FROM selected_payloads JOIN payload p USING(digest)
                    WHERE NOT EXISTS (
                        SELECT 1 FROM checkpoint_payload cp JOIN checkpoint c ON c.id = cp.checkpoint
                        WHERE cp.digest = p.digest AND NOT EXISTS (
                            SELECT 1 FROM selected WHERE document = c.document
                        )
                    )
                ), 0)",
        [ids],
        |row| row.get(0),
    )?)
}

pub fn delete_saved_edit_history(database: &Path, document_id: &str) -> Result<()> {
    if !database.try_exists()? {
        return Ok(());
    }
    let mut db = connect(database)?;
    let tx = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
    // Use the stored identity. Resolving the path would fail for missing or offline documents.
    let deleted = tx.execute("DELETE FROM checkpoint WHERE document = ?1", [document_id])?;
    if deleted > 0 {
        enqueue_reclaim(&tx)?;
    }
    tx.commit()?;
    Ok(())
}

#[derive(Default)]
pub struct BulkDeletion {
    pub deleted_ids: Vec<String>,
    pub request_id: Option<i64>,
}

pub fn delete_missing_saved_edit_histories(
    database: &Path,
    ids: &[String],
) -> Result<BulkDeletion> {
    delete_missing_with_metadata(database, ids, probe_access)
}

fn delete_missing_with_metadata(
    database: &Path,
    ids: &[String],
    metadata: impl Fn(&Path) -> io::Result<Metadata>,
) -> Result<BulkDeletion> {
    if ids.is_empty() || !database.try_exists()? {
        return Ok(BulkDeletion::default());
    }
    let snapshot_sql = "SELECT max(id), max(id) FILTER (WHERE committed = 1)
                        FROM checkpoint WHERE document = ?1";
    let candidates = {
        let db = connect(database)?;
        let mut snapshot = db.prepare(snapshot_sql)?;
        let mut seen = HashSet::new();
        let mut candidates = Vec::new();
        for id in ids.iter().filter(|id| seen.insert(*id)) {
            let (latest, committed): (Option<i64>, Option<i64>) =
                snapshot.query_row([id], |row| Ok((row.get(0)?, row.get(1)?)))?;
            if let Some(latest) = latest {
                candidates.push((id, latest, committed));
            }
        }
        candidates
    };
    // Probing a disconnected location can be slow. Keep SQLite unlocked during the probes.
    let missing = candidates
        .into_iter()
        .filter(|(id, _, _)| {
            id.split_once(':').is_some_and(|(kind, path)| {
                let path = Path::new(path);
                matches!(kind, "package" | "folder")
                    && path.is_absolute()
                    && access_status(kind, path, &metadata) == Access::Missing
            })
        })
        .collect::<Vec<_>>();
    if missing.is_empty() {
        return Ok(BulkDeletion::default());
    }
    let mut db = connect(database)?;
    let tx = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let mut deleted = Vec::new();
    {
        let mut snapshot = tx.prepare(snapshot_sql)?;
        let mut delete = tx.prepare("DELETE FROM checkpoint WHERE document = ?1")?;
        for (id, latest, committed) in missing {
            let current = snapshot.query_row([id], |row| Ok((row.get(0)?, row.get(1)?)))?;
            // A checkpoint may have been written or committed while the paths were checked.
            if current == (Some(latest), committed) && delete.execute([id])? > 0 {
                deleted.push(id.clone());
            }
        }
    }
    let request_id = (!deleted.is_empty())
        .then(|| enqueue_reclaim(&tx))
        .transpose()?;
    tx.commit()?;
    Ok(BulkDeletion {
        deleted_ids: deleted,
        request_id,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::saved_history::{identity, load, read_chunk, reclaim_pending, PendingCheckpoint};

    #[test]
    fn missing_root_is_reported_as_unavailable() {
        let path = std::env::temp_dir().join("unavailable.mdpkg");
        let status = access_status("package", &path, &|_| Err(ErrorKind::NotFound.into()));
        assert_eq!(status, Access::Unavailable);
    }

    #[test]
    fn measures_distinct_document_payloads_and_estimates_only_bytes_exclusive_to_the_batch() {
        const MIB: i64 = 1024 * 1024;
        let root =
            std::env::temp_dir().join(format!("maca-history-capacity-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        let database = root.join("history.sqlite3");
        let folder = format!("folder:{}", root.join("Removed folder").display());
        let package = format!("package:{}", root.join("Removed.mdpkg").display());
        let retained = format!("package:{}", root.join("Retained.mdpkg").display());
        let save = |id: &str, revision: &str, text: &str, payloads: &[(u8, i64)]| {
            PendingCheckpoint::prepare(
                database.clone(),
                id.into(),
                revision,
                true,
                text.into(),
                payloads
                    .iter()
                    .map(|&(byte, mib)| Ok(vec![byte; (mib * MIB) as usize])),
            )
            .unwrap()
        };
        let shared_with_retained = (0xab, 16);
        let shared_in_batch = (0xbc, 4);
        let unique_folder = (0xcd, 8);
        let unique_package = (0xde, 6);
        let folder_text = "履歴";
        let package_text = "📎";
        save(
            &folder,
            "saved",
            folder_text,
            &[
                unique_folder,
                shared_in_batch,
                shared_with_retained,
                shared_with_retained,
            ],
        )
        .complete("saved")
        .unwrap();
        save(&folder, "pending", "pending", &[unique_folder]);
        save(
            &package,
            "saved",
            package_text,
            &[unique_package, shared_in_batch, shared_with_retained],
        )
        .complete("saved")
        .unwrap();
        // A recoverable checkpoint in another document still protects its attachment.
        save(&retained, "pending", "retained", &[shared_with_retained]);

        let rows = list_saved_edit_histories(&database).unwrap();
        let size = |id: &str| rows.iter().find(|row| row.id == id).unwrap().size_bytes;
        let folder_bytes = (folder_text.len() + "pending".len()) as i64;
        let package_bytes = package_text.len() as i64;
        assert_eq!(size(&folder), 28 * MIB + folder_bytes);
        assert_eq!(size(&package), 26 * MIB + package_bytes);
        assert_eq!(size(&retained), 16 * MIB + "retained".len() as i64);
        assert_eq!(
            estimate_reclaimable_history_bytes(&database, &[folder.clone()]).unwrap(),
            8 * MIB + folder_bytes
        );
        assert_eq!(
            estimate_reclaimable_history_bytes(&database, &["unknown".into()]).unwrap(),
            0
        );
        let selected = [folder.clone(), package.clone(), folder.clone()];
        let estimated = estimate_reclaimable_history_bytes(&database, &selected).unwrap();
        assert_eq!(estimated, 18 * MIB + folder_bytes + package_bytes);

        let before = fs::metadata(&database).unwrap().len();
        assert_eq!(
            delete_missing_saved_edit_histories(&database, &selected)
                .unwrap()
                .deleted_ids,
            [folder, package]
        );
        reclaim_pending(&database, || false).unwrap();
        let actual = before - fs::metadata(&database).unwrap().len();
        assert!(
            actual.abs_diff(estimated as u64) < 256 * 1024,
            "estimate {estimated}, actual {actual}"
        );
        let kept = load(&database, &retained, "pending")
            .unwrap()
            .unwrap()
            .download
            .unwrap();
        assert_eq!(kept.sizes, [16 * MIB as usize]);
        assert_eq!(
            read_chunk(&database, kept.id, 0, 0, 1).unwrap(),
            [shared_with_retained.0]
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn bulk_clear_rechecks_paths_and_reclaims_only_confirmed_missing_histories() {
        let root = std::env::temp_dir().join(format!("maca-history-bulk-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        let database = root.join("history.sqlite3");
        let gone_folder = format!("folder:{}", root.join("Removed").display());
        let gone_package = format!("package:{}", root.join("Removed.mdpkg").display());
        let offline = root.join("Offline.mdpkg");
        let offline_id = format!("package:{}", offline.display());
        let missing_mount = root.join("Unmounted");
        let offline_folder_id = format!("folder:{}", missing_mount.join("Project").display());
        let denied = root.join("Private.mdpkg");
        let denied_id = format!("package:{}", denied.display());
        let private_parent = root.join("Private");
        let denied_child_id = format!("package:{}", private_parent.join("Project.mdpkg").display());
        let restored = root.join("Restored.mdpkg");
        let restored_id = format!("package:{}", restored.display());
        fs::write(&restored, b"back online").unwrap();
        let changed = root.join("Changed.mdpkg");
        let changed_id = format!("package:{}", changed.display());
        let shared = vec![0xab; 16 * 1024 * 1024];
        let unique_size = 24 * 1024 * 1024;
        let protected = [
            &offline_id,
            &offline_folder_id,
            &denied_id,
            &denied_child_id,
            &restored_id,
        ];
        for document in [&gone_folder, &gone_package, &changed_id]
            .into_iter()
            .chain(protected)
        {
            let mut attachments = vec![Ok(shared.clone())];
            if document == &gone_folder {
                attachments.push(Ok(vec![0xcd; unique_size]));
            }
            if document == &gone_package {
                attachments.push(Ok(vec![0xef; unique_size]));
            }
            PendingCheckpoint::prepare(
                database.clone(),
                document.clone(),
                "saved",
                true,
                document.clone(),
                attachments,
            )
            .unwrap()
            .complete("saved")
            .unwrap();
        }
        let before = fs::metadata(&database).unwrap().len();
        let probe = |path: &Path| {
            if path == denied || path == private_parent {
                return Err(ErrorKind::PermissionDenied.into());
            }
            if path == offline {
                return Err(ErrorKind::NotConnected.into());
            }
            if path == changed {
                PendingCheckpoint::prepare(
                    database.clone(),
                    changed_id.clone(),
                    "updated",
                    true,
                    "new history".into(),
                    [],
                )
                .unwrap()
                .complete("updated")
                .unwrap();
            }
            fs::metadata(path)
        };
        // Pass stale or ineligible selections deliberately, as well as a duplicate.
        let selected = [&gone_folder, &gone_package, &gone_folder, &changed_id]
            .into_iter()
            .chain(protected)
            .cloned()
            .collect::<Vec<_>>();
        let deleted = delete_missing_with_metadata(&database, &selected, probe)
            .unwrap()
            .deleted_ids;
        assert_eq!(deleted, [gone_folder.clone(), gone_package.clone()]);
        assert!(load(&database, &gone_folder, "saved").unwrap().is_none());
        assert!(load(&database, &gone_package, "saved").unwrap().is_none());
        let updated = load(&database, &changed_id, "updated").unwrap().unwrap();
        assert_eq!(updated.checkpoint.data, "new history");
        reclaim_pending(&database, || false).unwrap();
        assert!(
            before.saturating_sub(fs::metadata(&database).unwrap().len())
                >= (2 * unique_size) as u64
        );
        for document in protected {
            let kept = load(&database, document, "saved").unwrap().unwrap();
            assert_eq!(&kept.checkpoint.data, document);
            let attachment = kept.download.unwrap();
            assert_eq!(attachment.sizes, [16 * 1024 * 1024]);
            assert_eq!(
                read_chunk(&database, attachment.id, 0, 0, 1).unwrap(),
                [0xab]
            );
        }
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn listing_preserves_inaccessible_histories_and_explicit_deletion_reclaims_space() {
        let root =
            std::env::temp_dir().join(format!("maca-history-management-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        let database = root.join("history.sqlite3");
        let gone = root.join("Removed folder");
        fs::create_dir(&gone).unwrap();
        let gone_id = identity("folder", &gone).unwrap();
        fs::remove_dir(&gone).unwrap();
        let keep = root.join("Keep.mdpkg");
        fs::write(&keep, b"fixture").unwrap();
        let keep_id = identity("package", &keep).unwrap();
        let denied = root.join("Private.mdpkg");
        let denied_id = format!("package:{}", denied.display());
        let offline = root.join("Offline");
        let offline_id = format!("folder:{}", offline.display());
        let unique_size = 48 * 1024 * 1024;
        let shared = vec![0x12; 16 * 1024 * 1024];

        for (document, attachments) in [
            (
                &gone_id,
                vec![Ok(vec![0x34; unique_size]), Ok(shared.clone())],
            ),
            (&keep_id, vec![Ok(shared)]),
            (&denied_id, vec![]),
            (&offline_id, vec![]),
        ] {
            PendingCheckpoint::prepare(
                database.clone(),
                document.clone(),
                "saved",
                true,
                document.clone(),
                attachments,
            )
            .unwrap()
            .complete("saved")
            .unwrap();
        }
        let probe = |path: &Path| {
            if path == denied {
                return Err(ErrorKind::PermissionDenied.into());
            }
            if path == offline {
                return Err(ErrorKind::NotConnected.into());
            }
            fs::metadata(path)
        };
        for _ in 0..2 {
            let entries = list_with_metadata(&database, probe).unwrap();
            assert_eq!(entries.len(), 4);
            for (id, access) in [
                (&gone_id, Access::Missing),
                (&keep_id, Access::Available),
                (&denied_id, Access::Denied),
                (&offline_id, Access::Unavailable),
            ] {
                let entry = entries.iter().find(|entry| &entry.id == id).unwrap();
                assert_eq!(entry.access, access);
                assert!(entry.saved_at.is_some());
                assert!(load(&database, id, "saved").unwrap().is_some());
            }
        }

        let before = fs::metadata(&database).unwrap().len();
        delete_saved_edit_history(&database, &gone_id).unwrap();
        assert!(load(&database, &gone_id, "saved").unwrap().is_none());
        reclaim_pending(&database, || false).unwrap();
        assert!(
            before.saturating_sub(fs::metadata(&database).unwrap().len()) >= unique_size as u64
        );
        let keep = load(&database, &keep_id, "saved").unwrap().unwrap();
        assert_eq!(keep.checkpoint.data, keep_id);
        let shared = keep.download.unwrap();
        assert_eq!(shared.sizes, [16 * 1024 * 1024]);
        assert_eq!(read_chunk(&database, shared.id, 0, 0, 1).unwrap(), [0x12]);
        assert_eq!(list_with_metadata(&database, probe).unwrap().len(), 3);

        fs::remove_dir_all(root).unwrap();
    }
}
