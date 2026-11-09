use std::collections::HashSet;

use nuvo_contracts::MAX_TRACK_ID_LEN;
use nuvo_store::{StoreError, tracks};
use rusqlite::{Connection, params};
use serde_json::Value;

use crate::savepoint;

pub const MAX_POOL_ITEMS: usize = 100;
pub const SEED_LIMIT: i64 = 12;
pub const YT_RADIO: &str = "yt_radio";
pub const SC_RELATED: &str = "sc_related";
const STALE_MS: i64 = 86_400_000;
const MISS_RETRY_MS: i64 = 7 * 86_400_000;
const SEED_WINDOW_MS: i64 = 30 * 86_400_000;

fn check_id(id: &str, what: &str) -> Result<(), StoreError> {
    if id.is_empty() || id.len() > MAX_TRACK_ID_LEN {
        return Err(StoreError::Invalid(format!("{what} must be 1-{MAX_TRACK_ID_LEN} characters")));
    }
    Ok(())
}

pub fn replace(conn: &Connection, seed_id: &str, source: &str, items: &[Value], now: i64) -> Result<usize, StoreError> {
    check_id(seed_id, "seedId")?;
    check_source(source)?;
    if items.len() > MAX_POOL_ITEMS {
        return Err(StoreError::Invalid(format!("at most {MAX_POOL_ITEMS} items")));
    }
    savepoint(conn, "pool", || {
        let mut kept = HashSet::new();
        if !items.is_empty() {
            conn.execute("DELETE FROM candidate_edges WHERE seed_id = ?1 AND source = ?2", params![seed_id, source])?;
            for (rank, item) in items.iter().enumerate() {
                let id = tracks::upsert(conn, item, now)?.id;
                if id == seed_id {
                    continue;
                }
                conn.execute(
                    "INSERT OR IGNORE INTO candidate_edges (seed_id, track_id, rank, source, fetched_at) VALUES (?1, ?2, ?3, ?4, ?5)",
                    params![seed_id, id, rank as i64, source, now],
                )?;
                // A track another list or a ranked request already holds is still stored, so an overlapping list is no miss.
                kept.insert(id);
            }
        }
        let stored = kept.len();
        conn.execute(
            "INSERT INTO pool_fetches (seed_id, source, fetched_at, stored) VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(seed_id, source) DO UPDATE SET fetched_at = excluded.fetched_at, stored = excluded.stored",
            params![seed_id, source, now, stored as i64],
        )?;
        Ok(stored)
    })
}

fn check_source(source: &str) -> Result<(), StoreError> {
    if source.is_empty() || source.len() > 32 {
        return Err(StoreError::Invalid("source must be 1-32 characters".into()));
    }
    Ok(())
}

pub fn record(conn: &Connection, seed_id: &str, ids: &[String], now: i64) -> Result<(), StoreError> {
    if ids.len() > MAX_POOL_ITEMS {
        return Err(StoreError::Invalid(format!("at most {MAX_POOL_ITEMS} items")));
    }
    savepoint(conn, "pool", || {
        let mut stmt = conn.prepare(
            "INSERT INTO candidate_edges (seed_id, track_id, rank, source, fetched_at) VALUES (?1, ?2, ?3, 'rank', ?4)
             ON CONFLICT(seed_id, track_id) DO UPDATE SET rank = excluded.rank, fetched_at = excluded.fetched_at",
        )?;
        for (rank, id) in ids.iter().enumerate().filter(|(_, id)| *id != seed_id) {
            stmt.execute(params![seed_id, id, rank as i64, now])?;
        }
        Ok(())
    })
}

// Only sc_related may start from a SoundCloud track: the renderer's YouTube sources cannot
pub fn stale_seeds(conn: &Connection, now: i64, source: &str) -> Result<Vec<String>, StoreError> {
    check_source(source)?;
    let mut stmt = conn.prepare(
        "WITH counted AS (SELECT track_id, sum(end_reason = 'complete') AS finished FROM play_events
                          WHERE started_at >= ?2 AND (end_reason = 'complete' OR played_ms >= 30000) GROUP BY track_id),
              fresh AS (SELECT seed_id FROM pool_fetches WHERE source = ?4
                        AND fetched_at >= CASE WHEN stored > 0 THEN ?1 ELSE ?5 END),
              backup AS (SELECT track_id, min(tier) AS tier FROM (
                           SELECT track_id, 1 AS tier FROM rec_starters
                           UNION ALL
                           SELECT track_id, 2 AS tier FROM playlist_items
                            WHERE playlist_id NOT IN (SELECT id FROM taste_excluded WHERE kind = 'playlist'))
                         GROUP BY track_id)
         SELECT t.id FROM tracks t
         LEFT JOIN counted c ON c.track_id = t.id
         LEFT JOIN backup b ON b.track_id = t.id
         WHERE (c.track_id IS NOT NULL OR t.id IN (SELECT track_id FROM liked_tracks) OR b.track_id IS NOT NULL)
           AND t.id NOT IN (SELECT seed_id FROM fresh)
           AND (?4 = 'sc_related' OR t.source = 'youtube')
           AND NOT EXISTS(SELECT 1 FROM taste_excluded x WHERE x.kind = 'track' AND x.id = t.id)
           AND NOT EXISTS(SELECT 1 FROM suppressions s WHERE s.scope = 'exact' AND s.key = t.id)
         ORDER BY CASE WHEN c.track_id IS NOT NULL OR t.id IN (SELECT track_id FROM liked_tracks) THEN 0 ELSE b.tier END,
                  coalesce(c.finished, 0) + 3 * (t.id IN (SELECT track_id FROM liked_tracks)) DESC, t.id
         LIMIT ?3",
    )?;
    let rows = stmt.query_map(params![now - STALE_MS, now - SEED_WINDOW_MS, SEED_LIMIT, source, now - MISS_RETRY_MS], |r| r.get(0))?;
    Ok(rows.collect::<Result<_, _>>()?)
}

pub fn neighbours(conn: &Connection, anchors: &[String], limit: usize) -> Result<Vec<(String, Value, String)>, StoreError> {
    if anchors.is_empty() {
        return Ok(Vec::new());
    }
    let mut stmt = conn.prepare(
        "SELECT t.id, t.snapshot_json, t.artist FROM candidate_edges e JOIN tracks t ON t.id = e.track_id
         WHERE e.seed_id IN (SELECT value FROM json_each(?1))
         GROUP BY t.id ORDER BY min(e.rank), t.id LIMIT ?2",
    )?;
    let rows = stmt
        .query_map(params![serde_json::to_string(anchors)?, limit as i64], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?)))?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows.into_iter().filter_map(|(id, raw, artist)| serde_json::from_str(&raw).ok().map(|snapshot| (id, snapshot, artist))).collect())
}
