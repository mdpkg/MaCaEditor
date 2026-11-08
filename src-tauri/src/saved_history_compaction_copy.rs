use std::io;
use std::time::Duration;

use rusqlite::{
    params, params_from_iter, types::Value, Connection, OpenFlags, OptionalExtension, Row,
    Transaction,
};

use super::{connect_sqlite, HistoryError, Result, Scratch};

const BLOB_CHUNK: usize = 4 * 1024 * 1024;
const ROW_BATCH: usize = 256;

struct Table {
    name: &'static str,
    columns: &'static str,
    keys: usize,
    blob: Option<&'static str>,
    filter: &'static str,
}

const TABLES: &[Table] = &[
    Table {
        name: "checkpoint",
        columns: "id, document, revision, committed, recoverable, saved_at",
        keys: 1,
        blob: Some("CAST(zeroblob(?) AS TEXT)"),
        filter: "",
    },
    Table {
        name: "payload",
        columns: "digest",
        keys: 1,
        blob: Some("zeroblob(?)"),
        filter: "AND NOT EXISTS (SELECT 1 FROM payload_reclaim r
                    WHERE r.digest = payload.digest AND r.next_offset = octet_length(payload.data))",
    },
    Table { name: "checkpoint_payload", columns: "checkpoint, position, digest", keys: 2, blob: None, filter: "" },
    Table {
        name: "payload_reclaim",
        columns: "digest, next_offset",
        keys: 1,
        blob: None,
        filter: "AND next_offset < (SELECT octet_length(data) FROM payload p WHERE p.digest = payload_reclaim.digest)",
    },
    Table { name: "reclaim_request", columns: "id", keys: 1, blob: None, filter: "" },
    Table { name: "reclaim_batch", columns: "singleton, request_id, estimated_bytes, request_count, released_bytes", keys: 1, blob: None, filter: "" },
    Table { name: "sqlite_sequence", columns: "name, seq", keys: 1, blob: None, filter: "" },
];

impl Table {
    fn key_condition(&self) -> String {
        self.columns
            .split(',')
            .take(self.keys)
            .map(|key| format!("{} = ?", key.trim()))
            .collect::<Vec<_>>()
            .join(" AND ")
    }

    fn projection(&self, last_request: i64) -> String {
        if self.name == "reclaim_request" {
            return format!("AND id > {last_request}");
        }
        self.filter.into()
    }

    fn fields(&self) -> usize {
        self.columns.split(',').count() + usize::from(self.blob.is_some())
    }

    fn select(&self) -> String {
        let size = if self.blob.is_some() {
            ", octet_length(data)"
        } else {
            ""
        };
        format!("SELECT rowid, {}{size} FROM {}", self.columns, self.name)
    }
}

#[derive(Clone, Copy, Default)]
pub(super) struct Cursor {
    stage: usize,
    row: i64,
    offset: Option<u32>,
}

impl Cursor {
    pub(super) fn done(self) -> bool {
        self.stage == TABLES.len() * 2
    }

    fn advance(self) -> Self {
        Self {
            stage: self.stage + 1,
            ..Self::default()
        }
    }
}

#[derive(Clone, Copy)]
pub(super) struct Revision {
    pub(super) generation: [u8; 16],
    lineage: [u8; 16],
}

pub(super) fn revision(db: &Connection) -> rusqlite::Result<Revision> {
    db.query_row(
        "SELECT token, lineage FROM history_generation WHERE singleton = 1",
        [],
        |row| {
            Ok(Revision {
                generation: row.get(0)?,
                lineage: row.get(1)?,
            })
        },
    )
}

fn table_exists(db: &Connection, name: &str) -> rusqlite::Result<bool> {
    db.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = ?1)",
        [name],
        |row| row.get(0),
    )
}

fn ensure_optional_tables(source: &Connection, target: &Connection) -> Result<()> {
    for table in ["reclaim_request", "reclaim_batch"] {
        if table_exists(target, table)? {
            continue;
        }
        let schema: Option<String> = source
            .query_row(
                "SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = ?1",
                [table],
                |row| row.get(0),
            )
            .optional()?;
        if let Some(schema) = schema {
            target.execute_batch(&schema)?;
        }
    }
    Ok(())
}

