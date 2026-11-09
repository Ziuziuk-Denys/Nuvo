use nuvo_contracts::{
    MostSavedEntry, MostSavedResponse, PopularAlbumEntry, PopularAlbumsResponse,
    PopularTrackItem, PopularTracksResponse, Viewer, iso_from_ms,
};
use rusqlite::{Connection, params};
use serde_json::Value;

use crate::{StoreError, tracks};

/// A play counts once it completed or ran for 30 s, the usual scrobble threshold.
const COUNTED: &str = "(e.end_reason = 'complete' OR e.played_ms >= 30000)";

fn window_start(window: &str, now: i64) -> Result<i64, StoreError> {
    let hours = match window {
        "12h" => 12,
        "24h" => 24,
        "7d" => 7 * 24,
        "30d" => 30 * 24,
        "all" => return Ok(i64::MIN),
        _ => return Err(StoreError::Invalid(format!("unknown window {window}"))),
    };
    Ok(now - hours * 3_600_000)
}

pub fn popular_tracks(conn: &Connection, window: &str, limit: usize, now: i64) -> Result<PopularTracksResponse, StoreError> {
    let since = window_start(window, now)?;
    let mut stmt = conn.prepare(&format!(
        "SELECT t.snapshot_json, count(*) AS plays, EXISTS(SELECT 1 FROM liked_tracks l WHERE l.track_id = e.track_id)
         FROM play_events e JOIN tracks t ON t.id = e.track_id
         WHERE e.started_at >= ?1 AND {COUNTED}
         GROUP BY e.track_id ORDER BY plays DESC, max(e.started_at) DESC LIMIT ?2"
    ))?;
    let rows = stmt
        .query_map(params![since, limit.clamp(1, 200) as i64], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?, row.get::<_, bool>(2)?))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    let items = rows
        .into_iter()
        .enumerate()
        .map(|(index, (raw, plays, liked))| {
            Ok(PopularTrackItem {
                rank: index + 1,
                track: tracks::parse(&raw)?,
                play_count: plays,
                unique_listeners: 1,
                score: plays as f64,
                viewer: Viewer { liked },
            })
        })
        .collect::<Result<_, StoreError>>()?;
    Ok(PopularTracksResponse { window: window.into(), generated_at: iso_from_ms(now), items })
}

pub fn popular_albums(conn: &Connection, window: &str, limit: usize, now: i64) -> Result<PopularAlbumsResponse, StoreError> {
    let since = window_start(window, now)?;
    let mut stmt = conn.prepare(&format!(
        "SELECT t.album_id, max(t.album), max(t.artist), max(t.cover_url), count(*) AS plays,
                (SELECT count(*) FROM tracks t2 WHERE t2.album_id = t.album_id)
         FROM play_events e JOIN tracks t ON t.id = e.track_id
         WHERE t.album_id IS NOT NULL AND e.started_at >= ?1 AND {COUNTED}
         GROUP BY t.album_id ORDER BY plays DESC LIMIT ?2"
    ))?;
    let items = stmt
        .query_map(params![since, limit.clamp(1, 200) as i64], |row| {
            let plays: i64 = row.get(4)?;
            Ok(PopularAlbumEntry {
                id: row.get(0)?,
                title: row.get::<_, Option<String>>(1)?.unwrap_or_default(),
                artist: row.get(2)?,
                cover_url: row.get(3)?,
                play_count: plays,
                unique_listeners: 1,
                track_count: row.get(5)?,
                score: plays as f64,
            })
        })?
        .collect::<Result<_, _>>()?;
    Ok(PopularAlbumsResponse { window: window.into(), items })
}

pub fn most_saved(conn: &Connection, kind: &str, limit: usize) -> Result<MostSavedResponse, StoreError> {
    let kinds: &[&str] = match kind {
        "all" => &["album", "playlist"],
        "album" => &["album"],
        "playlist" => &["playlist"],
        _ => return Err(StoreError::Invalid(format!("unknown type {kind}"))),
    };
    let mut stmt = conn.prepare("SELECT kind, item_id, snapshot_json FROM saved_items WHERE kind IN ('album', 'playlist') ORDER BY saved_at DESC")?;
    let rows = stmt
        .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?)))?
        .collect::<Result<Vec<_>, _>>()?;
    let mut items = Vec::new();
    for (item_kind, id, raw) in rows {
        if !kinds.contains(&item_kind.as_str()) {
            continue;
        }
        let snapshot = tracks::parse(&raw)?;
        let subtitle = snapshot
            .get("trackCount")
            .and_then(Value::as_i64)
            .map_or_else(String::new, |n| format!("{n} tracks"));
        items.push(MostSavedEntry {
            kind: item_kind,
            id,
            title: snapshot.get("title").and_then(Value::as_str).unwrap_or_default().to_string(),
            subtitle,
            cover_url: snapshot.pointer("/cover/url").and_then(Value::as_str).map(str::to_string),
            saves: 1,
        });
    }
    items.truncate(limit.clamp(1, 200));
    Ok(MostSavedResponse { kind: kind.into(), items })
}
