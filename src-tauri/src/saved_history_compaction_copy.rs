use std::io;
use std::time::Duration;

use rusqlite::{
    params, params_from_iter, types::Value, Connection, OpenFlags, OptionalExtension, Row,
};

use super::{connect_sqlite, Result, Scratch};

const BLOB_CHUNK: usize = 4 * 1024 * 1024;
const ROW_BATCH: usize = 256;

struct Table {
    name: &'static str,
    columns: &'static str,
    blob: Option<&'static str>,
    filter: &'static str,
}

const TABLES: &[Table] = &[
    Table {
        name: "checkpoint",
        columns: "id, document, revision, committed, recoverable, saved_at",
        blob: Some("CAST(zeroblob(?) AS TEXT)"),
        filter: "",
    },
    Table {
        name: "payload",
        columns: "rowid, digest",
        blob: Some("zeroblob(?)"),
        filter: "AND NOT EXISTS (SELECT 1 FROM payload_reclaim r
                    WHERE r.digest = payload.digest AND r.next_offset = octet_length(payload.data))",
    },
    Table { name: "checkpoint_payload", columns: "checkpoint, position, digest", blob: None, filter: "" },
    Table {
        name: "payload_reclaim",
        columns: "digest, next_offset",
        blob: None,
        filter: "AND next_offset < (SELECT octet_length(data) FROM payload p WHERE p.digest = payload_reclaim.digest)",
    },
    Table { name: "reclaim_request", columns: "id", blob: None, filter: "" },
    Table { name: "reclaim_batch", columns: "singleton, request_id, estimated_bytes, request_count, released_bytes", blob: None, filter: "" },
    Table { name: "sqlite_sequence", columns: "name, seq", blob: None, filter: "" },
];

#[derive(Clone, Copy, Default)]
pub(super) struct Cursor {
    stage: usize,
    row: i64,
    offset: Option<u32>,
}

impl Cursor {
    pub(super) fn done(self) -> bool {
        self.stage == TABLES.len()
    }

    fn advance(self) -> Self {
        Self {
            stage: self.stage + 1,
            ..Self::default()
        }
    }
}

pub(super) fn generation(db: &Connection) -> rusqlite::Result<[u8; 16]> {
    db.query_row(
        "SELECT token FROM history_generation WHERE singleton = 1",
        [],
        |row| row.get(0),
    )
}

pub(super) fn open(
    source: &Connection,
    scratch: &Scratch,
    generation: [u8; 16],
    last_request: i64,
) -> Result<(Connection, Cursor)> {
    {
        let mut query = source.prepare("SELECT name FROM sqlite_schema WHERE type = 'table'")?;
        let tables = query.query_map([], |row| row.get::<_, String>(0))?;
        for name in tables {
            let name = name?;
            if !matches!(name.as_str(), "history_generation" | "reclaim_copy")
                && !TABLES.iter().any(|table| table.name == name)
            {
                return Err(
                    io::Error::other(format!("unsupported table in edit history: {name}")).into(),
                );
            }
        }
    }
    if scratch.0.try_exists()? {
        let previous = (|| {
            let db = Connection::open_with_flags(&scratch.0, OpenFlags::SQLITE_OPEN_READ_WRITE)?;
            db.busy_timeout(Duration::ZERO)?;
            db.execute_batch("PRAGMA foreign_keys = ON; PRAGMA synchronous = FULL;")?;
            let cursor = db
                .query_row(
                    "SELECT stage, row_cursor, blob_offset FROM reclaim_copy
                 WHERE source_generation = ?1 AND last_request = ?2",
                    params![generation, last_request],
                    |row| {
                        let stage: u32 = row.get(0)?;
                        Ok(Cursor {
                            stage: stage as usize,
                            row: row.get(1)?,
                            offset: row.get(2)?,
                        })
                    },
                )
                .optional()?;
            Ok::<_, super::HistoryError>((db, cursor))
        })();
        match previous {
            Ok((db, Some(cursor)))
                if cursor.stage <= TABLES.len()
                    && (cursor.offset.is_none()
                        || TABLES
                            .get(cursor.stage)
                            .is_some_and(|table| table.blob.is_some())) =>
            {
                return Ok((db, cursor));
            }
            Err(error) if error.is_busy() => return Err(error),
            _ => {} // A stale, incomplete or unreadable scratch file can be rebuilt from the live DB.
        }
    }
    scratch.clean()?;
    let mut db = connect_sqlite(&scratch.0, Duration::ZERO)?;
    let tx = db.transaction()?;
    for table in ["reclaim_request", "reclaim_batch"] {
        let schema: Option<String> = source
            .query_row(
                "SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = ?1",
                [table],
                |row| row.get(0),
            )
            .optional()?;
        if let Some(schema) = schema {
            tx.execute_batch(&schema)?;
        }
    }
    tx.execute_batch(
        "CREATE TABLE reclaim_copy (
            source_generation BLOB NOT NULL,
            last_request INTEGER NOT NULL,
            stage INTEGER NOT NULL,
            row_cursor INTEGER NOT NULL,
            blob_offset INTEGER
         );",
    )?;
    tx.execute(
        "INSERT INTO reclaim_copy VALUES (?1, ?2, 0, 0, NULL)",
        params![generation, last_request],
    )?;
    tx.commit()?;
    Ok((db, Cursor::default()))
}

