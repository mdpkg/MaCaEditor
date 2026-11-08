use std::fs;
use std::io;
use std::ops::{Deref, DerefMut};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use base64::{engine::general_purpose::STANDARD, Engine};
use rusqlite::{
    params, Connection, ErrorCode, OptionalExtension, Transaction, TransactionBehavior,
};
use sha2::{Digest, Sha256};

#[path = "saved_history_compaction.rs"]
mod compaction;
#[path = "saved_history_management.rs"]
mod management;
#[path = "saved_history_reclaim_batch.rs"]
mod reclaim_batch;
pub use management::{
    delete_missing_saved_edit_histories, delete_saved_edit_history,
    estimate_reclaimable_history_bytes, list_saved_edit_histories, SavedEditHistory,
};
pub(crate) use reclaim_batch::{load_reclaim_batch, ReclaimBatch};

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

#[derive(Default, serde::Serialize)]
pub struct ClearOutcome {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reclaim_warning: Option<String>,
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
    #[error("edit history database changed or is in use")]
    Busy,
}

impl HistoryError {
    pub(crate) fn is_busy(&self) -> bool {
        matches!(self, Self::Busy)
            || matches!(self, Self::Sql(error) if matches!(
                error.sqlite_error_code(), Some(ErrorCode::DatabaseBusy | ErrorCode::DatabaseLocked)
            ))
    }
}

type Result<T> = std::result::Result<T, HistoryError>;

const RECLAIM_CHUNK_BYTES: usize = 4 * 1024 * 1024;

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

struct HistoryConnection {
    db: Connection,
    _publication_guard: fs::File,
}

impl Deref for HistoryConnection {
    type Target = Connection;

    fn deref(&self) -> &Connection {
        &self.db
    }
}

impl DerefMut for HistoryConnection {
    fn deref_mut(&mut self) -> &mut Connection {
        &mut self.db
    }
}

fn connect(path: &Path) -> Result<HistoryConnection> {
    connect_with_timeout(path, Duration::from_secs(5))
}

fn connect_with_timeout(path: &Path, timeout: Duration) -> Result<HistoryConnection> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let publication_guard = compaction::read_guard(path, timeout)?;
    let db = connect_sqlite(path, timeout)?;
    Ok(HistoryConnection {
        db,
        _publication_guard: publication_guard,
    })
}

fn connect_sqlite(path: &Path, timeout: Duration) -> Result<Connection> {
    let mut db = Connection::open(path)?;
    db.busy_timeout(timeout)?;
    db.execute_batch(
        "PRAGMA foreign_keys = ON; PRAGMA secure_delete = ON; PRAGMA synchronous = FULL;",
    )?;
    let version: i64 = db.pragma_query_value(None, "user_version", |row| row.get(0))?;
    if version == 0 {
        db.pragma_update(None, "auto_vacuum", "INCREMENTAL")?;
    }
    if matches!(version, 0..=5) {
        let tx = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
        // Another connection may have finished the migration while this one waited.
        let version: i64 = tx.pragma_query_value(None, "user_version", |row| row.get(0))?;
        if version == 6 {
            tx.commit()?;
            return Ok(db);
        }
        if !(0..=5).contains(&version) {
            return Err(HistoryError::Schema(version));
        }
        if version < 4 {
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
             CREATE TABLE IF NOT EXISTS payload_reclaim (
                digest TEXT PRIMARY KEY REFERENCES payload(digest) ON DELETE CASCADE,
                next_offset INTEGER NOT NULL CHECK(next_offset >= 0)
             );
             CREATE TRIGGER IF NOT EXISTS checkpoint_reject_reclaiming_payload
                BEFORE INSERT ON checkpoint_payload
                WHEN EXISTS (SELECT 1 FROM payload_reclaim WHERE digest = NEW.digest)
                BEGIN SELECT RAISE(ABORT, 'attachment is being reclaimed'); END;
             ALTER TABLE checkpoint ADD COLUMN saved_at INTEGER;",
            )?;
        }
        if version < 5 {
            tx.execute_batch(
                "CREATE TABLE history_generation (
                singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
                token BLOB NOT NULL CHECK(length(token) = 16)
             );
             INSERT INTO history_generation VALUES(1, randomblob(16));",
            )?;
        }
        tx.execute_batch(
            "ALTER TABLE history_generation ADD COLUMN lineage BLOB;
             UPDATE history_generation SET lineage = randomblob(16);
             PRAGMA user_version = 6;",
        )?;
        tx.commit()?;
    } else if version != 6 {
        return Err(HistoryError::Schema(version));
    }
    Ok(db)
}

fn begin_history_write(db: &mut Connection) -> Result<Transaction<'_>> {
    let tx = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
    tx.execute(
        "UPDATE history_generation SET token = randomblob(16) WHERE singleton = 1",
        [],
    )?;
    Ok(tx)
}

fn prune(tx: &Transaction<'_>) -> Result<()> {
    tx.execute("DELETE FROM payload WHERE NOT EXISTS (SELECT 1 FROM checkpoint_payload WHERE digest = payload.digest)", [])?;
    Ok(())
}

