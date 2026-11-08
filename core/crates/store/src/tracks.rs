use nuvo_contracts::TrackFields;
use rusqlite::{Connection, OptionalExtension, params};
use serde_json::Value;

use crate::StoreError;

const MAX_SNAPSHOT_BYTES: usize = 64 * 1024;

pub fn upsert(conn: &Connection, snapshot: &Value, now: i64) -> Result<TrackFields, StoreError> {
    let fields = TrackFields::from_snapshot(snapshot)?;
    let json = snapshot.to_string();
    if json.len() > MAX_SNAPSHOT_BYTES {
        return Err(StoreError::Invalid("track snapshot is too large".into()));
    }
    conn.execute(
        "INSERT INTO tracks (id, title, artist, artists_json, album, album_id, duration_ms, cover_url, source, snapshot_json, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
         ON CONFLICT(id) DO UPDATE SET
           title = excluded.title, artist = excluded.artist, artists_json = excluded.artists_json,
           album = excluded.album, album_id = excluded.album_id, duration_ms = excluded.duration_ms,
           cover_url = excluded.cover_url, snapshot_json = excluded.snapshot_json, updated_at = excluded.updated_at",
        params![
            fields.id, fields.title, fields.artist, fields.artists_json, fields.album, fields.album_id,
            fields.duration_ms, fields.cover_url, fields.source, json, now
        ],
    )?;
    Ok(fields)
}

pub fn snapshot(conn: &Connection, id: &str) -> Result<Option<Value>, StoreError> {
    let raw: Option<String> = conn
        .query_row("SELECT snapshot_json FROM tracks WHERE id = ?1", [id], |row| row.get(0))
        .optional()?;
    Ok(raw.map(|s| serde_json::from_str(&s)).transpose()?)
}

/// Stores `snapshot` when given (its id must equal `id`), otherwise requires the track to exist.
pub fn ensure(conn: &Connection, id: &str, snapshot: Option<&Value>, now: i64) -> Result<(), StoreError> {
    match snapshot {
        Some(snapshot) => {
            let fields = upsert(conn, snapshot, now)?;
            if fields.id != id {
                return Err(StoreError::Invalid("snapshot id does not match the track id".into()));
            }
            Ok(())
        }
        None if snapshot_exists(conn, id)? => Ok(()),
        None => Err(StoreError::NotFound("track")),
    }
}

pub(crate) fn snapshot_exists(conn: &Connection, id: &str) -> Result<bool, StoreError> {
    Ok(conn.query_row("SELECT EXISTS(SELECT 1 FROM tracks WHERE id = ?1)", [id], |row| row.get(0))?)
}

pub(crate) fn parse(raw: &str) -> Result<Value, StoreError> {
    Ok(serde_json::from_str(raw)?)
}