fn configure_scratch(db: &Connection) -> rusqlite::Result<()> {
    db.busy_timeout(Duration::ZERO)?;
    // A rescan can see references before their new target rows or delete their old targets first.
    // The whole projection is checked before the scratch database can replace the live database.
    db.execute_batch(
        "PRAGMA foreign_keys = OFF; PRAGMA synchronous = FULL; PRAGMA secure_delete = ON;",
    )
}

pub(super) fn open(
    source: &Connection,
    scratch: &Scratch,
    revision: Revision,
    last_request: i64,
) -> Result<(Connection, Cursor)> {
    {
        let mut query = source.prepare("SELECT name FROM sqlite_schema WHERE type = 'table'")?;
        let tables = query.query_map([], |row| row.get::<_, String>(0))?;
        for name in tables {
            let name = name?;
            if !matches!(
                name.as_str(),
                "history_generation" | "reclaim_copy" | "reclaim_partial"
            ) && !TABLES.iter().any(|table| table.name == name)
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
            configure_scratch(&db)?;
            let state = db
                .query_row(
                    "SELECT source_generation, last_request, stage, row_cursor, blob_offset
                 FROM reclaim_copy WHERE source_lineage = ?1",
                    [revision.lineage],
                    |row| {
                        let stage: u32 = row.get(2)?;
                        Ok((
                            row.get::<_, [u8; 16]>(0)?,
                            row.get::<_, i64>(1)?,
                            Cursor {
                                stage: stage as usize,
                                row: row.get(3)?,
                                offset: row.get(4)?,
                            },
                        ))
                    },
                )
                .optional()?;
            Ok::<_, HistoryError>((db, state))
        })();
        match previous {
            Ok((db, Some((generation, previous_request, cursor))))
                if cursor.stage <= TABLES.len() * 2
                    && (cursor.offset.is_none()
                        || TABLES
                            .get(cursor.stage)
                            .is_some_and(|table| table.blob.is_some())) =>
            {
                ensure_optional_tables(source, &db)?;
                if generation == revision.generation && previous_request == last_request {
                    return Ok((db, cursor));
                }
                // Rescan row headers while keeping copied rows and each partial blob's durable offset.
                db.execute(
                    "UPDATE reclaim_copy SET source_generation = ?1, last_request = ?2,
                     stage = 0, row_cursor = 0, blob_offset = NULL",
                    params![revision.generation, last_request],
                )?;
                return Ok((db, Cursor::default()));
            }
            Err(error) if error.is_busy() => return Err(error),
            _ => {} // An unrelated, outdated or unreadable scratch file can be rebuilt from the live DB.
        }
    }
    scratch.clean()?;
    let mut db = connect_sqlite(&scratch.0, Duration::ZERO)?;
    configure_scratch(&db)?;
    let tx = db.transaction()?;
    ensure_optional_tables(source, &tx)?;
    tx.execute_batch(
        "CREATE TABLE reclaim_copy (
            source_lineage BLOB NOT NULL,
            source_generation BLOB NOT NULL,
            last_request INTEGER NOT NULL,
            stage INTEGER NOT NULL,
            row_cursor INTEGER NOT NULL,
            blob_offset INTEGER
         );
         CREATE TABLE reclaim_partial (
            stage INTEGER NOT NULL,
            target_row INTEGER NOT NULL,
            offset INTEGER NOT NULL,
            PRIMARY KEY(stage, target_row)
         );",
    )?;
    tx.execute(
        "INSERT INTO reclaim_copy VALUES (?1, ?2, ?3, 0, 0, NULL)",
        params![revision.lineage, revision.generation, last_request],
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

fn source_snapshot(source: &Connection, generation: [u8; 16]) -> Result<Transaction<'_>> {
    let tx = source.unchecked_transaction()?;
    if revision(&tx)?.generation != generation {
        return Err(HistoryError::Busy);
    }
    Ok(tx)
}

