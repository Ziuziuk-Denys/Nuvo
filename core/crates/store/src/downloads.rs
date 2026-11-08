//! Saved-file jobs. An item is ready once its audio is cached or it is a playable local file.

use nuvo_contracts::DownloadSummary;
use rusqlite::{Connection, OptionalExtension, params};
use serde_json::Value;

use crate::{StoreError, new_id, tracks};

pub const MAX_TRACKS: usize = 5000;

pub struct NewDownload {
    pub dir: String,
    pub format: String,
    pub label: String,
    pub playlist_file: bool,
    pub track_ids: Vec<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Ready {
    pub download_id: String,
    pub position: i64,
    pub track_id: String,
    pub snapshot: Value,
    pub dir: String,
    pub format: String,
    pub mime: Option<String>,
    pub codec: Option<String>,
    pub local: bool,
}

const READY: &str = "(EXISTS (SELECT 1 FROM cache_entries c WHERE c.track_id = i.track_id)
  OR EXISTS (SELECT 1 FROM local_files f JOIN local_roots r ON r.id = f.root_id AND r.status = 'ok' WHERE f.track_id = i.track_id))";

/// The ids to save, in order, without repeats: a playlist's items, the likes (newest first) or a list.
pub fn track_ids_for(conn: &Connection, playlist_id: Option<&str>, liked: bool, ids: &[String]) -> Result<Vec<String>, StoreError> {
    let mut found: Vec<String> = if let Some(pid) = playlist_id {
        let mut stmt = conn.prepare("SELECT track_id FROM playlist_items WHERE playlist_id = ?1 ORDER BY position")?;
        stmt.query_map([pid], |r| r.get(0))?.collect::<Result<_, _>>()?
    } else if liked {
        let mut stmt = conn.prepare("SELECT track_id FROM liked_tracks ORDER BY liked_at DESC")?;
        stmt.query_map([], |r| r.get(0))?.collect::<Result<_, _>>()?
    } else {
        ids.to_vec()
    };
    let mut seen = std::collections::HashSet::new();
    found.retain(|id| seen.insert(id.clone()));
    Ok(found)
}

pub fn create(conn: &Connection, input: &NewDownload, now: i64) -> Result<DownloadSummary, StoreError> {
    if input.track_ids.is_empty() {
        return Err(StoreError::Invalid("nothing to save".into()));
    }
    if input.track_ids.len() > MAX_TRACKS {
        return Err(StoreError::Invalid(format!("at most {MAX_TRACKS} tracks per save")));
    }
    let tx = conn.unchecked_transaction()?;
    let id = new_id();
    tx.execute(
        "INSERT INTO downloads (id, dir, format, label, playlist_file, created_at, status) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'running')",
        params![id, input.dir, input.format, input.label, input.playlist_file, now],
    )?;
    for (position, track_id) in input.track_ids.iter().enumerate() {
        if tracks::snapshot(&tx, track_id)?.is_none() {
            return Err(StoreError::NotFound("track"));
        }
        tx.execute("INSERT INTO download_items (download_id, position, track_id, state) VALUES (?1, ?2, ?3, 'queued')", params![id, position as i64, track_id])?;
    }
    tx.commit()?;
    summary(conn, &id)
}

fn summary(conn: &Connection, id: &str) -> Result<DownloadSummary, StoreError> {
    let sql = format!(
        "SELECT d.id, d.label, d.dir, d.format, d.status, d.created_at,
           (SELECT count(*) FROM download_items i WHERE i.download_id = d.id),
           (SELECT count(*) FROM download_items i WHERE i.download_id = d.id AND i.state = 'done'),
           (SELECT count(*) FROM download_items i WHERE i.download_id = d.id AND i.state = 'failed'),
           (SELECT count(*) FROM download_items i WHERE i.download_id = d.id AND i.state = 'queued' AND NOT {READY})
         FROM downloads d WHERE d.id = ?1"
    );
    conn.query_row(&sql, [id], |r| {
        Ok(DownloadSummary {
            id: r.get(0)?, label: r.get(1)?, dir: r.get(2)?, format: r.get(3)?, status: r.get(4)?, created_at: r.get(5)?,
            total: r.get(6)?, done: r.get(7)?, failed: r.get(8)?, waiting: r.get(9)?,
        })
    })
    .optional()?
    .ok_or(StoreError::NotFound("download"))
}

/// The newest 20 jobs.
pub fn list(conn: &Connection) -> Result<Vec<DownloadSummary>, StoreError> {
    let mut stmt = conn.prepare("SELECT id FROM downloads ORDER BY created_at DESC LIMIT 20")?;
    let ids: Vec<String> = stmt.query_map([], |r| r.get(0))?.collect::<Result<_, _>>()?;
    ids.iter().map(|id| summary(conn, id)).collect()
}

