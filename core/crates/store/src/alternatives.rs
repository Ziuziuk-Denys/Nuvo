use rusqlite::{Connection, OptionalExtension};

use crate::StoreError;

#[derive(Debug, Clone, PartialEq)]
pub struct Alternative {
    pub source: String,
    pub alt_id: String,
    pub score: i64,
    pub reason: String,
    pub duration_ms: Option<i64>,
}

pub fn get(conn: &Connection, track_id: &str) -> Result<Option<Alternative>, StoreError> {
    Ok(conn
        .query_row("SELECT source, alt_id, score, reason, duration_ms FROM track_alternatives WHERE track_id = ?1", [track_id], |r| {
            Ok(Alternative { source: r.get(0)?, alt_id: r.get(1)?, score: r.get(2)?, reason: r.get(3)?, duration_ms: r.get(4)? })
        })
        .optional()?)
}

pub fn put(conn: &Connection, track_id: &str, alt: &Alternative, now: i64) -> Result<(), StoreError> {
    conn.execute(
        "INSERT INTO track_alternatives (track_id, source, alt_id, score, reason, duration_ms, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(track_id) DO UPDATE SET source = excluded.source, alt_id = excluded.alt_id, score = excluded.score,
           reason = excluded.reason, duration_ms = excluded.duration_ms, created_at = excluded.created_at",
        (track_id, &alt.source, &alt.alt_id, alt.score, &alt.reason, alt.duration_ms, now),
    )?;
    Ok(())
}

pub fn reject(conn: &Connection, track_id: &str, alt_id: &str) -> Result<(), StoreError> {
    let tx = conn.unchecked_transaction()?;
    tx.execute("DELETE FROM track_alternatives WHERE track_id = ?1 AND alt_id = ?2", (track_id, alt_id))?;
    tx.execute("DELETE FROM match_standins WHERE track_id = ?1 AND video_id = ?2", (track_id, alt_id))?;
    tx.execute("DELETE FROM match_memo WHERE track_id = ?1", [alt_id])?;
    tx.commit()?;
    Ok(())
}
