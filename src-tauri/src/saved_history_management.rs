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
            // A disconnected Windows volume or network share may also report NotFound.
            let root = path.ancestors().last().filter(|root| root.has_root());
            if root.is_some_and(|root| metadata(root).is_err()) {
                Access::Unavailable
            } else {
                Access::Missing
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
    list_with_metadata(database, |path| {
        let info = fs::metadata(path)?;
        if info.is_file() {
            fs::File::open(path)?;
        } else if info.is_dir() {
            fs::read_dir(path)?;
        }
        Ok(info)
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
            "SELECT document, max(saved_at) FILTER (WHERE committed = 1)
             FROM checkpoint GROUP BY document",
        )?;
        let rows = query.query_map([], |row| Ok((row.get::<_, String>(0)?, row.get(1)?)))?;
        rows.collect::<rusqlite::Result<Vec<(String, Option<i64>)>>>()?
    };
    // File-system probes can be slow on network drives. Release SQLite before probing.
    Ok(rows
        .into_iter()
        .filter_map(|(id, saved_at)| {
            let (kind, path) = id.split_once(':')?;
            let access = access_status(kind, Path::new(path), &metadata);
            let path = display_path(path);
            Some(SavedEditHistory {
                id,
                path,
                saved_at,
                access,
            })
        })
        .collect())
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
