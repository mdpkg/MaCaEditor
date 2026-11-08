use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::time::Duration;

use base64::{engine::general_purpose::STANDARD, Engine};
use rusqlite::{params, Connection, OptionalExtension, Transaction, TransactionBehavior};
use sha2::{Digest, Sha256};

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
pub struct EditCheckpoint {
    pub data: String,
    pub attachments: Vec<String>,
}

#[derive(Debug, serde::Serialize)]
pub struct AttachmentDownload {
    pub id: i64,
    pub sizes: Vec<usize>,
}

pub struct LoadedCheckpoint {
    pub checkpoint: EditCheckpoint,
    pub download: Option<AttachmentDownload>,
}

#[derive(Debug, thiserror::Error)]
pub enum HistoryError {
    #[error("edit history I/O: {0}")]
    Io(#[from] io::Error),
    #[error("edit history database: {0}")]
    Sql(#[from] rusqlite::Error),
    #[error("invalid saved attachment: {0}")]
    Base64(#[from] base64::DecodeError),
    #[error("unsupported edit history database version: {0}")]
    Schema(i64),
    #[error("edit history path is not UTF-8")]
    Path,
}

type Result<T> = std::result::Result<T, HistoryError>;

pub fn identity(kind: &str, path: &Path) -> Result<String> {
    let canonical =
        if kind == "folder" || fs::symlink_metadata(path).is_ok_and(|info| !info.is_symlink()) {
            fs::canonicalize(path)?
        } else {
            let parent = path
                .parent()
                .filter(|parent| !parent.as_os_str().is_empty())
                .unwrap_or(Path::new("."));
            let name = path
                .file_name()
                .ok_or_else(|| io::Error::other("missing file name"))?;
            fs::canonicalize(parent)?.join(name)
        };
    let value = canonical.to_str().ok_or(HistoryError::Path)?;
    Ok(format!("{kind}:{value}"))
}

pub fn revision(data: &[u8]) -> String {
    format!("{:x}", Sha256::digest(data))
}

pub fn existing_revision(path: &Path) -> io::Result<Option<String>> {
    let mut file = match fs::File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error),
    };
    let mut hash = Sha256::new();
    io::copy(&mut file, &mut hash)?;
    Ok(Some(format!("{:x}", hash.finalize())))
}

fn connect(path: &Path) -> Result<Connection> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let mut db = Connection::open(path)?;
    db.busy_timeout(Duration::from_secs(5))?;
    db.execute_batch(
        "PRAGMA foreign_keys = ON; PRAGMA secure_delete = ON; PRAGMA synchronous = FULL;",
    )?;
    let version: i64 = db.pragma_query_value(None, "user_version", |row| row.get(0))?;
    if version == 0 {
        let tx = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
        tx.execute_batch(
            "CREATE TABLE IF NOT EXISTS checkpoint (
                id INTEGER PRIMARY KEY AUTOINCREMENT, document TEXT NOT NULL, revision TEXT NOT NULL,
                data TEXT NOT NULL, committed INTEGER NOT NULL, recoverable INTEGER NOT NULL
             );
             CREATE INDEX IF NOT EXISTS checkpoint_document ON checkpoint(document, revision, id);
             CREATE TABLE IF NOT EXISTS payload (digest TEXT PRIMARY KEY, data BLOB NOT NULL);
             CREATE TABLE IF NOT EXISTS checkpoint_payload (
                checkpoint INTEGER NOT NULL REFERENCES checkpoint(id) ON DELETE CASCADE,
                position INTEGER NOT NULL, digest TEXT NOT NULL REFERENCES payload(digest),
                PRIMARY KEY(checkpoint, position)
             );
             CREATE INDEX IF NOT EXISTS referenced_payload ON checkpoint_payload(digest);
             PRAGMA user_version = 1;",
        )?;
        tx.commit()?;
    } else if version != 1 {
        return Err(HistoryError::Schema(version));
    }
    Ok(db)
}

fn prune(tx: &Transaction<'_>) -> Result<()> {
    tx.execute("DELETE FROM payload WHERE NOT EXISTS (SELECT 1 FROM checkpoint_payload WHERE digest = payload.digest)", [])?;
    Ok(())
}

