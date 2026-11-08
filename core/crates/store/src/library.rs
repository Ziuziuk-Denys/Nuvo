use std::collections::HashSet;

use nuvo_contracts::{BulkLikeResult, LikedTrackItem, LikedTracksPage, TrackFields, iso_from_ms, with_viewer};
use rusqlite::{Connection, params};
use serde_json::{Value, json};

use crate::{StoreError, tracks};

pub fn like(conn: &Connection, id: &str, snapshot: Option<Value>, now: i64) -> Result<(), StoreError> {
    let tx = conn.unchecked_transaction()?;
    tracks::ensure(&tx, id, snapshot.as_ref(), now)?;
    tx.execute("INSERT OR IGNORE INTO liked_tracks (track_id, liked_at) VALUES (?1, ?2)", params![id, now])?;
    tx.commit()?;
    Ok(())
}

/// Every liked track with its snapshot, for comparing a new like against them.
pub fn liked_snapshots(conn: &Connection) -> Result<Vec<(String, Value)>, StoreError> {
    let mut stmt = conn.prepare("SELECT t.id, t.snapshot_json FROM liked_tracks l JOIN tracks t ON t.id = l.track_id")?;
    let rows = stmt.query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))?;
    let mut out = Vec::new();
    for row in rows {
        let (id, json) = row?;
        if let Ok(value) = serde_json::from_str(&json) {
            out.push((id, value));
        }
    }
    Ok(out)
}

pub fn unlike(conn: &Connection, id: &str) -> Result<(), StoreError> {
    conn.execute("DELETE FROM liked_tracks WHERE track_id = ?1", [id])?;
    Ok(())
}

/// Per request; the renderer splits bigger sets.
pub const MAX_BULK_LIKES: usize = 5000;

/// Likes every valid snapshot in one transaction; tracks already liked stay as they were.
/// Liked songs list newest first, so `liked_at` counts down from `now` in input order and the
/// first track of a playlist stays on top.
pub fn like_many(conn: &Connection, snapshots: &[Value], now: i64) -> Result<BulkLikeResult, StoreError> {
    if snapshots.len() > MAX_BULK_LIKES {
        return Err(StoreError::Invalid(format!("at most {MAX_BULK_LIKES} tracks per request")));
    }
    let tx = conn.unchecked_transaction()?;
    let mut seen = HashSet::new();
    let (mut added, mut already_liked, mut rejected) = (Vec::new(), 0, 0);
    for snapshot in snapshots {
        let Ok(fields) = TrackFields::from_snapshot(snapshot) else {
            rejected += 1;
            continue;
        };
        if !seen.insert(fields.id.clone()) || is_liked(&tx, &fields.id)? {
            already_liked += 1;
            continue;
        }
        tracks::upsert(&tx, snapshot, now)?;
        tx.execute("INSERT INTO liked_tracks (track_id, liked_at) VALUES (?1, ?2)", params![fields.id, now - added.len() as i64])?;
        added.push(fields.id);
    }
    tx.commit()?;
    Ok(BulkLikeResult { added, already_liked, rejected })
}

/// Undo of `like_many`: unlikes exactly these ids. Returns how many were liked.
pub fn unlike_many(conn: &Connection, ids: &[String]) -> Result<usize, StoreError> {
    if ids.len() > MAX_BULK_LIKES {
        return Err(StoreError::Invalid(format!("at most {MAX_BULK_LIKES} ids per request")));
    }
    let tx = conn.unchecked_transaction()?;
    let mut removed = 0;
    for id in ids {
        removed += tx.execute("DELETE FROM liked_tracks WHERE track_id = ?1", [id])?;
    }
    tx.commit()?;
    Ok(removed)
}

pub fn is_liked(conn: &Connection, id: &str) -> Result<bool, StoreError> {
    Ok(conn.query_row("SELECT EXISTS(SELECT 1 FROM liked_tracks WHERE track_id = ?1)", [id], |row| row.get(0))?)
}

