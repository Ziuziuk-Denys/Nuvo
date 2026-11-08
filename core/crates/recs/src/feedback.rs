//! What a recorded play teaches the recommender. Called right after `events::record`.

use nuvo_contracts::RecordPlaybackEvent;
use nuvo_store::StoreError;
use rusqlite::{Connection, OptionalExtension, params};

use crate::model::{self, FEATURES};
use crate::rewards::{self, Outcome, Play};
use crate::{savepoint, suppress};

/// A play teaches the model only when the track came from a batch served this recently.
const SERVED_WINDOW_MS: i64 = 86_400_000;

/// Call only for a newly recorded event (`events::record` returns `is_new`). All or nothing.
pub fn after_play(conn: &Connection, event: &RecordPlaybackEvent, now: i64) -> Result<(), StoreError> {
    savepoint(conn, "feedback", || learn_from(conn, event, now))
}

fn learn_from(conn: &Connection, event: &RecordPlaybackEvent, now: i64) -> Result<(), StoreError> {
    suppress::after_play(conn, event, now)?;
    let served: Option<(String, i64)> = conn
        .query_row(
            "SELECT features_json, rowid FROM served WHERE track_id = ?1 AND served_at >= ?2 AND features_json IS NOT NULL AND learned = 0
             ORDER BY served_at DESC LIMIT 1",
            params![event.track_id, now - SERVED_WINDOW_MS],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?;
    let Some((json, rowid)) = served else { return Ok(()) };
    let x: [f64; FEATURES] = match serde_json::from_str::<[f64; FEATURES]>(&json) {
        Ok(arr) if arr.iter().all(|w| w.is_finite()) => arr,
        _ => return Ok(()), // Skip rows with invalid/non-finite features
    };
    let play = Play {
        track_id: event.track_id.clone(),
        artist_key: String::new(),
        session_id: event.listening_session_id.clone(),
        started_at: event.started_at.unwrap_or(now),
        played_ms: event.played_duration_ms.max(0),
        duration_ms: event.track_duration_ms,
        end_reason: rewards::end_reason(event).to_string(),
        context: event.context.as_ref().map(|c| c.kind.clone()),
        seek_forward_ms: event.seek_forward_ms,
        hour: 0,
        weekday: 0,
    };
    let outcome = rewards::outcome(&play);
    if outcome == Outcome::Neutral {
        return Ok(());
    }
    model::learn(conn, &x, rewards::reward(outcome, false, 1.0) > 0.0, now)?;
    conn.execute("UPDATE served SET learned = 1 WHERE rowid = ?1", params![rowid])?;
    Ok(())
}