fn request_reclaim(tx: &Transaction<'_>) -> Result<()> {
    // A retired payload already belongs to a durable request. Requeuing it would
    // write new request rows on every save while compaction is paused.
    let has_unreferenced_payload = tx.query_row(
        "SELECT EXISTS(
            SELECT 1 FROM payload
            WHERE NOT EXISTS (SELECT 1 FROM checkpoint_payload WHERE digest = payload.digest)
              AND NOT EXISTS (SELECT 1 FROM payload_reclaim WHERE digest = payload.digest)
         )",
        [],
        |row| row.get::<_, bool>(0),
    )?;
    if has_unreferenced_payload {
        enqueue_reclaim(tx)?;
    }
    Ok(())
}

fn enqueue_reclaim(tx: &Transaction<'_>) -> Result<i64> {
    tx.execute_batch(
        "CREATE TABLE IF NOT EXISTS reclaim_request (id INTEGER PRIMARY KEY AUTOINCREMENT);
         INSERT INTO reclaim_request DEFAULT VALUES;",
    )?;
    Ok(tx.last_insert_rowid())
}

fn reclaim_payload_chunk(tx: &Transaction<'_>, key: &str, zeroes: &[u8]) -> Result<bool> {
    // Retire the key before overwriting any bytes. The write lock keeps the orphan check,
    // retirement, and first overwrite atomic with respect to saves.
    tx.execute(
        "INSERT OR IGNORE INTO payload_reclaim(digest, next_offset)
         SELECT digest, 0 FROM payload WHERE digest = ?1
         AND NOT EXISTS (SELECT 1 FROM checkpoint_payload WHERE digest = ?1)",
        [key],
    )?;
    let pending = tx
        .query_row(
            "SELECT payload.rowid, length(payload.data), next_offset
         FROM payload JOIN payload_reclaim USING(digest) WHERE digest = ?1",
            [key],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, u32>(1)? as usize,
                    row.get::<_, u32>(2)? as usize,
                ))
            },
        )
        .optional()?;
    let Some((rowid, size, offset)) = pending else {
        return Ok(true);
    };
    if offset > size {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "invalid attachment reclaim offset",
        )
        .into());
    }
    if offset < size {
        let count = zeroes.len().min(size - offset);
        let mut blob = tx.blob_open("main", "payload", "data", rowid, false)?;
        blob.write_at(&zeroes[..count], offset)?;
        blob.close()?;
        tx.execute(
            "UPDATE payload_reclaim SET next_offset = ?2 WHERE digest = ?1",
            params![key, (offset + count) as u32],
        )?;
        return Ok(offset + count == size);
    }
    Ok(true)
}

pub(crate) enum ReclaimAttempt {
    Idle,
    Yielded,
    Published {
        first_request_id: i64,
        through_request_id: i64,
        released_bytes: Option<u64>,
        request_count: usize,
    },
}

pub(crate) fn reclaim_pending(
    database: &Path,
    should_yield: impl Fn() -> bool + Clone + Send + 'static,
) -> Result<ReclaimAttempt> {
    if should_yield() {
        return Ok(ReclaimAttempt::Yielded);
    }
    if !database.try_exists()? {
        return Ok(ReclaimAttempt::Idle);
    }
    let _lease = compaction::reclaim_guard(database)?;
    let mut db = connect_with_timeout(database, Duration::ZERO)?;
    let has_requests_table = db.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'reclaim_request')",
        [],
        |row| row.get::<_, bool>(0),
    )?;
    if !has_requests_table {
        return Ok(ReclaimAttempt::Idle);
    }
    let last_request: Option<i64> =
        db.query_row("SELECT max(id) FROM reclaim_request", [], |row| row.get(0))?;
    let Some(last_request) = last_request else {
        return Ok(ReclaimAttempt::Idle);
    };

    let candidates = {
        let mut query = db.prepare(
            "SELECT digest FROM payload
             WHERE NOT EXISTS (SELECT 1 FROM checkpoint_payload WHERE digest = payload.digest)
               AND NOT EXISTS (SELECT 1 FROM payload_reclaim
                               WHERE digest = payload.digest AND next_offset = octet_length(payload.data))",
        )?;
        let rows = query.query_map([], |row| row.get::<_, String>(0))?;
        rows.collect::<rusqlite::Result<Vec<_>>>()?
    };
    if !candidates.is_empty() {
        let zeroes = vec![0; RECLAIM_CHUNK_BYTES];
        for key in candidates {
            loop {
                if should_yield() {
                    return Ok(ReclaimAttempt::Yielded);
                }
                let tx = begin_history_write(&mut db)?;
                if should_yield() {
                    return Ok(ReclaimAttempt::Yielded);
                }
                let finished = reclaim_payload_chunk(&tx, &key, &zeroes)?;
                tx.commit()?;
                if finished {
                    break;
                }
            }
        }
    }
    drop(db);
    compaction::rebuild(database, last_request, should_yield)
}

