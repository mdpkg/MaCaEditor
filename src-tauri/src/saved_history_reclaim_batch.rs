use std::path::Path;

use rusqlite::{params, Connection, OptionalExtension, Transaction};

use super::{connect, Result};

const UNMEASURED: u64 = u64::MAX;

pub(crate) struct ReclaimBatch {
    pub request_id: i64,
    pub estimated_bytes: Option<i64>,
    pub receipt: Option<ReclaimReceipt>,
}

pub(crate) struct ReclaimReceipt {
    pub released_bytes: Option<u64>,
    pub request_count: usize,
}

fn has_batch(db: &Connection) -> rusqlite::Result<bool> {
    db.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'reclaim_batch')",
        [],
        |row| row.get(0),
    )
}

pub(super) fn record_batch(
    tx: &Transaction<'_>,
    request_id: i64,
    estimated_bytes: Option<i64>,
) -> Result<()> {
    tx.execute_batch(
        "CREATE TABLE IF NOT EXISTS reclaim_batch (
            singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
            request_id INTEGER NOT NULL,
            estimated_bytes INTEGER,
            request_count INTEGER,
            released_bytes BLOB NOT NULL CHECK(length(released_bytes) = 8)
         );",
    )?;
    tx.execute(
        "INSERT OR REPLACE INTO reclaim_batch VALUES (1, ?1, ?2, NULL, zeroblob(8))",
        params![request_id, estimated_bytes],
    )?;
    Ok(())
}

pub(crate) fn load_reclaim_batch(database: &Path) -> Result<Option<ReclaimBatch>> {
    if !database.try_exists()? {
        return Ok(None);
    }
    let db = connect(database)?;
    if !has_batch(&db)? {
        return Ok(None);
    }
    Ok(db.query_row(
        "SELECT request_id, estimated_bytes, request_count, released_bytes FROM reclaim_batch WHERE singleton = 1",
        [],
        |row| {
            let request_count: Option<i64> = row.get(2)?;
            let released = u64::from_le_bytes(row.get(3)?);
            Ok(ReclaimBatch {
                request_id: row.get(0)?,
                estimated_bytes: row.get(1)?,
                receipt: request_count.map(|count| ReclaimReceipt {
                    released_bytes: (released != UNMEASURED).then_some(released),
                    request_count: count as usize,
                }),
            })
        },
    ).optional()?)
}

pub(super) fn mark_published(
    tx: &Transaction<'_>,
    first_request: i64,
    last_request: i64,
    request_count: usize,
) -> Result<bool> {
    if !has_batch(tx)? {
        return Ok(false);
    }
    Ok(tx.execute(
        "UPDATE reclaim_batch SET request_count = ?1
         WHERE request_id BETWEEN ?2 AND ?3 AND request_count IS NULL",
        params![request_count as i64, first_request, last_request],
    )? != 0)
}

pub(super) fn write_measurement(db: &mut Connection, released: Option<u64>) -> Result<()> {
    let tx = db.transaction()?;
    let mut blob = tx.blob_open("main", "reclaim_batch", "released_bytes", 1, false)?;
    blob.write_at(&released.unwrap_or(UNMEASURED).to_le_bytes(), 0)?;
    blob.close()?;
    tx.commit()?;
    Ok(())
}
