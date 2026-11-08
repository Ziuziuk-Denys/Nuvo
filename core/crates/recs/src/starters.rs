//! Cold start: up to 15 top tracks of artists the owner named stand
//! in for taste seeds until his own likes and plays exist. Playlist tracks (imports included) come next.

use nuvo_store::{StoreError, tracks};
use rusqlite::{Connection, params};
use serde_json::Value;

use crate::savepoint;

pub const MAX_STARTERS: usize = 15;
const MAX_NAME_LEN: usize = 300;
const MAX_ARTISTS: usize = 16;
/// A YouTube id is 11 characters; the bound leaves room without admitting paths or spaces.
const MAX_YT_ID_LEN: usize = 32;

/// A cold-start pick comes from the renderer: `sc:<digits>` or a plain YouTube id, bounded names.
fn check_pick(pick: &Value) -> Result<(), StoreError> {
    let invalid = |what: &str| Err(StoreError::Invalid(format!("starter {what}")));
    let id = pick["id"].as_str().unwrap_or("");
    let valid_id = match id.strip_prefix("sc:") {
        Some(digits) => !digits.is_empty() && digits.len() <= 20 && digits.bytes().all(|b| b.is_ascii_digit()),
        None => !id.is_empty() && id.len() <= MAX_YT_ID_LEN && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-'),
    };
    if !valid_id {
        return invalid("id is not a YouTube or SoundCloud id");
    }
    if pick["title"].as_str().is_some_and(|t| t.chars().count() > MAX_NAME_LEN) {
        return invalid("title is too long");
    }
    let artists = pick["artists"].as_array().map_or(&[][..], Vec::as_slice);
    if artists.len() > MAX_ARTISTS || artists.iter().any(|a| a["name"].as_str().is_some_and(|n| n.chars().count() > MAX_NAME_LEN)) {
        return invalid("artists are too many or too long");
    }
    Ok(())
}

/// True when nothing tells the taste yet: no like, no counted play, no starter, no playlist track.
pub fn needed(conn: &Connection) -> Result<bool, StoreError> {
    let known: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM liked_tracks)
             OR EXISTS(SELECT 1 FROM play_events WHERE end_reason = 'complete' OR played_ms >= 30000)
             OR EXISTS(SELECT 1 FROM rec_starters)
             OR EXISTS(SELECT 1 FROM playlist_items)",
        [],
        |r| r.get(0),
    )?;
    Ok(!known)
}

/// Replaces the starters with `picks` (snapshots, 1-15). Returns how many were stored.
pub fn replace(conn: &Connection, picks: &[Value], now: i64) -> Result<usize, StoreError> {
    if picks.is_empty() || picks.len() > MAX_STARTERS {
        return Err(StoreError::Invalid(format!("1-{MAX_STARTERS} tracks")));
    }
    picks.iter().try_for_each(check_pick)?;
    savepoint(conn, "starters", || {
        conn.execute("DELETE FROM rec_starters", [])?;
        let mut stored = 0;
        for pick in picks {
            let id = tracks::upsert(conn, pick, now)?.id;
            stored += conn.execute("INSERT OR IGNORE INTO rec_starters (track_id, added_at) VALUES (?1, ?2)", params![id, now])?;
        }
        Ok(stored)
    })
}

/// Seeds for a library with too few of its own: starters first, then tracks of playlists not excluded
/// from taste, newest additions first; never one in `skip`, excluded or dismissed.
pub fn fallback_seeds(conn: &Connection, limit: usize, skip: &[String]) -> Result<Vec<String>, StoreError> {
    let mut stmt = conn.prepare(
        "SELECT f.track_id FROM (
             SELECT track_id, 0 AS tier, added_at FROM rec_starters
             UNION ALL
             SELECT track_id, 1 AS tier, added_at FROM playlist_items
              WHERE playlist_id NOT IN (SELECT id FROM taste_excluded WHERE kind = 'playlist')
         ) AS f
         WHERE f.track_id NOT IN (SELECT value FROM json_each(?1))
           AND NOT EXISTS(SELECT 1 FROM taste_excluded x WHERE x.kind = 'track' AND x.id = f.track_id)
           AND NOT EXISTS(SELECT 1 FROM suppressions s WHERE s.scope = 'exact' AND s.key = f.track_id)
         GROUP BY f.track_id ORDER BY min(f.tier), max(f.added_at) DESC, f.track_id
         LIMIT ?2",
    )?;
    let rows = stmt.query_map(params![serde_json::to_string(skip)?, limit as i64], |r| r.get(0))?;
    Ok(rows.collect::<Result<_, _>>()?)
}
