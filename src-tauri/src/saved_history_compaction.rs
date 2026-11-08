use std::ffi::OsString;
use std::fs::{self, File, OpenOptions, TryLockError};
use std::io;
use std::path::{Path, PathBuf};
use std::thread;
use std::time::{Duration, Instant};

use rusqlite::backup::{Backup, StepResult};
use rusqlite::{Connection, ErrorCode};

use super::{connect_sqlite, reclaim_free_pages, HistoryError, Result};

const COPY_PAGES: i32 = 128;
const SQLITE_SIDECARS: [&str; 3] = ["-journal", "-wal", "-shm"];

pub(super) fn sidecar(database: &Path, suffix: &str) -> PathBuf {
    let mut path = OsString::from(database);
    path.push(suffix);
    PathBuf::from(path)
}

fn lock_file(database: &Path, suffix: &str) -> io::Result<File> {
    OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(sidecar(database, suffix))
}

fn exclusive_guard(database: &Path, suffix: &str) -> Result<File> {
    let guard = lock_file(database, suffix)?;
    match guard.try_lock() {
        Ok(()) => Ok(guard),
        Err(TryLockError::WouldBlock) => Err(HistoryError::Busy),
        Err(TryLockError::Error(error)) => Err(error.into()),
    }
}

pub(super) fn read_guard(database: &Path, timeout: Duration) -> Result<File> {
    let guard = lock_file(database, ".publish-lock")?;
    let started = Instant::now();
    loop {
        match guard.try_lock_shared() {
            Ok(()) => return Ok(guard),
            Err(TryLockError::WouldBlock) if started.elapsed() < timeout => {
                thread::sleep(Duration::from_millis(2));
            }
            Err(TryLockError::WouldBlock) => return Err(HistoryError::Busy),
            Err(TryLockError::Error(error)) => return Err(error.into()),
        }
    }
}

struct Scratch(PathBuf);

impl Scratch {
    fn clean(&self) -> io::Result<()> {
        for suffix in ["", "-journal", "-wal", "-shm"] {
            match fs::remove_file(sidecar(&self.0, suffix)) {
                Ok(()) => {}
                Err(error) if error.kind() == io::ErrorKind::NotFound => {}
                Err(error) => return Err(error),
            }
        }
        Ok(())
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = self.clean();
    }
}

fn data_version(db: &Connection) -> rusqlite::Result<i64> {
    db.pragma_query_value(None, "data_version", |row| row.get(0))
}

pub(super) fn rebuild(
    database: &Path,
    last_request: i64,
    should_yield: impl Fn() -> bool + Clone + Send + 'static,
) -> Result<()> {
    if should_yield() {
        return Ok(());
    }

    // Only this lease holder can replace the live file. Keep the source connection open
    // until publication so both data_version reads refer to the same database.
    let _lease = exclusive_guard(database, ".reclaim-lock")?;
    let source = connect_sqlite(database, Duration::ZERO)?;
    let journal_mode: String = source.pragma_query_value(None, "journal_mode", |row| row.get(0))?;
    if journal_mode != "delete" {
        return Err(io::Error::other("history compaction requires DELETE journal mode").into());
    }
    let version = data_version(&source)?;
    let scratch = Scratch(sidecar(database, ".reclaim"));
    scratch.clean()?;
    let mut copy = Connection::open(&scratch.0)?;
    {
        let backup = Backup::new(&source, &mut copy)?;
        loop {
            if should_yield() {
                return Ok(());
            }
            if data_version(&source)? != version {
                return Err(HistoryError::Busy);
            }
            // SQLite releases the source read lock between steps. The copy has its own
            // journal and can be modified without holding a live database write lock.
            match backup.step(COPY_PAGES)? {
                StepResult::Done => break,
                StepResult::More => thread::yield_now(),
                _ => return Err(HistoryError::Busy),
            }
        }
    }
    if should_yield() {
        return Ok(());
    }

    copy.execute_batch("PRAGMA foreign_keys = ON; PRAGMA secure_delete = FAST;")?;
    let tx = copy.transaction()?;
    tx.execute(
        "DELETE FROM payload WHERE digest IN (
            SELECT digest FROM payload JOIN payload_reclaim USING(digest)
            WHERE next_offset = length(data)
        )",
        [],
    )?;
    tx.execute("DELETE FROM reclaim_request WHERE id <= ?1", [last_request])?;
    tx.commit()?;
    if should_yield() {
        return Ok(());
    }
    copy.progress_handler(100, Some(should_yield.clone()))?;
    if let Err(error) = reclaim_free_pages(&copy) {
        if error.sqlite_error_code() == Some(ErrorCode::OperationInterrupted) && should_yield() {
            return Ok(());
        }
        return Err(error.into());
    }
    copy.close().map_err(|(_, error)| error)?;
    OpenOptions::new()
        .write(true)
        .open(&scratch.0)?
        .sync_all()?;
    if should_yield() {
        return Ok(());
    }

    // Only the final version check and atomic rename run while ordinary opens are excluded.
    let publication = exclusive_guard(database, ".publish-lock")?;
    if should_yield() {
        return Ok(());
    }
    if data_version(&source)? != version {
        return Err(HistoryError::Busy);
    }
    source.close().map_err(|(_, error)| error)?;
    for suffix in SQLITE_SIDECARS {
        if sidecar(database, suffix).try_exists()? {
            return Err(HistoryError::Busy);
        }
    }
    if should_yield() {
        return Ok(());
    }
    fs::rename(&scratch.0, database)?;
    drop(publication);
    #[cfg(unix)]
    if let Some(parent) = database
        .parent()
        .filter(|path| !path.as_os_str().is_empty())
    {
        File::open(parent)?.sync_all()?;
    }
    Ok(())
}
