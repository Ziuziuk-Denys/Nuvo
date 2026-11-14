use rusqlite::{Connection, OptionalExtension, params};

use crate::StoreError;

pub const SYNCED: &str = "synced";
pub const ALIGNED: &str = "aligned";
pub const TRANSCRIBED: &str = "transcribed";

/// Timed lyrics worked out on this computer, one per track and source, for the lyrics whose hash it names.
#[derive(Debug, Clone, PartialEq)]
pub struct Timing {
    pub source_hash: String,
    pub model: String,
    /// Absent on word timing made before it was measured.
    pub confidence: Option<f64>,
    pub content: String,
}

pub fn get(conn: &Connection, track_id: &str, source: &str) -> Result<Option<Timing>, StoreError> {
    Ok(conn
        .query_row("SELECT source_hash, model, confidence, content FROM lyrics_words WHERE track_id = ?1 AND source = ?2", [track_id, source], |row| {
            Ok(Timing { source_hash: row.get(0)?, model: row.get(1)?, confidence: row.get(2)?, content: row.get(3)? })
        })
        .optional()?)
}

pub fn put(conn: &Connection, track_id: &str, source: &str, timing: &Timing, now: i64) -> Result<(), StoreError> {
    conn.execute(
        "INSERT INTO lyrics_words (track_id, source, source_hash, model, confidence, content, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(track_id, source) DO UPDATE SET source_hash = excluded.source_hash, model = excluded.model,
           confidence = excluded.confidence, content = excluded.content, created_at = excluded.created_at",
        params![track_id, source, timing.source_hash, timing.model, timing.confidence, timing.content, now],
    )?;
    Ok(())
}

pub fn forget_made(conn: &Connection, track_id: &str) -> Result<(), StoreError> {
    conn.execute("DELETE FROM lyrics_words WHERE track_id = ?1 AND source IN ('aligned', 'transcribed')", [track_id])?;
    Ok(())
}