pub fn next(conn: &Connection) -> Result<Option<Ready>, StoreError> {
    let sql = format!(
        "SELECT i.download_id, i.position, i.track_id, t.snapshot_json, d.dir, d.format, c.mime, c.codec,
           EXISTS (SELECT 1 FROM local_files f WHERE f.track_id = i.track_id)
         FROM download_items i JOIN downloads d ON d.id = i.download_id AND d.status = 'running'
         JOIN tracks t ON t.id = i.track_id LEFT JOIN cache_entries c ON c.track_id = i.track_id
         WHERE i.state = 'queued' AND {READY} ORDER BY d.created_at, i.position LIMIT 1"
    );
    let raw = conn
        .query_row(&sql, [], |r| {
            Ok((r.get::<_, String>(0)?, r.get(1)?, r.get::<_, String>(2)?, r.get::<_, String>(3)?, r.get::<_, String>(4)?, r.get::<_, String>(5)?, r.get(6)?, r.get(7)?, r.get::<_, bool>(8)?))
        })
        .optional()?;
    raw.map(|(download_id, position, track_id, json, dir, format, mime, codec, local)| {
        Ok(Ready { download_id, position, track_id, snapshot: tracks::parse(&json)?, dir, format, mime, codec, local })
    })
    .transpose()
}

/// Snapshots of queued tracks whose audio is not cached yet, for the renderer to fetch.
pub fn waiting(conn: &Connection, limit: usize) -> Result<Vec<Value>, StoreError> {
    let sql = format!(
        "SELECT DISTINCT t.snapshot_json FROM download_items i JOIN downloads d ON d.id = i.download_id AND d.status = 'running'
         JOIN tracks t ON t.id = i.track_id WHERE i.state = 'queued' AND NOT {READY} LIMIT ?1"
    );
    let mut stmt = conn.prepare(&sql)?;
    let raws: Vec<String> = stmt.query_map([limit.clamp(1, 50) as i64], |r| r.get(0))?.collect::<Result<_, _>>()?;
    raws.iter().map(|raw| tracks::parse(raw)).collect()
}

fn close_if_finished(conn: &Connection, download_id: &str) -> Result<bool, StoreError> {
    let closed = conn.execute(
        "UPDATE downloads SET status = 'done' WHERE id = ?1 AND status = 'running'
           AND NOT EXISTS (SELECT 1 FROM download_items WHERE download_id = ?1 AND state = 'queued')",
        [download_id],
    )?;
    Ok(closed > 0)
}

/// Records one item; true when that closed the job.
pub fn finish(conn: &Connection, download_id: &str, position: i64, result: Result<String, String>) -> Result<bool, StoreError> {
    let (state, file_name, error) = match result {
        Ok(name) => ("done", Some(name), None),
        Err(reason) => ("failed", None, Some(reason)),
    };
    conn.execute(
        "UPDATE download_items SET state = ?3, file_name = ?4, error = ?5 WHERE download_id = ?1 AND position = ?2 AND state = 'queued'",
        params![download_id, position, state, file_name, error],
    )?;
    close_if_finished(conn, download_id)
}

/// The renderer could not fetch this track: every queued item of it fails.
pub fn fail_track(conn: &Connection, track_id: &str, reason: &str) -> Result<usize, StoreError> {
    let mut stmt = conn.prepare("SELECT DISTINCT download_id FROM download_items WHERE track_id = ?1 AND state = 'queued'")?;
    let jobs: Vec<String> = stmt.query_map([track_id], |r| r.get(0))?.collect::<Result<_, _>>()?;
    let failed = conn.execute("UPDATE download_items SET state = 'failed', error = ?2 WHERE track_id = ?1 AND state = 'queued'", params![track_id, reason])?;
    for job in jobs {
        close_if_finished(conn, &job)?;
    }
    Ok(failed)
}

pub fn cancel(conn: &Connection, id: &str) -> Result<(), StoreError> {
    if conn.execute("UPDATE downloads SET status = 'cancelled' WHERE id = ?1 AND status = 'running'", [id])? == 0 {
        summary(conn, id)?;
    }
    conn.execute("UPDATE download_items SET state = 'cancelled' WHERE download_id = ?1 AND state = 'queued'", [id])?;
    Ok(())
}

pub fn saved_files(conn: &Connection, id: &str) -> Result<(String, String, bool, Vec<String>), StoreError> {
    let (label, dir, playlist_file): (String, String, bool) = conn
        .query_row("SELECT label, dir, playlist_file FROM downloads WHERE id = ?1", [id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
        .optional()?
        .ok_or(StoreError::NotFound("download"))?;
    let mut stmt = conn.prepare("SELECT file_name FROM download_items WHERE download_id = ?1 AND state = 'done' ORDER BY position")?;
    let files = stmt.query_map([id], |r| r.get(0))?.collect::<Result<_, _>>()?;
    Ok((label, dir, playlist_file, files))
}

/// Every folder a job ever saved into.
pub fn dirs(conn: &Connection) -> Result<Vec<String>, StoreError> {
    let mut stmt = conn.prepare("SELECT DISTINCT dir FROM downloads")?;
    Ok(stmt.query_map([], |r| r.get(0))?.collect::<Result<_, _>>()?)
}

/// Folder and track snapshot of every item still waiting in a running job.
pub fn queued(conn: &Connection) -> Result<Vec<(String, Value)>, StoreError> {
    let mut stmt = conn.prepare(
        "SELECT d.dir, t.snapshot_json FROM download_items i JOIN downloads d ON d.id = i.download_id AND d.status = 'running'
         JOIN tracks t ON t.id = i.track_id WHERE i.state = 'queued'",
    )?;
    let raws: Vec<(String, String)> = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?.collect::<Result<_, _>>()?;
    raws.into_iter().map(|(dir, raw)| Ok((dir, tracks::parse(&raw)?))).collect()
}
