use rusqlite::{Connection, OptionalExtension, params};

use crate::StoreError;

/// Word timing worked out on this computer, one per track, for the lyrics whose hash it names.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Timing {
    pub source_hash: String,
    pub model: String,
    pub content: String,
}

pub fn get(conn: &Connection, track_id: &str) -> Result<Option<Timing>, StoreError> {
    Ok(conn
        .query_row("SELECT source_hash, model, content FROM lyrics_words WHERE track_id = ?1", [track_id], |row| {
            Ok(Timing { source_hash: row.get(0)?, model: row.get(1)?, content: row.get(2)? })
        })
        .optional()?)
}

pub fn put(conn: &Connection, track_id: &str, timing: &Timing, now: i64) -> Result<(), StoreError> {
    conn.execute(
        "INSERT INTO lyrics_words (track_id, source_hash, model, content, created_at) VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(track_id) DO UPDATE SET source_hash = excluded.source_hash, model = excluded.model,
           content = excluded.content, created_at = excluded.created_at",
        params![track_id, timing.source_hash, timing.model, timing.content, now],
    )?;
    Ok(())
}
