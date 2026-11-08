//! Per-track lyrics data the user owns: the timing offset now, user lyrics later.

use std::collections::HashMap;

use rusqlite::{Connection, OptionalExtension, params};

use crate::StoreError;

/// Larger shifts are slips, not sync fixes.
pub const OFFSET_LIMIT_MS: i64 = 30_000;

fn clamp_offset(offset_ms: i64) -> i64 {
    offset_ms.clamp(-OFFSET_LIMIT_MS, OFFSET_LIMIT_MS)
}

/// The track's offset, 0 when none is stored.
pub fn offset(conn: &Connection, track_id: &str) -> Result<i64, StoreError> {
    let stored: Option<i64> = conn
        .query_row("SELECT offset_ms FROM lyrics_user WHERE track_id = ?1", [track_id], |row| row.get(0))
        .optional()?;
    Ok(stored.unwrap_or(0))
}

/// Stores the clamped offset and returns it. Writing 0 drops a row that holds nothing else.
pub fn set_offset(conn: &Connection, track_id: &str, offset_ms: i64, now: i64) -> Result<i64, StoreError> {
    let offset_ms = clamp_offset(offset_ms);
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "INSERT INTO lyrics_user (track_id, offset_ms, updated_at) VALUES (?1, ?2, ?3)
         ON CONFLICT(track_id) DO UPDATE SET offset_ms = excluded.offset_ms, updated_at = excluded.updated_at",
        params![track_id, offset_ms, now],
    )?;
    tx.execute("DELETE FROM lyrics_user WHERE track_id = ?1 AND offset_ms = 0 AND content IS NULL", [track_id])?;
    tx.commit()?;
    Ok(offset_ms)
}

/// One-time import of the renderer's legacy map. Zeros are skipped and an offset already
/// stored here is never overwritten. Returns how many tracks received an offset.
pub fn import_offsets(conn: &Connection, offsets: &HashMap<String, i64>, now: i64) -> Result<usize, StoreError> {
    let tx = conn.unchecked_transaction()?;
    let mut imported = 0;
    for (track_id, offset_ms) in offsets {
        let offset_ms = clamp_offset(*offset_ms);
        if offset_ms == 0 {
            continue;
        }
        imported += tx.execute(
            "INSERT INTO lyrics_user (track_id, offset_ms, updated_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(track_id) DO UPDATE SET offset_ms = excluded.offset_ms, updated_at = excluded.updated_at
             WHERE lyrics_user.offset_ms = 0",
            params![track_id, offset_ms, now],
        )?;
    }
    tx.commit()?;
    Ok(imported)
}

/// The daemon's cap for user lyrics.
pub const MAX_USER_LYRICS_BYTES: usize = 64 * 1024;

/// The user's own lyrics as (format, content); None when only an offset is stored.
pub fn user_lyrics(conn: &Connection, track_id: &str) -> Result<Option<(String, String)>, StoreError> {
    let row: Option<(Option<String>, Option<String>)> = conn
        .query_row("SELECT format, content FROM lyrics_user WHERE track_id = ?1", [track_id], |row| Ok((row.get(0)?, row.get(1)?)))
        .optional()?;
    Ok(match row {
        Some((Some(format), Some(content))) => Some((format, content)),
        _ => None,
    })
}

pub fn set_lyrics(conn: &Connection, track_id: &str, format: &str, content: &str, now: i64) -> Result<(), StoreError> {
    conn.execute(
        "INSERT INTO lyrics_user (track_id, format, content, updated_at) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(track_id) DO UPDATE SET format = excluded.format, content = excluded.content, updated_at = excluded.updated_at",
        params![track_id, format, content, now],
    )?;
    Ok(())
}

/// Back to the providers. The offset stays; a row left holding nothing is dropped.
pub fn clear_lyrics(conn: &Connection, track_id: &str, now: i64) -> Result<(), StoreError> {
    let tx = conn.unchecked_transaction()?;
    tx.execute("UPDATE lyrics_user SET format = NULL, content = NULL, updated_at = ?2 WHERE track_id = ?1", params![track_id, now])?;
    tx.execute("DELETE FROM lyrics_user WHERE track_id = ?1 AND offset_ms = 0 AND content IS NULL", [track_id])?;
    tx.commit()?;
    Ok(())
}