pub struct PendingCheckpoint {
    database: PathBuf,
    id: i64,
    document: String,
}

impl PendingCheckpoint {
    pub fn prepare(
        database: PathBuf,
        document: String,
        revision: &str,
        recoverable: bool,
        data: String,
        attachments: impl IntoIterator<Item = Result<Vec<u8>>>,
    ) -> Result<Self> {
        let mut db = connect(&database)?;
        let tx = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
        tx.execute("INSERT INTO checkpoint(document, revision, data, committed, recoverable) VALUES(?1, ?2, ?3, 0, ?4)",
            params![document, revision, data, recoverable])?;
        let id = tx.last_insert_rowid();
        for (position, bytes) in (0i64..).zip(attachments) {
            let bytes = bytes?;
            let digest = self::revision(&bytes);
            // Avoid binding and copying an entire BLOB when a prior checkpoint already owns it.
            let exists = tx.query_row(
                "SELECT EXISTS(SELECT 1 FROM payload WHERE digest = ?1)",
                [&digest],
                |row| row.get::<_, bool>(0),
            )?;
            if !exists {
                tx.execute(
                    "INSERT INTO payload(digest, data) VALUES(?1, ?2)",
                    params![digest, bytes],
                )?;
            }
            tx.execute(
                "INSERT INTO checkpoint_payload(checkpoint, position, digest) VALUES(?1, ?2, ?3)",
                params![id, position, digest],
            )?;
        }
        tx.commit()?;
        Ok(Self {
            database,
            id,
            document,
        })
    }

    pub fn complete(self, revision: &str) -> Result<()> {
        let mut db = connect(&self.database)?;
        let tx = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
        tx.execute(
            "UPDATE checkpoint SET revision = ?1, committed = 1 WHERE id = ?2",
            params![revision, self.id],
        )?;
        tx.execute(
            "DELETE FROM checkpoint WHERE document = ?1 AND id < ?2",
            params![self.document, self.id],
        )?;
        prune(&tx)?;
        tx.commit()?;
        Ok(())
    }

    pub fn discard(self) -> Result<()> {
        let mut db = connect(&self.database)?;
        let tx = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
        tx.execute("DELETE FROM checkpoint WHERE id = ?1", [self.id])?;
        prune(&tx)?;
        tx.commit()?;
        Ok(())
    }
}

pub fn load(database: &Path, document: &str, revision: &str) -> Result<Option<LoadedCheckpoint>> {
    if !database.try_exists()? {
        return Ok(None);
    }
    let mut db = connect(database)?;
    let tx = db.transaction()?;
    let row = tx.query_row(
        "SELECT id, data FROM checkpoint WHERE document = ?1 AND revision = ?2 AND (committed = 1 OR recoverable = 1)
         ORDER BY committed DESC, id DESC LIMIT 1", params![document, revision],
        |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?)),
    ).optional()?;
    let Some((id, data)) = row else {
        return Ok(None);
    };
    let sizes = {
        let mut query = tx.prepare("SELECT length(payload.data) FROM checkpoint_payload JOIN payload USING(digest) WHERE checkpoint = ?1 ORDER BY position")?;
        let rows = query.query_map([id], |row| row.get::<_, u32>(0).map(|size| size as usize))?;
        rows.collect::<rusqlite::Result<Vec<_>>>()?
    };
    if sizes.iter().sum::<usize>() > 12 * 1024 * 1024 {
        return Ok(Some(LoadedCheckpoint {
            checkpoint: EditCheckpoint {
                data,
                attachments: Vec::new(),
            },
            download: Some(AttachmentDownload { id, sizes }),
        }));
    }
    let attachments = {
        let mut query = tx.prepare("SELECT payload.data FROM checkpoint_payload JOIN payload USING(digest) WHERE checkpoint = ?1 ORDER BY position")?;
        let values = query.query_map([id], |row| {
            let value = row.get_ref(0)?;
            Ok(STANDARD.encode(value.as_blob().map_err(|_| rusqlite::Error::InvalidQuery)?))
        })?;
        values.collect::<rusqlite::Result<Vec<_>>>()?
    };
    Ok(Some(LoadedCheckpoint {
        checkpoint: EditCheckpoint { data, attachments },
        download: None,
    }))
}