fn fields(row: &Row<'_>, count: usize) -> rusqlite::Result<(i64, Vec<Value>)> {
    Ok((
        row.get(0)?,
        (1..=count)
            .map(|column| row.get(column))
            .collect::<rusqlite::Result<_>>()?,
    ))
}

pub(super) fn step(
    source: &Connection,
    target: &mut Connection,
    cursor: Cursor,
    last_request: i64,
) -> Result<Cursor> {
    let table = &TABLES[cursor.stage];
    let tx = target.transaction()?;
    let next = if let Some(offset) = cursor.offset {
        // Close the source blob before writing or syncing the destination.
        let blob = source.blob_open("main", table.name, "data", cursor.row, true)?;
        let offset = offset as usize;
        let remaining = blob
            .len()
            .checked_sub(offset)
            .filter(|remaining| *remaining > 0)
            .ok_or_else(|| {
                io::Error::other("invalid offset in history compaction scratch database")
            })?;
        let count = remaining.min(BLOB_CHUNK);
        let mut bytes = vec![0; count];
        blob.read_at_exact(&mut bytes, offset)?;
        let end = offset + count;
        let next_offset = (end < blob.len()).then_some(end as u32);
        blob.close()?;
        let mut blob = tx.blob_open("main", table.name, "data", cursor.row, false)?;
        blob.write_at(&bytes, offset)?;
        blob.close()?;
        Cursor {
            offset: next_offset,
            ..cursor
        }
    } else {
        copy_rows(source, &tx, table, cursor, last_request)?
    };
    tx.execute(
        "UPDATE reclaim_copy SET stage = ?1, row_cursor = ?2, blob_offset = ?3",
        params![next.stage as i64, next.row, next.offset],
    )?;
    tx.commit()?;
    Ok(next)
}

fn copy_rows(
    source: &Connection,
    target: &Connection,
    table: &Table,
    cursor: Cursor,
    last_request: i64,
) -> Result<Cursor> {
    if table.name == "reclaim_batch" {
        let exists: bool = target.query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE name = 'reclaim_batch')",
            [],
            |row| row.get(0),
        )?;
        if !exists {
            return Ok(cursor.advance());
        }
    }
    let count = table.columns.split(',').count();
    let (blob_columns, blob_value, blob_size, limit) = match table.blob {
        Some(value) => (", data", format!(", {value}"), ", octet_length(data)", 1),
        None => ("", String::new(), "", ROW_BATCH),
    };
    let after = if table.name == "reclaim_request" {
        cursor.row.max(last_request)
    } else {
        cursor.row
    };
    let rows = {
        let mut query = source.prepare(&format!(
            "SELECT rowid, {}{blob_size} FROM {} WHERE rowid > ?1 {} ORDER BY rowid LIMIT {limit}",
            table.columns, table.name, table.filter,
        ))?;
        let columns = count + usize::from(table.blob.is_some());
        let rows = query.query_map([after], |row| fields(row, columns))?;
        rows.collect::<rusqlite::Result<Vec<_>>>()?
    };
    let Some((last, values)) = rows.last() else {
        return Ok(cursor.advance());
    };
    let offset = (table.blob.is_some() && values[count] != Value::Integer(0)).then_some(0);
    let parameters = vec!["?"; count].join(", ");
    let mut insert = target.prepare(&format!(
        "INSERT INTO {} ({}{blob_columns}) VALUES ({parameters}{blob_value})",
        table.name, table.columns,
    ))?;
    for (_, values) in &rows {
        if table.name == "sqlite_sequence" {
            target.execute("DELETE FROM sqlite_sequence WHERE name = ?1", [&values[0]])?;
        }
        insert.execute(params_from_iter(values))?;
    }
    Ok(Cursor {
        row: *last,
        offset,
        ..cursor
    })
}