pub(super) fn step(
    source: &Connection,
    target: &mut Connection,
    cursor: Cursor,
    last_request: i64,
    generation: [u8; 16],
) -> Result<Cursor> {
    let table = &TABLES[cursor.stage % TABLES.len()];
    let tx = target.transaction()?;
    let next = if !table_exists(&tx, table.name)? {
        cursor.advance()
    } else if cursor.stage >= TABLES.len() {
        prune_rows(source, &tx, table, cursor, last_request, generation)?
    } else if let Some(offset) = cursor.offset {
        copy_blob_chunk(source, &tx, table, cursor, offset, generation)?
    } else {
        copy_rows(source, &tx, table, cursor, last_request, generation)?
    };
    tx.execute(
        "UPDATE reclaim_copy SET stage = ?1, row_cursor = ?2, blob_offset = ?3",
        params![next.stage as i64, next.row, next.offset],
    )?;
    tx.commit()?;
    Ok(next)
}

fn copy_blob_chunk(
    source: &Connection,
    target: &Connection,
    table: &Table,
    cursor: Cursor,
    offset: u32,
    generation: [u8; 16],
) -> Result<Cursor> {
    let read = source_snapshot(source, generation)?;
    let key: Value = read.query_row(
        &format!(
            "SELECT {} FROM {} WHERE rowid = ?1",
            table.columns.split(',').next().unwrap(),
            table.name
        ),
        [cursor.row],
        |row| row.get(0),
    )?;
    let blob = read.blob_open("main", table.name, "data", cursor.row, true)?;
    let offset = offset as usize;
    let count = blob
        .len()
        .checked_sub(offset)
        .filter(|remaining| *remaining > 0)
        .ok_or_else(|| io::Error::other("invalid offset in history compaction scratch database"))?
        .min(BLOB_CHUNK);
    let mut bytes = vec![0; count];
    blob.read_at_exact(&mut bytes, offset)?;
    let end = offset + count;
    let next = (end < blob.len()).then_some(end as u32);
    blob.close()?;
    read.commit()?;

    let row: i64 = target.query_row(
        &format!(
            "SELECT rowid FROM {} WHERE {}",
            table.name,
            table.key_condition()
        ),
        [&key],
        |row| row.get(0),
    )?;
    let mut blob = target.blob_open("main", table.name, "data", row, false)?;
    blob.write_at(&bytes, offset)?;
    blob.close()?;
    if let Some(next) = next {
        target.execute(
            "UPDATE reclaim_partial SET offset = ?3 WHERE stage = ?1 AND target_row = ?2",
            params![cursor.stage as i64, row, next],
        )?;
    } else {
        target.execute(
            "DELETE FROM reclaim_partial WHERE stage = ?1 AND target_row = ?2",
            params![cursor.stage as i64, row],
        )?;
    }
    Ok(Cursor {
        offset: next,
        ..cursor
    })
}

fn copy_rows(
    source: &Connection,
    target: &Connection,
    table: &Table,
    cursor: Cursor,
    last_request: i64,
    generation: [u8; 16],
) -> Result<Cursor> {
    let read = source_snapshot(source, generation)?;
    let rows = {
        let mut query = read.prepare(&format!(
            "{} WHERE rowid > ?1 {} ORDER BY rowid LIMIT {ROW_BATCH}",
            table.select(),
            table.projection(last_request),
        ))?;
        let rows = query.query_map([cursor.row], |row| fields(row, table.fields()))?;
        rows.collect::<rusqlite::Result<Vec<_>>>()?
    };
    read.commit()?;
    let Some((last, _)) = rows.last() else {
        return Ok(cursor.advance());
    };
    for (row, values) in &rows {
        if let Some(offset) = merge_row(target, table, cursor.stage, values)? {
            return Ok(Cursor {
                row: *row,
                offset: Some(offset),
                ..cursor
            });
        }
    }
    Ok(Cursor {
        row: *last,
        ..cursor
    })
}

