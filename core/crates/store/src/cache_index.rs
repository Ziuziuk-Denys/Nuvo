use nuvo_contracts::{CacheStatus, CoverStats};
use rusqlite::{Connection, OptionalExtension, Row, params};
use serde_json::Value;

use crate::{StoreError, tracks};

const RECENT_MS: i64 = 30 * 86_400_000;

/// A cached track is kept regardless of the size limit when it is liked, sits in a playlist
/// pinned for offline use, or completed at least 3 times in the last 30 days (`?1` = window start).
const KEPT: &str = "(c.track_id IN (SELECT track_id FROM liked_tracks)
    OR c.track_id IN (SELECT i.track_id FROM playlist_items i JOIN playlists p ON p.id = i.playlist_id WHERE p.pinned_offline = 1)
    OR (SELECT count(*) FROM play_events e WHERE e.track_id = c.track_id AND e.end_reason = 'complete' AND e.started_at >= ?1) >= 3)";

#[derive(Debug, Clone, PartialEq)]
pub struct CacheEntry {
    pub track_id: String,
    pub path: String,
    pub size_bytes: i64,
    pub mime: String,
    pub codec: Option<String>,
}

fn entry_from_row(row: &Row) -> rusqlite::Result<CacheEntry> {
    Ok(CacheEntry {
        track_id: row.get("track_id")?,
        path: row.get("path")?,
        size_bytes: row.get("size_bytes")?,
        mime: row.get("mime")?,
        codec: row.get("codec")?,
    })
}

pub fn upsert(conn: &Connection, entry: &CacheEntry, now: i64) -> Result<(), StoreError> {
    conn.execute(
        "INSERT INTO cache_entries (track_id, path, size_bytes, mime, codec, last_played_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(track_id) DO UPDATE SET path = excluded.path, size_bytes = excluded.size_bytes,
           mime = excluded.mime, codec = excluded.codec, last_played_at = excluded.last_played_at",
        params![entry.track_id, entry.path, entry.size_bytes, entry.mime, entry.codec, now],
    )?;
    Ok(())
}

pub fn get(conn: &Connection, track_id: &str) -> Result<Option<CacheEntry>, StoreError> {
    Ok(conn
        .query_row("SELECT * FROM cache_entries WHERE track_id = ?1", [track_id], entry_from_row)
        .optional()?)
}

pub fn touch(conn: &Connection, track_id: &str, now: i64) -> Result<(), StoreError> {
    conn.execute("UPDATE cache_entries SET last_played_at = ?2 WHERE track_id = ?1", params![track_id, now])?;
    Ok(())
}

pub fn delete(conn: &Connection, track_id: &str) -> Result<(), StoreError> {
    conn.execute("DELETE FROM cache_entries WHERE track_id = ?1", [track_id])?;
    Ok(())
}

pub fn all(conn: &Connection) -> Result<Vec<CacheEntry>, StoreError> {
    let mut stmt = conn.prepare("SELECT * FROM cache_entries")?;
    Ok(stmt.query_map([], entry_from_row)?.collect::<Result<_, _>>()?)
}

pub fn total_bytes(conn: &Connection) -> Result<i64, StoreError> {
    Ok(conn.query_row("SELECT coalesce(sum(size_bytes), 0) FROM cache_entries", [], |row| row.get(0))?)
}

/// Entries outside the keep rules, cheapest to lose first: fewest recent plays, then oldest play.
pub fn eviction_candidates(conn: &Connection, now: i64) -> Result<Vec<CacheEntry>, StoreError> {
    let mut stmt = conn.prepare(&format!(
        "SELECT c.* FROM cache_entries c WHERE NOT {KEPT}
         ORDER BY (SELECT count(*) FROM play_events e WHERE e.track_id = c.track_id AND e.started_at >= ?1), c.last_played_at"
    ))?;
    Ok(stmt.query_map([now - RECENT_MS], entry_from_row)?.collect::<Result<_, _>>()?)
}

pub fn status(conn: &Connection, now: i64, limit_bytes: i64) -> Result<CacheStatus, StoreError> {
    let (used_bytes, entries): (i64, i64) = conn.query_row(
        "SELECT coalesce(sum(size_bytes), 0), count(*) FROM cache_entries",
        [],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;
    let pinned: i64 = conn.query_row(
        &format!("SELECT count(*) FROM cache_entries c WHERE {KEPT}"),
        [now - RECENT_MS],
        |row| row.get(0),
    )?;
    Ok(CacheStatus { used_bytes, limit_bytes, entries, pinned, covers: CoverStats::default() })
}

/// Liked or pinned tracks that are not cached yet, for background prefetch.
pub fn missing_keep_tracks(conn: &Connection, limit: usize) -> Result<Vec<Value>, StoreError> {
    let mut stmt = conn.prepare(
        "SELECT t.snapshot_json FROM tracks t
         LEFT JOIN liked_tracks l ON l.track_id = t.id
         WHERE t.id NOT IN (SELECT track_id FROM cache_entries) AND t.source != 'local'
           AND (l.track_id IS NOT NULL OR t.id IN (SELECT i.track_id FROM playlist_items i JOIN playlists p ON p.id = i.playlist_id WHERE p.pinned_offline = 1))
         ORDER BY l.liked_at DESC LIMIT ?1",
    )?;
    let raws = stmt
        .query_map([limit.clamp(1, 100) as i64], |row| row.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>()?;
    raws.iter().map(|raw| tracks::parse(raw)).collect()
}