pub struct PendingCheckpoint {
    db: HistoryConnection,
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
        let tx = begin_history_write(&mut db)?;
        tx.execute("INSERT INTO checkpoint(document, revision, data, committed, recoverable) VALUES(?1, ?2, ?3, 0, ?4)",
            params![document, revision, data, recoverable])?;
        let id = tx.last_insert_rowid();
        for (position, bytes) in (0i64..).zip(attachments) {
            let bytes = bytes?;
            let digest = self::revision(&bytes);
            // Older payloads use the hash itself. New keys have a unique suffix so that
            // a save can store identical bytes even while a previous copy is being erased.
            let live_key: Option<String> = tx
                .query_row(
                    "SELECT digest FROM payload WHERE digest >= ?1 AND digest < ?2
                 AND NOT EXISTS (SELECT 1 FROM payload_reclaim WHERE digest = payload.digest)
                 ORDER BY digest LIMIT 1",
                    params![digest, format!("{digest};")],
                    |row| row.get(0),
                )
                .optional()?;
            let key = match live_key {
                Some(key) => key,
                None => {
                    let key = format!("{digest}:{id}:{position}");
                    tx.execute(
                        "INSERT INTO payload(digest, data) VALUES(?1, ?2)",
                        params![key, bytes],
                    )?;
                    key
                }
            };
            tx.execute(
                "INSERT INTO checkpoint_payload(checkpoint, position, digest) VALUES(?1, ?2, ?3)",
                params![id, position, key],
            )?;
        }
        tx.commit()?;
        Ok(Self { db, id, document })
    }

    pub fn complete(mut self, revision: &str) -> Result<()> {
        let tx = begin_history_write(&mut self.db)?;
        let saved_at = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .ok()
            .and_then(|elapsed| i64::try_from(elapsed.as_millis()).ok());
        tx.execute(
            "UPDATE checkpoint SET revision = ?1, committed = 1, saved_at = ?2 WHERE id = ?3",
            params![revision, saved_at, self.id],
        )?;
        let removed = tx.execute(
            "DELETE FROM checkpoint WHERE document = ?1 AND id < ?2",
            params![self.document, self.id],
        )?;
        if removed > 0 {
            request_reclaim(&tx)?;
        }
        tx.commit()?;
        Ok(())
    }

    pub fn discard(mut self) -> Result<()> {
        let tx = begin_history_write(&mut self.db)?;
        tx.execute("DELETE FROM checkpoint WHERE id = ?1", [self.id])?;
        request_reclaim(&tx)?;
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

pub fn clear(database: &Path, document: &str) -> Result<ClearOutcome> {
    if !database.try_exists()? {
        return Ok(ClearOutcome::default());
    }
    // VACUUM can renumber implicit rowids used by the background copy cursor.
    let reclaim = compaction::reclaim_guard(database);
    let mut db = connect(database)?;
    let tx = begin_history_write(&mut db)?;
    tx.execute("DELETE FROM checkpoint WHERE document = ?1", [document])?;
    prune(&tx)?;
    if reclaim.is_err() {
        enqueue_reclaim(&tx)?;
    }
    tx.commit()?;

    // VACUUM needs its own transaction. Keep the deletion committed if reclaiming space fails.
    let reclaim_warning = match reclaim {
        Ok(_lease) => reclaim_free_pages(&db).err().map(|error| error.to_string()),
        Err(error) => Some(error.to_string()),
    };
    Ok(ClearOutcome { reclaim_warning })
}

fn reclaim_free_pages(db: &Connection) -> rusqlite::Result<()> {
    let free_pages: u32 = db.pragma_query_value(None, "freelist_count", |row| row.get(0))?;
    if free_pages > 0 {
        db.execute_batch("VACUUM")?;
    }
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
    fn keeps_the_same_history_connection_until_the_save_is_finalized() {
        let database = test_database();
        let document = "package:/saved";
        let pending = PendingCheckpoint::prepare(
            database.clone(),
            document.into(),
            "rev",
            true,
            "history".into(),
            [],
        )
        .unwrap();
        let guard_path = compaction::sidecar(&database, ".publish-lock");
        let publisher = fs::OpenOptions::new()
            .read(true)
            .write(true)
            .open(guard_path)
            .unwrap();
        // The pending save owns the same publication guard across both transactions.
        assert!(matches!(
            publisher.try_lock(),
            Err(fs::TryLockError::WouldBlock)
        ));
        pending.complete("rev").unwrap();
        publisher.try_lock().unwrap();
        drop(publisher);
        assert_eq!(
            load(&database, document, "rev")
                .unwrap()
                .unwrap()
                .checkpoint
                .data,
            "history"
        );
        remove_test_database(&database);
    }

    #[test]
    fn records_the_time_when_a_checkpoint_is_committed() {
        let database = test_database();
        PendingCheckpoint::prepare(
            database.clone(),
            "package:/saved.mdpkg".into(),
            "saved",
            true,
            "history".into(),
            [],
        )
        .unwrap()
        .complete("saved")
        .unwrap();
        let db = connect(&database).unwrap();
        let saved_at: i64 = db
            .query_row("SELECT saved_at FROM checkpoint", [], |row| row.get(0))
            .unwrap();
        assert!(saved_at > 0);
        drop(db);
        remove_test_database(&database);
    }

    fn remove_test_database(database: &Path) {
        fs::remove_file(database).unwrap();
        for suffix in [
            ".publish-lock",
            ".reclaim-lock",
            ".reclaim",
            ".reclaim-journal",
        ] {
            let path = compaction::sidecar(database, suffix);
            if path.exists() {
                fs::remove_file(path).unwrap();
            }
        }
    }

    #[test]
    fn final_page_release_can_pause_without_deleting_the_live_payload() {
        let database = test_database();
        let document = "package:/branch";
        for (revision, attachments) in [
            ("old", vec![Ok(vec![0; 9 * 1024 * 1024])]),
            ("branch", vec![]),
        ] {
            PendingCheckpoint::prepare(
                database.clone(),
                document.into(),
                revision,
                true,
                revision.into(),
                attachments,
            )
            .unwrap()
            .complete(revision)
            .unwrap();
        }
        let db = connect(&database).unwrap();
        db.execute(
            "INSERT INTO payload_reclaim SELECT digest, length(data) FROM payload",
            [],
        )
        .unwrap();
        drop(db);

        let scratch = database.with_extension("sqlite3.reclaim");
        reclaim_pending(&database, move || scratch.exists()).unwrap();

        let db = connect(&database).unwrap();
        let pending: u32 = db
            .query_row("SELECT count(*) FROM payload_reclaim", [], |row| row.get(0))
            .unwrap();
        drop(db);
        remove_test_database(&database);
        assert_eq!(
            pending, 1,
            "the original must still have the pending payload when final release yields"
        );
    }

    #[test]
    fn compaction_resumes_the_same_scratch_database_mid_attachment() {
        use std::sync::{
            atomic::{AtomicBool, Ordering},
            Arc,
        };
        let database = test_database();
        let retired = "package:/retired";
        let kept = "folder:/retained";
        let mib = 1024 * 1024;
        for (document, revision, attachments) in [
            (retired, "old", vec![Ok(vec![0xcd; 32 * mib])]),
            (kept, "keep", vec![Ok(vec![0xab; 24 * mib])]),
            (retired, "latest", vec![]),
        ] {
            PendingCheckpoint::prepare(
                database.clone(),
                document.into(),
                revision,
                true,
                revision.into(),
                attachments,
            )
            .unwrap()
            .complete(revision)
            .unwrap();
        }
        let scratch = compaction::sidecar(&database, ".reclaim");
        fn copied(path: &Path) -> Option<u32> {
            let db = Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
                .ok()?;
            db.busy_timeout(Duration::ZERO).ok()?;
            db.query_row(
                "SELECT blob_offset FROM reclaim_copy WHERE stage = 1 AND row_cursor = 2",
                [],
                |row| row.get(0),
            )
            .ok()
        }
        let observed = scratch.clone();
        assert!(matches!(
            reclaim_pending(&database, move || copied(&observed)
                .is_some_and(|offset| offset > 0))
            .unwrap(),
            ReclaimAttempt::Yielded
        ));
        let offset = copied(&scratch)
            .expect("the interrupted compaction must retain its scratch DB and cursor");
        assert!(offset > 0 && offset < 24 * mib as u32);
        let saved = "package:/during-compaction";
        for revision in ["first", "second", "third"] {
            PendingCheckpoint::prepare(
                database.clone(),
                saved.into(),
                revision,
                true,
                revision.into(),
                [Ok(vec![1, 2, 3])],
            )
            .unwrap()
            .complete(revision)
            .unwrap();
        }
        let before = fs::metadata(&database).unwrap().len();
        let allocated_before = compaction::allocated_bytes(&database).unwrap();
        let observed = scratch.clone();
        let restarted_from_zero = Arc::new(AtomicBool::new(false));
        let reset = restarted_from_zero.clone();
        let result = reclaim_pending(&database, move || {
            if copied(&observed).is_some_and(|current| current < offset) {
                reset.store(true, Ordering::Relaxed);
            }
            false
        })
        .unwrap();
        assert!(!restarted_from_zero.load(Ordering::Relaxed));
        let ReclaimAttempt::Published { released_bytes, .. } = result else {
            panic!("resumed compaction did not publish");
        };
        assert_eq!(
            released_bytes,
            Some(allocated_before - compaction::allocated_bytes(&database).unwrap())
        );
        assert!(before - fs::metadata(&database).unwrap().len() >= 31 * mib as u64);
        let download = load(&database, kept, "keep")
            .unwrap()
            .unwrap()
            .download
            .unwrap();
        assert_eq!(download.sizes, [24 * mib]);
        assert_eq!(
            read_chunk(&database, download.id, 0, 24 * mib - 1, 1).unwrap(),
            [0xab]
        );
        let latest = load(&database, saved, "third").unwrap().unwrap().checkpoint;
        assert_eq!(latest.data, "third");
        assert_eq!(latest.attachments, ["AQID"]);
        assert!(load(&database, saved, "first").unwrap().is_none());
        remove_test_database(&database);
    }

    #[test]
    fn stale_or_busy_compaction_never_replaces_the_current_database() {
        use std::sync::{
            atomic::{AtomicBool, Ordering},
            Arc,
        };

        let database = test_database();
        let target = "package:/branch";
        let other = "folder:/later";
        // The save below removes a blob already in the scratch DB. Its pages need to be
        // released without rebuilding the unaffected rows.
        PendingCheckpoint::prepare(
            database.clone(),
            other.into(),
            "previous",
            true,
            "previous".into(),
            [Ok(vec![0x34; 8 * 1024 * 1024])],
        )
        .unwrap()
        .complete("previous")
        .unwrap();
        for (revision, attachments) in [
            ("old", vec![Ok(vec![0; 9 * 1024 * 1024])]),
            ("branch", vec![]),
        ] {
            PendingCheckpoint::prepare(
                database.clone(),
                target.into(),
                revision,
                true,
                revision.into(),
                attachments,
            )
            .unwrap()
            .complete(revision)
            .unwrap();
        }
        let db = connect(&database).unwrap();
        db.execute(
            "INSERT INTO payload_reclaim
             SELECT digest, length(data) FROM payload
             WHERE NOT EXISTS (SELECT 1 FROM checkpoint_payload WHERE digest = payload.digest)",
            [],
        )
        .unwrap();
        drop(db);

        let live = database.clone();
        let scratch = compaction::sidecar(&database, ".reclaim");
        let observed_scratch = scratch.clone();
        let saved = Arc::new(AtomicBool::new(false));
        let did_save = saved.clone();
        let result = reclaim_pending(&database, move || {
            // Start a new save after the copy has been compacted, but before publication.
            let complete = Connection::open_with_flags(
                &observed_scratch,
                rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
            )
            .and_then(|db| {
                db.busy_timeout(Duration::ZERO)?;
                db.query_row("SELECT stage = 14 FROM reclaim_copy", [], |row| {
                    row.get::<_, bool>(0)
                })
            })
            .unwrap_or(false);
            if complete && !did_save.swap(true, Ordering::Relaxed) {
                PendingCheckpoint::prepare(
                    live.clone(),
                    other.into(),
                    "latest",
                    true,
                    "newer history".into(),
                    [Ok(vec![1, 2, 3])],
                )
                .unwrap()
                .complete("latest")
                .unwrap();
            }
            false
        });
        assert!(saved.load(Ordering::Relaxed));
        assert!(matches!(result, Err(HistoryError::Busy)));
        assert!(scratch.exists());
        assert!(fs::metadata(&database).unwrap().len() > 9 * 1024 * 1024);

        let reader = connect(&database).unwrap();
        assert!(matches!(
            reclaim_pending(&database, || false),
            Err(HistoryError::Busy)
        ));
        drop(reader);

        reclaim_pending(&database, || false).unwrap();
        assert!(fs::metadata(&database).unwrap().len() < 128 * 1024);
        let newer = load(&database, other, "latest")
            .unwrap()
            .unwrap()
            .checkpoint;
        assert_eq!(newer.data, "newer history");
        assert_eq!(newer.attachments, ["AQID"]);
        assert!(load(&database, target, "branch").unwrap().is_some());
        remove_test_database(&database);
    }

    #[test]
    fn a_single_attachment_can_pause_after_its_first_reclaim_batch() {
        let database = test_database();
        let document = "package:/branch";
        let size = 9 * 1024 * 1024;
        for (revision, attachments) in [("old", vec![Ok(vec![0xcd; size])]), ("branch", vec![])] {
            PendingCheckpoint::prepare(
                database.clone(),
                document.into(),
                revision,
                true,
                revision.into(),
                attachments,
            )
            .unwrap()
            .complete(revision)
            .unwrap();
        }

        fn edges(path: &Path) -> Option<[u8; 2]> {
            let db = Connection::open(path).unwrap();
            let id = db
                .query_row("SELECT rowid FROM payload", [], |row| row.get(0))
                .optional()
                .unwrap()?;
            let blob = db.blob_open("main", "payload", "data", id, true).unwrap();
            let mut result = [0; 2];
            blob.read_at_exact(&mut result[..1], 0).unwrap();
            blob.read_at_exact(&mut result[1..], blob.len() - 1)
                .unwrap();
            Some(result)
        }
        let observe = database.clone();
        reclaim_pending(&database, move || {
            edges(&observe).is_none_or(|bytes| bytes[0] == 0)
        })
        .unwrap();
        assert_eq!(
            edges(&database),
            Some([0, 0xcd]),
            "a save must be able to pause inside one large attachment"
        );
        let db = connect(&database).unwrap();
        let offset: usize = db
            .query_row("SELECT next_offset FROM payload_reclaim", [], |row| {
                row.get::<_, u32>(0)
            })
            .unwrap() as usize;
        assert_eq!(offset, RECLAIM_CHUNK_BYTES);
        drop(db);

        let other = "folder:/keep";
        PendingCheckpoint::prepare(
            database.clone(),
            other.into(),
            "keep",
            true,
            "saved redo".into(),
            [Ok(vec![0xcd; size])],
        )
        .unwrap()
        .complete("keep")
        .unwrap();
        let db = connect(&database).unwrap();
        let count: u32 = db
            .query_row("SELECT count(*) FROM payload", [], |row| row.get(0))
            .unwrap();
        assert_eq!(
            count, 2,
            "a new save must not reuse the partially erased bytes"
        );
        drop(db);

        let before = fs::metadata(&database).unwrap().len();
        reclaim_pending(&database, || false).unwrap();
        assert!(before.saturating_sub(fs::metadata(&database).unwrap().len()) >= size as u64);
        let recovered = load(&database, other, "keep").unwrap().unwrap().checkpoint;
        assert_eq!(recovered.data, "saved redo");
        let bytes = STANDARD.decode(&recovered.attachments[0]).unwrap();
        assert_eq!(bytes.len(), size);
        assert!(bytes.iter().all(|&byte| byte == 0xcd));
        remove_test_database(&database);
    }

    #[test]
    fn upgrades_existing_checkpoints_and_reuses_legacy_payload_keys() {
        let database = test_database();
        let db = Connection::open(&database).unwrap();
        db.execute_batch(
            "CREATE TABLE checkpoint (
                id INTEGER PRIMARY KEY AUTOINCREMENT, document TEXT NOT NULL, revision TEXT NOT NULL,
                data TEXT NOT NULL, committed INTEGER NOT NULL, recoverable INTEGER NOT NULL
             );
             CREATE TABLE payload (digest TEXT PRIMARY KEY, data BLOB NOT NULL);
             CREATE TABLE checkpoint_payload (
                checkpoint INTEGER NOT NULL REFERENCES checkpoint(id) ON DELETE CASCADE,
                position INTEGER NOT NULL, digest TEXT NOT NULL REFERENCES payload(digest),
                PRIMARY KEY(checkpoint, position)
             );
             PRAGMA user_version = 1;
             INSERT INTO checkpoint VALUES (1, 'package:/legacy', 'rev', 'old cursor', 1, 1);"
        ).unwrap();
        let data = vec![1, 2, 3];
        let digest = revision(&data);
        db.execute("INSERT INTO payload VALUES (?1, ?2)", params![digest, data])
            .unwrap();
        db.execute(
            "INSERT INTO checkpoint_payload VALUES (1, 0, ?1)",
            [&digest],
        )
        .unwrap();
        drop(db);

        PendingCheckpoint::prepare(
            database.clone(),
            "folder:/other".into(),
            "rev",
            true,
            "new cursor".into(),
            [Ok(data)],
        )
        .unwrap()
        .complete("rev")
        .unwrap();
        let db = connect(&database).unwrap();
        let version: i64 = db
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .unwrap();
        assert_eq!(version, 6);
        let legacy_saved_at: Option<i64> = db
            .query_row(
                "SELECT saved_at FROM checkpoint WHERE document = 'package:/legacy'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(legacy_saved_at, None);
        let count: u32 = db
            .query_row("SELECT count(*) FROM payload", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 1);
        drop(db);
        let legacy = load(&database, "package:/legacy", "rev")
            .unwrap()
            .unwrap()
            .checkpoint;
        assert_eq!(legacy.data, "old cursor");
        assert_eq!(legacy.attachments, ["AQID"]);
        remove_test_database(&database);
    }

    #[test]
    fn background_reclaim_does_not_wait_for_a_save_holding_the_write_lock() {
        let database = test_database();
        let document = "package:/branch";
        for (revision, attachments) in
            [("old", vec![Ok(vec![0xcd; 64 * 1024])]), ("branch", vec![])]
        {
            PendingCheckpoint::prepare(
                database.clone(),
                document.into(),
                revision,
                true,
                revision.into(),
                attachments,
            )
            .unwrap()
            .complete(revision)
            .unwrap();
        }
        let mut foreground = connect(&database).unwrap();
        let save = foreground
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .unwrap();
        let start = std::time::Instant::now();
        let _ = reclaim_pending(&database, || false);
        let elapsed = start.elapsed();
        save.commit().unwrap();
        drop(foreground);
        remove_test_database(&database);
        assert!(
            elapsed < Duration::from_secs(1),
            "maintenance waited {elapsed:?} on a foreground writer"
        );
    }

    #[test]
    fn reclaim_can_pause_between_attachments_and_resume_with_the_saved_request() {
        let database = test_database();
        let document = "package:/branch";
        for (revision, attachments) in [
            (
                "old",
                vec![
                    Ok(vec![0xcd; 2 * 1024 * 1024]),
                    Ok(vec![0xce; 2 * 1024 * 1024]),
                ],
            ),
            ("branch", vec![]),
        ] {
            PendingCheckpoint::prepare(
                database.clone(),
                document.into(),
                revision,
                true,
                revision.into(),
                attachments,
            )
            .unwrap()
            .complete(revision)
            .unwrap();
        }
        let original_size = fs::metadata(&database).unwrap().len();
        let observe = database.clone();
        reclaim_pending(&database, move || {
            // Request a pause when the first complete erase becomes visible to another connection.
            let db = Connection::open(&observe).unwrap();
            let count: u32 = db
                .query_row("SELECT count(*) FROM payload_reclaim JOIN payload USING(digest) WHERE next_offset = length(data)", [], |row| row.get(0))
                .unwrap();
            count == 1
        })
        .unwrap();

        let db = connect(&database).unwrap();
        let count: u32 = db
            .query_row("SELECT count(*) FROM payload_reclaim JOIN payload USING(digest) WHERE next_offset = length(data)", [], |row| row.get(0))
            .unwrap();
        let pending: u32 = db
            .query_row("SELECT count(*) FROM reclaim_request", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 1);
        assert_eq!(pending, 1);
        assert_eq!(fs::metadata(&database).unwrap().len(), original_size);
        drop(db);

        reclaim_pending(&database, || false).unwrap();
        assert!(fs::metadata(&database).unwrap().len() < 128 * 1024);
        assert_eq!(
            load(&database, document, "branch")
                .unwrap()
                .unwrap()
                .checkpoint
                .data,
            "branch"
        );
        remove_test_database(&database);
    }

    #[test]
    fn deferred_compaction_preserves_the_request_and_saved_payloads() {
        let database = test_database();
        let document = "folder:/branch";
        let survivor = "package:/keep";
        for (path, revision, attachments) in [
            (document, "old", vec![Ok(vec![0xcd; 2 * 1024 * 1024])]),
            (
                survivor,
                "keep",
                (0..32).map(|value| Ok(vec![value; 1024])).collect(),
            ),
            (document, "branch", vec![]),
        ] {
            PendingCheckpoint::prepare(
                database.clone(),
                path.into(),
                revision,
                true,
                revision.into(),
                attachments,
            )
            .unwrap()
            .complete(revision)
            .unwrap();
        }
        let mut db = connect(&database).unwrap();
        let tx = db.transaction().unwrap();
        prune(&tx).unwrap();
        tx.commit().unwrap();
        drop(db);
        let original_size = fs::metadata(&database).unwrap().len();
        let scratch = compaction::sidecar(&database, ".reclaim");
        reclaim_pending(&database, move || scratch.exists()).unwrap();
        assert_eq!(fs::metadata(&database).unwrap().len(), original_size);
        let before = load(&database, survivor, "keep")
            .unwrap()
            .unwrap()
            .checkpoint;
        assert_eq!(before.attachments.len(), 32);

        reclaim_pending(&database, || false).unwrap();
        assert!(fs::metadata(&database).unwrap().len() < 256 * 1024);
        assert_eq!(
            load(&database, survivor, "keep")
                .unwrap()
                .unwrap()
                .checkpoint,
            before
        );
        remove_test_database(&database);
    }

    #[test]
    fn saving_a_new_branch_leaves_obsolete_attachments_for_background_reclaim() {
        let database = test_database();
        let target = "package:/branch.mdpkg";
        let other = "folder:/keep";
        let unique_bytes = 48 * 1024 * 1024;
        let shared = vec![0xab; 16 * 1024 * 1024];
        PendingCheckpoint::prepare(
            database.clone(),
            target.into(),
            "old",
            true,
            "saved redo".into(),
            [Ok(vec![0xcd; unique_bytes]), Ok(shared.clone())],
        )
        .unwrap()
        .complete("old")
        .unwrap();
        PendingCheckpoint::prepare(
            database.clone(),
            other.into(),
            "keep",
            true,
            "other undo and redo".into(),
            [Ok(shared)],
        )
        .unwrap()
        .complete("keep")
        .unwrap();
        PendingCheckpoint::prepare(
            database.clone(),
            target.into(),
            "branch",
            true,
            "new branch".into(),
            [],
        )
        .unwrap()
        .complete("branch")
        .unwrap();

        assert!(load(&database, target, "old").unwrap().is_none());
        let db = connect(&database).unwrap();
        let payload_count: u32 = db
            .query_row("SELECT count(*) FROM payload", [], |row| row.get(0))
            .unwrap();
        drop(db);
        let original_size = fs::metadata(&database).unwrap().len();
        assert_eq!(
            payload_count, 2,
            "saving the branch should leave the large BLOB for background work"
        );

        reclaim_pending(&database, || false).unwrap();

        let compacted_size = fs::metadata(&database).unwrap().len();
        assert!(original_size.saturating_sub(compacted_size) >= unique_bytes as u64,
            "expected at least {unique_bytes} bytes back, file went from {original_size} to {compacted_size} bytes");
        let branch = load(&database, target, "branch").unwrap().unwrap();
        assert_eq!(branch.checkpoint.data, "new branch");
        let survivor = load(&database, other, "keep").unwrap().unwrap();
        assert_eq!(survivor.checkpoint.data, "other undo and redo");
        let download = survivor.download.unwrap();
        assert_eq!(download.sizes, [16 * 1024 * 1024]);
        assert_eq!(
            read_chunk(&database, download.id, 0, 16 * 1024 * 1024 - 1, 1).unwrap(),
            [0xab]
        );

        let db = connect(&database).unwrap();
        let requests: u32 = db
            .query_row("SELECT count(*) FROM reclaim_request", [], |row| row.get(0))
            .unwrap();
        assert_eq!(requests, 0);
        drop(db);
        remove_test_database(&database);
    }

    #[test]
    fn resumes_pending_reclaim_after_payload_deletion_committed() {
        let database = test_database();
        let document = "folder:/branch";
        PendingCheckpoint::prepare(
            database.clone(),
            document.into(),
            "old",
            true,
            "saved redo".into(),
            [Ok(vec![0xcd; 2 * 1024 * 1024])],
        )
        .unwrap()
        .complete("old")
        .unwrap();
        PendingCheckpoint::prepare(
            database.clone(),
            document.into(),
            "branch",
            true,
            "saved branch".into(),
            [],
        )
        .unwrap()
        .complete("branch")
        .unwrap();

        // Model interruption between the worker's deletion and VACUUM.
        let mut db = connect(&database).unwrap();
        let tx = db.transaction().unwrap();
        prune(&tx).unwrap();
        tx.commit().unwrap();
        drop(db);
        reclaim_pending(&database, || false).unwrap();

        assert!(fs::metadata(&database).unwrap().len() < 128 * 1024);
        assert_eq!(
            load(&database, document, "branch")
                .unwrap()
                .unwrap()
                .checkpoint
                .data,
            "saved branch"
        );
        remove_test_database(&database);
    }

    #[test]
    fn saving_does_not_requeue_retired_payloads_but_queues_a_new_orphan() {
        let database = test_database();
        let retired = "package:/retired";
        let kept = "folder:/kept";
        let save = |document: &str, rev: &str, payload: Option<Vec<u8>>| {
            PendingCheckpoint::prepare(
                database.clone(),
                document.into(),
                rev,
                true,
                rev.into(),
                payload.into_iter().map(Ok),
            )
            .unwrap()
            .complete(rev)
            .unwrap();
        };
        save(retired, "old", Some(vec![0; 8192]));
        save(kept, "first", Some(vec![1, 2, 3]));
        save(retired, "new", None);
        let db = connect(&database).unwrap();
        db.execute(
            "INSERT INTO payload_reclaim
             SELECT digest, octet_length(data) FROM payload
             WHERE NOT EXISTS (SELECT 1 FROM checkpoint_payload WHERE digest = payload.digest)",
            [],
        )
        .unwrap();
        drop(db);
        let count = || {
            let db = connect(&database).unwrap();
            db.query_row("SELECT count(*) FROM reclaim_request", [], |row| {
                row.get::<_, i64>(0)
            })
            .unwrap()
        };
        assert_eq!(count(), 1);
        save(kept, "second", Some(vec![1, 2, 3]));
        assert_eq!(count(), 1);
        save(kept, "third", None);
        assert_eq!(count(), 2);
        reclaim_pending(&database, || false).unwrap();
        assert_eq!(count(), 0);
        remove_test_database(&database);
    }

    #[test]
    fn keeps_shared_payloads_without_requesting_reclaim() {
        let database = test_database();
        let document = "package:/branch";
        for (path, revision, attachments) in [
            (document, "old", vec![Ok(vec![1, 2, 3])]),
            ("folder:/keep", "keep", vec![Ok(vec![1, 2, 3])]),
            (document, "branch", vec![]),
        ] {
            PendingCheckpoint::prepare(
                database.clone(),
                path.into(),
                revision,
                true,
                revision.into(),
                attachments,
            )
            .unwrap()
            .complete(revision)
            .unwrap();
        }
        reclaim_pending(&database, || false).unwrap();
        let db = connect(&database).unwrap();
        let maintenance_tables: u32 = db
            .query_row(
                "SELECT count(*) FROM sqlite_schema WHERE name = 'reclaim_request'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(maintenance_tables, 0);
        drop(db);
        remove_test_database(&database);
    }

    #[test]
    fn clearing_one_document_releases_disk_space_and_preserves_other_checkpoints() {
        let database = test_database();
        let target = "package:/clear.mdpkg";
        let other = "folder:/keep";
        let shared = vec![0xab; 16 * 1024 * 1024];
        let unique_bytes = 48 * 1024 * 1024;
        PendingCheckpoint::prepare(
            database.clone(),
            target.into(),
            "package revision",
            true,
            "clear this".into(),
            [Ok(vec![0xcd; unique_bytes]), Ok(shared.clone())],
        )
        .unwrap()
        .complete("package revision")
        .unwrap();
        PendingCheckpoint::prepare(
            database.clone(),
            other.into(),
            "folder revision",
            true,
            "keep undo and redo".into(),
            [Ok(vec![1, 2, 3]), Ok(shared)],
        )
        .unwrap()
        .complete("folder revision")
        .unwrap();
        let other_id = load(&database, other, "folder revision")
            .unwrap()
            .unwrap()
            .download
            .unwrap()
            .id;
        let original_size = fs::metadata(&database).unwrap().len();

        assert!(clear(&database, target).unwrap().reclaim_warning.is_none());

        assert!(load(&database, target, "package revision")
            .unwrap()
            .is_none());
        let reopened = load(&database, other, "folder revision").unwrap().unwrap();
        assert_eq!(reopened.checkpoint.data, "keep undo and redo");
        let download = reopened.download.unwrap();
        assert_eq!(download.id, other_id);
        assert_eq!(download.sizes, [3, 16 * 1024 * 1024]);
        assert_eq!(read_chunk(&database, other_id, 0, 0, 3).unwrap(), [1, 2, 3]);
        assert_eq!(
            read_chunk(&database, other_id, 1, 16 * 1024 * 1024 - 1, 1).unwrap(),
            [0xab]
        );
        let compacted_size = fs::metadata(&database).unwrap().len();
        remove_test_database(&database);
        assert!(original_size.saturating_sub(compacted_size) >= unique_bytes as u64,
            "expected at least {unique_bytes} bytes back, file went from {original_size} to {compacted_size} bytes");
    }

    #[test]
    fn clearing_again_reclaims_space_left_by_an_earlier_deletion() {
        let database = test_database();
        let document = "package:/cleared.mdpkg";
        PendingCheckpoint::prepare(
            database.clone(),
            document.into(),
            "rev",
            true,
            "old history".into(),
            [Ok(vec![0xcd; 2 * 1024 * 1024])],
        )
        .unwrap()
        .complete("rev")
        .unwrap();
        // Model an older version (or a previous clear that committed before compaction).
        let mut db = connect(&database).unwrap();
        let tx = db.transaction().unwrap();
        tx.execute("DELETE FROM checkpoint WHERE document = ?1", [document])
            .unwrap();
        prune(&tx).unwrap();
        tx.commit().unwrap();
        drop(db);

        assert!(clear(&database, document)
            .unwrap()
            .reclaim_warning
            .is_none());

        let size = fs::metadata(&database).unwrap().len();
        remove_test_database(&database);
        assert!(
            size < 128 * 1024,
            "empty database still occupies {size} bytes"
        );
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
        remove_test_database(&database);
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
        remove_test_database(&database);
    }
}