/// Every liked track id, newest like first: the renderer's "is liked" set.
pub fn liked_ids(conn: &Connection) -> Result<Vec<String>, StoreError> {
    let mut stmt = conn.prepare("SELECT track_id FROM liked_tracks ORDER BY liked_at DESC, track_id DESC")?;
    let ids = stmt.query_map([], |row| row.get::<_, String>(0))?.collect::<Result<Vec<_>, _>>()?;
    Ok(ids)
}

/// Keyset paging, newest first. The cursor is `<liked_at>|<track_id>` of the last item served.
pub fn liked_page(conn: &Connection, limit: usize, cursor: Option<&str>) -> Result<LikedTracksPage, StoreError> {
    let limit = limit.clamp(1, 500);
    let (after_ms, after_id) = match cursor {
        None => (None, None),
        Some(raw) => {
            let (ms, id) = raw.split_once('|').ok_or_else(|| StoreError::Invalid("bad cursor".into()))?;
            let ms: i64 = ms.parse().map_err(|_| StoreError::Invalid("bad cursor".into()))?;
            (Some(ms), Some(id.to_string()))
        }
    };
    let mut stmt = conn.prepare(
        "SELECT t.snapshot_json, l.liked_at, l.track_id FROM liked_tracks l JOIN tracks t ON t.id = l.track_id
         WHERE ?1 IS NULL OR (l.liked_at, l.track_id) < (?1, ?2)
         ORDER BY l.liked_at DESC, l.track_id DESC LIMIT ?3",
    )?;
    let rows = stmt
        .query_map(params![after_ms, after_id, limit as i64 + 1], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?, row.get::<_, String>(2)?))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    let next_cursor = (rows.len() > limit).then(|| {
        let (_, ms, id) = &rows[limit - 1];
        format!("{ms}|{id}")
    });
    let items = rows
        .into_iter()
        .take(limit)
        .map(|(raw, ms, _)| {
            Ok(LikedTrackItem { track: with_viewer(tracks::parse(&raw)?, true), liked_at: iso_from_ms(ms) })
        })
        .collect::<Result<_, StoreError>>()?;
    Ok(LikedTracksPage { items, next_cursor })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SavedKind {
    Album,
    Artist,
    Playlist,
}

impl SavedKind {
    pub fn from_plural(plural: &str) -> Option<Self> {
        match plural {
            "albums" => Some(Self::Album),
            "artists" => Some(Self::Artist),
            "playlists" => Some(Self::Playlist),
            _ => None,
        }
    }

    pub fn singular(self) -> &'static str {
        match self {
            Self::Album => "album",
            Self::Artist => "artist",
            Self::Playlist => "playlist",
        }
    }
}

pub fn save_item(conn: &Connection, kind: SavedKind, id: &str, snapshot: Option<Value>, now: i64) -> Result<(), StoreError> {
    let mut snapshot = snapshot.unwrap_or_else(|| json!({}));
    let obj = snapshot
        .as_object_mut()
        .ok_or_else(|| StoreError::Invalid("snapshot must be an object".into()))?;
    obj.insert("id".into(), json!(id));
    conn.execute(
        "INSERT INTO saved_items (kind, item_id, snapshot_json, saved_at) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(kind, item_id) DO UPDATE SET snapshot_json = excluded.snapshot_json",
        params![kind.singular(), id, snapshot.to_string(), now],
    )?;
    Ok(())
}

/// Items in the shape `useExternalItems` reads: `{ "<kind>": snapshot, "savedAt": iso }`.
pub fn list_saved(conn: &Connection, kind: SavedKind) -> Result<Vec<Value>, StoreError> {
    let mut stmt = conn.prepare("SELECT snapshot_json, saved_at FROM saved_items WHERE kind = ?1 ORDER BY saved_at DESC")?;
    let rows = stmt
        .query_map([kind.singular()], |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)))?
        .collect::<Result<Vec<_>, _>>()?;
    rows.into_iter()
        .map(|(raw, ms)| Ok(json!({ kind.singular(): tracks::parse(&raw)?, "savedAt": iso_from_ms(ms) })))
        .collect()
}

pub fn remove_item(conn: &Connection, kind: SavedKind, id: &str) -> Result<(), StoreError> {
    conn.execute("DELETE FROM saved_items WHERE kind = ?1 AND item_id = ?2", params![kind.singular(), id])?;
    Ok(())
}
