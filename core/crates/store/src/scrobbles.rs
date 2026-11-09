use rusqlite::{Connection, OptionalExtension, Row, params};

use crate::{StoreError, settings};

pub const MIN_TRACK_MS: i64 = 30_000;
pub const ENOUGH_PLAYED_MS: i64 = 240_000;
const FIRST_RETRY_MS: i64 = 60_000;
const MAX_RETRY_MS: i64 = 3_600_000;

// Last.fm rule: longer than 30 s and played for half its length or 4 minutes, whichever is less
pub fn counts(duration_ms: i64, played_ms: i64) -> bool {
    duration_ms > MIN_TRACK_MS && played_ms * 2 >= duration_ms.min(ENOUGH_PLAYED_MS * 2)
}

#[derive(Debug, Clone, PartialEq)]
pub struct QueuedScrobble {
    pub id: i64,
    pub artist: String,
    pub track: String,
    pub album: Option<String>,
    pub duration_s: Option<i64>,
    /// Unix seconds.
    pub played_at: i64,
    pub attempts: i64,
}

fn queued_from_row(row: &Row) -> rusqlite::Result<QueuedScrobble> {
    Ok(QueuedScrobble {
        id: row.get("id")?,
        artist: row.get("artist")?,
        track: row.get("track")?,
        album: row.get("album")?,
        duration_s: row.get("duration_s")?,
        played_at: row.get("played_at")?,
        attempts: row.get("attempts")?,
    })
}

#[derive(Debug, Clone, PartialEq)]
pub struct TrackMeta {
    pub artist: String,
    pub title: String,
    pub album: Option<String>,
    pub duration_ms: i64,
}

pub fn track_meta(conn: &Connection, track_id: &str) -> Result<Option<TrackMeta>, StoreError> {
    Ok(conn
        .query_row("SELECT artist, title, album, duration_ms FROM tracks WHERE id = ?1", [track_id], |row| {
            Ok(TrackMeta { artist: row.get(0)?, title: row.get(1)?, album: row.get(2)?, duration_ms: row.get(3)? })
        })
        .optional()?)
}

pub fn active(conn: &Connection) -> Result<bool, StoreError> {
    let connected = settings::get(conn, settings::LASTFM_SESSION_KEY)?.is_some_and(|v| v.is_string());
    let enabled = settings::get(conn, settings::LASTFM_ENABLED)?.and_then(|v| v.as_bool()).unwrap_or(true);
    Ok(connected && enabled)
}

pub fn enqueue_play(
    conn: &Connection,
    track_id: &str,
    started_at_ms: i64,
    played_ms: i64,
    reported_duration_ms: Option<i64>,
) -> Result<bool, StoreError> {
    if !active(conn)? {
        return Ok(false);
    }
    let Some(meta) = track_meta(conn, track_id)? else {
        return Ok(false);
    };
    let full_ms = reported_duration_ms.filter(|ms| *ms > 0).unwrap_or(meta.duration_ms);
    let trimmed_ms: Option<i64> = conn
        .query_row("SELECT end_ms - start_ms FROM track_trims WHERE track_id = ?1", [track_id], |row| row.get(0))
        .optional()?;
    if meta.artist.trim().is_empty() || meta.title.trim().is_empty() || !counts(trimmed_ms.unwrap_or(full_ms), played_ms) {
        return Ok(false);
    }
    conn.execute(
        "INSERT INTO scrobble_queue (artist, track, album, duration_s, played_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![meta.artist, meta.title, meta.album, (full_ms > 0).then_some(full_ms / 1000), started_at_ms.div_euclid(1000)],
    )?;
    Ok(true)
}

pub fn due(conn: &Connection, now: i64, limit: usize) -> Result<Vec<QueuedScrobble>, StoreError> {
    let mut stmt = conn.prepare("SELECT * FROM scrobble_queue WHERE next_attempt_at <= ?1 ORDER BY played_at, id LIMIT ?2")?;
    Ok(stmt.query_map(params![now, limit as i64], queued_from_row)?.collect::<Result<_, _>>()?)
}

pub fn remove(conn: &Connection, ids: &[i64]) -> Result<(), StoreError> {
    let tx = conn.unchecked_transaction()?;
    for id in ids {
        tx.execute("DELETE FROM scrobble_queue WHERE id = ?1", [id])?;
    }
    tx.commit()?;
    Ok(())
}

pub fn defer(conn: &Connection, ids: &[i64], now: i64) -> Result<(), StoreError> {
    let tx = conn.unchecked_transaction()?;
    for id in ids {
        tx.execute(
            "UPDATE scrobble_queue SET next_attempt_at = ?2 + min(?3 * (1 << min(attempts, 10)), ?4), attempts = attempts + 1 WHERE id = ?1",
            params![id, now, FIRST_RETRY_MS, MAX_RETRY_MS],
        )?;
    }
    tx.commit()?;
    Ok(())
}

pub fn drop_old(conn: &Connection, now: i64) -> Result<(), StoreError> {
    let fourteen_days = 14 * 24 * 3600;
    let cutoff = now.div_euclid(1000) - fourteen_days;
    conn.execute("DELETE FROM scrobble_queue WHERE played_at < ?1", [cutoff])?;
    Ok(())
}

pub fn clear_all(conn: &Connection) -> Result<(), StoreError> {
    conn.execute("DELETE FROM scrobble_queue", [])?;
    Ok(())
}

pub fn count(conn: &Connection) -> Result<i64, StoreError> {
    Ok(conn.query_row("SELECT count(*) FROM scrobble_queue", [], |row| row.get(0))?)
}
