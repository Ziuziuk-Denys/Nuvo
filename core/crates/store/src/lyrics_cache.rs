use nuvo_contracts::LyricsCandidate;
use rusqlite::{Connection, OptionalExtension, params};

use crate::StoreError;

#[derive(Debug, Clone, PartialEq)]
pub struct CachedLyrics {
    pub candidate: Option<LyricsCandidate>,
    pub instrumental: bool,
    pub fetched_at: i64,
}

pub fn get(conn: &Connection, track_id: &str) -> Result<Option<CachedLyrics>, StoreError> {
    let row: Option<(String, bool, i64)> = conn
        .query_row(
            "SELECT body_json, instrumental, fetched_at FROM lyrics WHERE track_id = ?1",
            [track_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()?;
    row.map(|(body, instrumental, fetched_at)| {
        Ok(CachedLyrics { candidate: serde_json::from_str(&body)?, instrumental, fetched_at })
    })
    .transpose()
}

pub fn put(conn: &Connection, track_id: &str, candidate: Option<&LyricsCandidate>, instrumental: bool, now: i64) -> Result<(), StoreError> {
    let provider = candidate.map_or("lrclib", |c| c.provider.as_str());
    let synced = candidate.is_some_and(|c| c.sync_level != "plain");
    conn.execute(
        "INSERT INTO lyrics (track_id, provider, synced, instrumental, body_json, fetched_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(track_id) DO UPDATE SET provider = excluded.provider, synced = excluded.synced,
           instrumental = excluded.instrumental, body_json = excluded.body_json, fetched_at = excluded.fetched_at",
        params![track_id, provider, synced, instrumental, serde_json::to_string(&candidate)?, now],
    )?;
    Ok(())
}