fn merge_row(
    target: &Connection,
    table: &Table,
    stage: usize,
    values: &[Value],
) -> Result<Option<u32>> {
    let existing = target
        .prepare_cached(&format!(
            "{} WHERE {}",
            table.select(),
            table.key_condition()
        ))?
        .query_row(params_from_iter(&values[..table.keys]), |row| {
            fields(row, table.fields())
        })
        .optional()?;
    let columns = table.columns.split(',').count();
    if let Some((row, old)) = existing {
        let same_blob = table.blob.is_none() || old[columns] == values[columns];
        if same_blob {
            if old[..columns] != values[..columns] {
                let assignments = table
                    .columns
                    .split(',')
                    .skip(table.keys)
                    .map(|col| format!("{} = ?", col.trim()))
                    .collect::<Vec<_>>()
                    .join(", ");
                target.execute(
                    &format!("UPDATE {} SET {assignments} WHERE rowid = ?", table.name),
                    params_from_iter(
                        values[table.keys..columns]
                            .iter()
                            .chain([&Value::Integer(row)]),
                    ),
                )?;
            }
            return partial_offset(target, table, stage, row);
        }
        remove_row(target, table, stage, row)?;
    }
    let (blob_columns, blob_value) = table.blob.map_or(("", String::new()), |value| {
        (", data", format!(", {value}"))
    });
    let parameters = vec!["?"; columns].join(", ");
    target.execute(
        &format!(
            "INSERT INTO {} ({}{blob_columns}) VALUES ({parameters}{blob_value})",
            table.name, table.columns
        ),
        params_from_iter(values),
    )?;
    if table.blob.is_some() && values[columns] != Value::Integer(0) {
        target.execute(
            "INSERT INTO reclaim_partial VALUES (?1, ?2, 0)",
            params![stage as i64, target.last_insert_rowid()],
        )?;
        return Ok(Some(0));
    }
    Ok(None)
}

fn partial_offset(
    target: &Connection,
    table: &Table,
    stage: usize,
    row: i64,
) -> Result<Option<u32>> {
    if table.blob.is_none() {
        return Ok(None);
    }
    Ok(target
        .query_row(
            "SELECT offset FROM reclaim_partial WHERE stage = ?1 AND target_row = ?2",
            params![stage as i64, row],
            |row| row.get(0),
        )
        .optional()?)
}

fn remove_row(target: &Connection, table: &Table, stage: usize, row: i64) -> Result<()> {
    target.execute(
        &format!("DELETE FROM {} WHERE rowid = ?1", table.name),
        [row],
    )?;
    if table.blob.is_some() {
        target.execute(
            "DELETE FROM reclaim_partial WHERE stage = ?1 AND target_row = ?2",
            params![stage as i64, row],
        )?;
    }
    Ok(())
}

fn prune_rows(
    source: &Connection,
    target: &Connection,
    table: &Table,
    cursor: Cursor,
    last_request: i64,
    generation: [u8; 16],
) -> Result<Cursor> {
    let rows = {
        let mut query = target.prepare(&format!(
            "{} WHERE rowid > ?1 ORDER BY rowid LIMIT {ROW_BATCH}",
            table.select(),
        ))?;
        let rows = query.query_map([cursor.row], |row| fields(row, table.fields()))?;
        rows.collect::<rusqlite::Result<Vec<_>>>()?
    };
    let Some((last, _)) = rows.last() else {
        return Ok(cursor.advance());
    };
    let read = source_snapshot(source, generation)?;
    let absent = {
        let mut exists = read.prepare(&format!(
            "SELECT EXISTS(SELECT 1 FROM {} WHERE {} {})",
            table.name,
            table.key_condition(),
            table.projection(last_request),
        ))?;
        let mut absent = Vec::new();
        for (row, values) in &rows {
            if !exists.query_row(params_from_iter(&values[..table.keys]), |row| {
                row.get::<_, bool>(0)
            })? {
                absent.push(*row);
            }
        }
        absent
    };
    read.commit()?;
    for row in absent {
        remove_row(target, table, cursor.stage % TABLES.len(), row)?;
    }
    Ok(Cursor {
        row: *last,
        ..cursor
    })
}
