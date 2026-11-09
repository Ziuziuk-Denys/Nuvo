// Remembered outcomes: approved for 90 days, pending for 1 day

use nuvo_store::{Connection, StoreError, settings};
use rusqlite::OptionalExtension;
use serde_json::{Value, json};

use crate::cascade::Answer;
use crate::decide::{Reason, Source};
use crate::text::normalize;

/// Raise when matching changes; every memo entry (not the stand-in map) is then dropped.
pub const MATCHER_VERSION: i64 = 1;
pub const VERSION_KEY: &str = "match_version";
const DAY_MS: i64 = 86_400_000;
const APPROVED_TTL_MS: i64 = 90 * DAY_MS;
const PENDING_TTL_MS: i64 = DAY_MS;

pub fn key(source: &Source) -> String {
    let artist = source.artists.first().map(|a| normalize(a)).unwrap_or_default();
    let seconds = source.duration_ms.filter(|ms| *ms > 0).map_or(0, |ms| (ms + 500) / 1000);
    format!("{}|{}|{}", normalize(&source.title), artist, seconds)
}

fn sync_version(conn: &Connection) -> Result<(), StoreError> {
    if settings::get(conn, VERSION_KEY)?.and_then(|v| v.as_i64()) != Some(MATCHER_VERSION) {
        conn.execute("DELETE FROM match_memo", [])?;
        settings::set(conn, VERSION_KEY, &json!(MATCHER_VERSION))?;
    }
    Ok(())
}

pub fn get(conn: &Connection, source: &Source, now: i64) -> Result<Option<Answer>, StoreError> {
    sync_version(conn)?;
    let key = key(source);
    let row: Option<(String, bool, i64)> = conn
        .query_row("SELECT outcome_json, approved, created_at FROM match_memo WHERE key = ?1", [&key], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
        .optional()?;
    let Some((json, approved, created_at)) = row else { return Ok(None) };
    let ttl = if approved { APPROVED_TTL_MS } else { PENDING_TTL_MS };
    if now - created_at > ttl {
        conn.execute("DELETE FROM match_memo WHERE key = ?1", [&key])?;
        return Ok(None);
    }
    Ok(serde_json::from_str(&json).ok())
}

fn track_id(track: Option<&Value>) -> Option<String> {
    track?.get("id")?.as_str().map(str::to_string)
}

pub fn put(conn: &Connection, source: &Source, answer: &Answer, now: i64) -> Result<(), StoreError> {
    let (approved, track) = match answer {
        Answer::Approved { track, .. } => (true, Some(track)),
        // A lookup failure is transient, so the next ask must search again.
        Answer::Pending { reason: Reason::LookupFailed, .. } | Answer::Search { .. } => return Ok(()),
        Answer::Pending { proposed_track, .. } => (false, proposed_track.as_ref()),
    };
    sync_version(conn)?;
    conn.execute(
        "INSERT INTO match_memo (key, outcome_json, approved, track_id, created_at) VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(key) DO UPDATE SET outcome_json = excluded.outcome_json, approved = excluded.approved,
           track_id = excluded.track_id, created_at = excluded.created_at",
        (key(source), serde_json::to_string(answer)?, approved, track_id(track), now),
    )?;
    Ok(())
}

pub fn standin(conn: &Connection, nuvo_track_id: &str) -> Result<Option<Answer>, StoreError> {
    let row: Option<(String, i64)> = conn.query_row("SELECT track_json, score FROM match_standins WHERE track_id = ?1", [nuvo_track_id], |r| Ok((r.get(0)?, r.get(1)?))).optional()?;
    Ok(row.and_then(|(json, score)| serde_json::from_str(&json).ok().map(|track| Answer::Approved { track, score })))
}

pub fn put_standin(conn: &Connection, nuvo_track_id: &str, answer: &Answer, now: i64) -> Result<(), StoreError> {
    let Answer::Approved { track, score } = answer else { return Ok(()) };
    let Some(video_id) = track_id(Some(track)) else { return Ok(()) };
    conn.execute(
        "INSERT INTO match_standins (track_id, video_id, track_json, score, created_at) VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(track_id) DO UPDATE SET video_id = excluded.video_id, track_json = excluded.track_json,
           score = excluded.score, created_at = excluded.created_at",
        (nuvo_track_id, video_id, track.to_string(), score, now),
    )?;
    Ok(())
}