pub fn read_chunk(
    database: &Path,
    id: i64,
    index: i64,
    offset: usize,
    limit: usize,
) -> Result<Vec<u8>> {
    let mut db = connect(database)?;
    let tx = db.transaction()?;
    let rowid: i64 = tx.query_row(
        "SELECT payload.rowid FROM checkpoint_payload JOIN payload USING(digest) WHERE checkpoint = ?1 AND position = ?2",
        params![id, index],
        |row| row.get(0),
    )?;
    let blob = tx.blob_open("main", "payload", "data", rowid, true)?;
    if offset >= blob.len() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "invalid edit history chunk offset",
        )
        .into());
    }
    let mut bytes = vec![0; limit.min(blob.len() - offset)];
    blob.read_at_exact(&mut bytes, offset)?;
    Ok(bytes)
}

pub fn clear(database: &Path, document: &str) -> Result<()> {
    if !database.try_exists()? {
        return Ok(());
    }
    let mut db = connect(database)?;
    let tx = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
    tx.execute("DELETE FROM checkpoint WHERE document = ?1", [document])?;
    prune(&tx)?;
    tx.commit()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_database() -> PathBuf {
        std::env::temp_dir().join(format!(
            "maca-edit-history-{}-{}.sqlite3",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
    }

    #[test]
    fn large_attachment_download_reads_ranges_in_checkpoint_order() {
        let database = test_database();
        let document = "package:/large.mdpkg";
        let mut payload = vec![0xab; 12 * 1024 * 1024 + 1];
        payload[12 * 1024 * 1024] = 0xfe;
        PendingCheckpoint::prepare(
            database.clone(),
            document.into(),
            "saved",
            true,
            "large checkpoint".into(),
            [Ok(vec![1, 2, 3]), Ok(payload)],
        )
        .unwrap()
        .complete("saved")
        .unwrap();
        let loaded = load(&database, document, "saved").unwrap().unwrap();
        assert_eq!(loaded.checkpoint.data, "large checkpoint");
        assert!(loaded.checkpoint.attachments.is_empty());
        let download = loaded.download.unwrap();
        assert_eq!(download.sizes, [3, 12 * 1024 * 1024 + 1]);
        assert_eq!(
            read_chunk(&database, download.id, 0, 0, 10).unwrap(),
            [1, 2, 3]
        );
        assert_eq!(
            read_chunk(&database, download.id, 1, 12 * 1024 * 1024 - 1, 10).unwrap(),
            [0xab, 0xfe]
        );
        assert!(read_chunk(&database, download.id, 1, download.sizes[1], 10).is_err());
        clear(&database, document).unwrap();
        assert!(read_chunk(&database, download.id, 1, 0, 10).is_err());
        std::fs::remove_file(database).unwrap();
    }

    #[test]
    fn pending_checkpoints_need_a_changed_disk_revision_or_a_success_marker() {
        let database = test_database();
        let document = "package:/document.mdpkg";
        let prepare = |rev, recoverable, label: &str| {
            PendingCheckpoint::prepare(
                database.clone(),
                document.into(),
                rev,
                recoverable,
                label.into(),
                [Ok(vec![1, 2, 3])],
            )
            .unwrap()
        };
        let read = |rev| {
            load(&database, document, rev)
                .unwrap()
                .map(|history| history.checkpoint.data)
        };

        prepare("old", true, "confirmed").complete("old").unwrap();
        let noop = prepare("old", false, "unconfirmed no-op");
        assert_eq!(read("old").as_deref(), Some("confirmed"));
        noop.discard().unwrap();

        let changed = prepare("new", true, "new history");
        assert_eq!(read("old").as_deref(), Some("confirmed"));
        assert_eq!(read("new").as_deref(), Some("new history"));
        assert_eq!(read("external"), None);
        let db = connect(&database).unwrap();
        let count: i64 = db
            .query_row("SELECT count(*) FROM payload", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 1);
        drop(db);

        changed.complete("new").unwrap();
        assert_eq!(read("old"), None);
        assert_eq!(read("new").as_deref(), Some("new history"));
        clear(&database, document).unwrap();
        assert_eq!(read("new"), None);
        std::fs::remove_file(database).unwrap();
    }
}
