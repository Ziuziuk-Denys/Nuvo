use nuvo_contracts::{SetTrim, TrackTrim};
use rusqlite::{Connection, OptionalExtension, Row, params};

use crate::{StoreError, tracks};

/// Shorter spans are almost always a slip of the handle.
pub const MIN_TRIM_MS: i64 = 5000;

fn trim_from_row(row: &Row) -> rusqlite::Result<TrackTrim> {
    Ok(TrackTrim { track_id: row.get("track_id")?, start_ms: row.get("start_ms")?, end_ms: row.get("end_ms")? })
}

pub fn get(conn: &Connection, track_id: &str) -> Result<Option<TrackTrim>, StoreError> {
    Ok(conn
        .query_row("SELECT * FROM track_trims WHERE track_id = ?1", [track_id], trim_from_row)
        .optional()?)
}

pub fn list(conn: &Connection) -> Result<Vec<TrackTrim>, StoreError> {
    let mut stmt = conn.prepare("SELECT * FROM track_trims ORDER BY updated_at DESC, track_id")?;
    Ok(stmt.query_map([], trim_from_row)?.collect::<Result<_, _>>()?)
}

pub fn set(conn: &Connection, track_id: &str, input: &SetTrim, now: i64) -> Result<TrackTrim, StoreError> {
    let tx = conn.unchecked_transaction()?;
    tracks::ensure(&tx, track_id, input.track.as_ref(), now)?;
    let duration: i64 = tx.query_row("SELECT duration_ms FROM tracks WHERE id = ?1", [track_id], |row| row.get(0))?;
    let (start, end) = (input.start_ms, input.end_ms);
    if start < 0 || start >= end || end > duration || end - start < MIN_TRIM_MS {
        return Err(StoreError::Invalid(format!(
            "trim must satisfy 0 <= startMs < endMs <= {duration} and keep at least {} s",
            MIN_TRIM_MS / 1000
        )));
    }
    tx.execute(
        "INSERT INTO track_trims (track_id, start_ms, end_ms, updated_at) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(track_id) DO UPDATE SET start_ms = excluded.start_ms, end_ms = excluded.end_ms, updated_at = excluded.updated_at",
        params![track_id, start, end, now],
    )?;
    tx.commit()?;
    Ok(TrackTrim { track_id: track_id.to_string(), start_ms: start, end_ms: end })
}

pub fn delete(conn: &Connection, track_id: &str) -> Result<(), StoreError> {
    conn.execute("DELETE FROM track_trims WHERE track_id = ?1", [track_id])?;
    Ok(())
}
