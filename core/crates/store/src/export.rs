//! What an export reads: explicit columns of tracks, likes and playlists, never settings.

use rusqlite::{Connection, params};
use serde_json::Value;

use crate::{StoreError, tracks};

/// `(snapshot, first local path, added_at)` rows.
pub type Row = (Value, Option<String>, i64);

const LOCAL_PATH: &str = "(SELECT min(f.path) FROM local_files f WHERE f.track_id = t.id)";

fn rows(conn: &Connection, sql: &str, param: Option<&str>) -> Result<Vec<Row>, StoreError> {
    let mut stmt = conn.prepare(sql)?;
    let map = |r: &rusqlite::Row| Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?, r.get::<_, i64>(2)?));
    let raw: Vec<(String, Option<String>, i64)> = match param {
        Some(p) => stmt.query_map(params![p], map)?.collect::<Result<_, _>>()?,
        None => stmt.query_map([], map)?.collect::<Result<_, _>>()?,
    };
    raw.into_iter().map(|(json, path, at)| Ok((tracks::parse(&json)?, path, at))).collect()
}

/// Title, description and items in the playlist's manual order.
pub fn playlist(conn: &Connection, id: &str) -> Result<(String, Option<String>, Vec<Row>), StoreError> {
    let (title, description): (String, Option<String>) = conn
        .query_row("SELECT title, description FROM playlists WHERE id = ?1", [id], |r| Ok((r.get(0)?, r.get(1)?)))
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => StoreError::NotFound("playlist"),
            other => other.into(),
        })?;
    let sql = format!("SELECT t.snapshot_json, {LOCAL_PATH}, i.added_at FROM playlist_items i JOIN tracks t ON t.id = i.track_id WHERE i.playlist_id = ?1 ORDER BY i.position");
    Ok((title, description, rows(conn, &sql, Some(id))?))
}

pub fn liked(conn: &Connection) -> Result<Vec<Row>, StoreError> {
    let sql = format!("SELECT t.snapshot_json, {LOCAL_PATH}, l.liked_at FROM liked_tracks l JOIN tracks t ON t.id = l.track_id ORDER BY l.liked_at DESC");
    rows(conn, &sql, None)
}

pub fn own_playlist_ids(conn: &Connection) -> Result<Vec<String>, StoreError> {
    let mut stmt = conn.prepare("SELECT id FROM playlists ORDER BY created_at")?;
    Ok(stmt.query_map([], |r| r.get(0))?.collect::<Result<_, _>>()?)
}
