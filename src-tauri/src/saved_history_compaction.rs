use std::ffi::OsString;
use std::fs::{self, File, OpenOptions, TryLockError};
use std::io;
use std::path::{Path, PathBuf};
use std::thread;
use std::time::{Duration, Instant};

use rusqlite::Connection;

use super::{connect_sqlite, reclaim_batch, HistoryError, ReclaimAttempt, Result};

#[path = "saved_history_compaction_copy.rs"]
mod copy;

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

pub(super) fn reclaim_guard(database: &Path) -> Result<File> {
    exclusive_guard(database, ".reclaim-lock")
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

fn data_version(db: &Connection) -> rusqlite::Result<i64> {
    db.pragma_query_value(None, "data_version", |row| row.get(0))
}

#[cfg(unix)]
pub(super) fn allocated_bytes(path: &Path) -> Option<u64> {
    use std::os::unix::fs::MetadataExt;
    Some(fs::metadata(path).ok()?.blocks() * 512)
}

#[cfg(windows)]
pub(super) fn allocated_bytes(path: &Path) -> Option<u64> {
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::Storage::FileSystem::{
        FileStandardInfo, GetFileInformationByHandleEx, FILE_STANDARD_INFO,
    };

    let file = File::open(path).ok()?;
    let mut info = FILE_STANDARD_INFO::default();
    // The handle remains open and the output buffer matches the requested information class.
    let read = unsafe {
        GetFileInformationByHandleEx(
            file.as_raw_handle(),
            FileStandardInfo,
            (&mut info as *mut FILE_STANDARD_INFO).cast(),
            std::mem::size_of::<FILE_STANDARD_INFO>() as u32,
        )
    };
    (read != 0)
        .then(|| u64::try_from(info.AllocationSize).ok())
        .flatten()
}

pub(super) fn rebuild(
    database: &Path,
    last_request: i64,
    should_yield: impl Fn() -> bool + Clone + Send + 'static,
) -> Result<ReclaimAttempt> {
    if should_yield() {
        return Ok(ReclaimAttempt::Yielded);
    }

    // Keep the source connection open under the worker's reclaim lease so both
    // data_version reads refer to the same live database.
    let source = connect_sqlite(database, Duration::ZERO)?;
    let journal_mode: String = source.pragma_query_value(None, "journal_mode", |row| row.get(0))?;
    if journal_mode != "delete" {
        return Err(io::Error::other("history compaction requires DELETE journal mode").into());
    }
    let version = data_version(&source)?;
    let generation = copy::generation(&source)?;
    let scratch = Scratch(sidecar(database, ".reclaim"));
    let (mut copy, mut cursor) = copy::open(&source, &scratch, generation, last_request)?;
    while !cursor.done() {
        if should_yield() {
            return Ok(ReclaimAttempt::Yielded);
        }
        if data_version(&source)? != version {
            drop(copy);
            scratch.clean()?;
            return Err(HistoryError::Busy);
        }
        cursor = copy::step(&source, &mut copy, cursor, last_request)?;
    }
    if should_yield() {
        return Ok(ReclaimAttempt::Yielded);
    }

    let (first_request_id, request_count): (Option<i64>, u32) = source.query_row(
        "SELECT min(id), count(*) FROM reclaim_request WHERE id <= ?1",
        [last_request],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;
    let Some(first_request_id) = first_request_id else {
        return Err(HistoryError::Busy);
    };
    let request_count = request_count as usize;
    let tx = copy.transaction()?;
    let has_receipt =
        reclaim_batch::mark_published(&tx, first_request_id, last_request, request_count)?;
    tx.commit()?;
    // Closing SQLite releases any file space it preallocated while growing the scratch DB.
    copy.close().map_err(|(_, error)| error)?;
    if should_yield() {
        return Ok(ReclaimAttempt::Yielded);
    }
    // The source version is checked again under the publication lock. Measure the copy after
    // compaction and persist its receipt before publishing either one.
    let original_allocation = allocated_bytes(database);
    let measure = || {
        original_allocation
            .zip(allocated_bytes(&scratch.0))
            .map(|(before, after)| before.saturating_sub(after))
    };
    let mut released_bytes = measure();
    if has_receipt {
        // Patch the reserved bytes without changing SQLite's layout. Physical allocation may
        // still change on a compressed or copy-on-write file system.
        reclaim_batch::write_measurement(&scratch.0, released_bytes)?;
        let observed = measure();
        if observed != released_bytes {
            reclaim_batch::write_measurement(&scratch.0, observed)?;
            released_bytes = observed;
            if measure() != released_bytes {
                released_bytes = None;
                reclaim_batch::write_measurement(&scratch.0, None)?;
            }
        }
    }
    OpenOptions::new()
        .write(true)
        .open(&scratch.0)?
        .sync_all()?;
    if should_yield() {
        return Ok(ReclaimAttempt::Yielded);
    }
    // Only the final version check and atomic rename run while ordinary opens are excluded.
    let publication = exclusive_guard(database, ".publish-lock")?;
    if should_yield() {
        return Ok(ReclaimAttempt::Yielded);
    }
    if data_version(&source)? != version || copy::generation(&source)? != generation {
        scratch.clean()?;
        return Err(HistoryError::Busy);
    }
    source.close().map_err(|(_, error)| error)?;
    for suffix in SQLITE_SIDECARS {
        if sidecar(database, suffix).try_exists()? {
            return Err(HistoryError::Busy);
        }
    }
    if should_yield() {
        return Ok(ReclaimAttempt::Yielded);
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
    Ok(ReclaimAttempt::Published {
        first_request_id,
        through_request_id: last_request,
        released_bytes,
        request_count,
    })
}
