//! `track_keys`: canonical keys per stored track, computed lazily.

use std::collections::HashMap;

use nuvo_store::StoreError;
use rusqlite::{Connection, params};

use crate::{canon, savepoint};

#[derive(Debug, Clone, PartialEq)]
pub struct TrackKey {
    pub work: String,
    pub artist: String,
    pub variant_type: Option<String>,
    pub variant_by: Option<String>,
    pub duration_ms: i64,
}

impl TrackKey {
    /// Liking a track protects this exact variant from a work suppression.
    pub fn variant_key(&self) -> String {
        format!("{}|{}|{}", self.work, self.variant_type.as_deref().unwrap_or(""), self.variant_by.as_deref().unwrap_or(""))
    }

    /// An empty artist key means no artist, never a shared one.
    pub fn same_artist(&self, other: &TrackKey) -> bool {
        !self.artist.is_empty() && self.artist == other.artist
    }

    pub fn same_work(&self, other: &TrackKey) -> f64 {
        canon::same_work((&self.work, &self.artist, self.duration_ms), (&other.work, &other.artist, other.duration_ms))
    }
}

/// Computes keys for tracks that have none yet or whose snapshot changed since.
pub fn refresh(conn: &Connection) -> Result<usize, StoreError> {
    let mut stmt = conn.prepare(
        "SELECT t.id, t.title, t.artist, t.updated_at FROM tracks t LEFT JOIN track_keys k ON k.track_id = t.id
         WHERE k.track_id IS NULL OR k.computed_at < t.updated_at",
    )?;
    let stale = stmt
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?, r.get::<_, i64>(3)?)))?
        .collect::<Result<Vec<_>, _>>()?;
    if stale.is_empty() {
        return Ok(0);
    }
    savepoint(conn, "keys", || {
        let mut insert = conn.prepare(
            "INSERT OR REPLACE INTO track_keys (track_id, work_key, artist_key, variant_type, variant_by, computed_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        )?;
        for (id, title, artist, updated_at) in &stale {
            let c = canon::canon(title, artist);
            let (kind, by) = c.variant.map_or((None, None), |v| (Some(v.kind), v.by));
            insert.execute(params![id, c.work_key, c.artist_key, kind, by, updated_at])?;
        }
        Ok(stale.len())
    })
}

/// Keys for `ids` (call [`refresh`] first). Unknown ids are absent from the map.
pub fn load(conn: &Connection, ids: &[String]) -> Result<HashMap<String, TrackKey>, StoreError> {
    let mut stmt = conn.prepare(
        "SELECT k.track_id, k.work_key, k.artist_key, k.variant_type, k.variant_by, t.duration_ms
         FROM track_keys k JOIN tracks t ON t.id = k.track_id
         WHERE k.track_id IN (SELECT value FROM json_each(?1))",
    )?;
    let rows = stmt.query_map([serde_json::to_string(ids)?], |r| {
        Ok((
            r.get::<_, String>(0)?,
            TrackKey { work: r.get(1)?, artist: r.get(2)?, variant_type: r.get(3)?, variant_by: r.get(4)?, duration_ms: r.get(5)? },
        ))
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}
