use nuvo_contracts::{PlaybackContext, PlaybackHistoryItem, PlaybackHistoryResponse, RecordPlaybackEvent, iso_from_ms, local_hour_weekday, source_of};
use rusqlite::{Connection, params};

use crate::{StoreError, listening, scrobbles, tracks};

const END_REASONS: [&str; 6] = ["complete", "skip", "next", "seek", "error", "stop"];
const SOURCES: [&str; 4] = ["youtube", "soundcloud", "cache", "local"];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Recorded {
    pub is_new: bool,
    pub queued: bool,
}

pub fn record(conn: &Connection, event: &RecordPlaybackEvent, now: i64) -> Result<Recorded, StoreError> {
    let end_reason = match event.end_reason.as_deref() {
        Some(reason) if END_REASONS.contains(&reason) => reason,
        Some(_) => return Err(StoreError::Invalid("unknown endReason".into())),
        None if event.completed => "complete",
        None if event.skipped => "skip",
        None => "stop",
    };
    let played_ms = event.played_duration_ms.max(0);
    let started_at = event.started_at.unwrap_or(now - played_ms);
    let tz_offset_min = event.tz_offset_min.unwrap_or(0);
    let (hour, weekday) = local_hour_weekday(started_at, tz_offset_min);
    let source = event.source.as_deref().filter(|source| SOURCES.contains(source)).unwrap_or(source_of(&event.track_id));
    let tx = conn.unchecked_transaction()?;
    tracks::ensure(&tx, &event.track_id, event.track_snapshot.as_ref(), now)?;
    if listening::collection_paused(&tx)? {
        let queued = scrobbles::enqueue_play(&tx, &event.track_id, started_at, played_ms, event.track_duration_ms)?;
        tx.commit()?;
        return Ok(Recorded { is_new: false, queued });
    }
    tx.execute(
        "INSERT OR IGNORE INTO play_events (track_id, session_id, started_at, played_ms, duration_ms, end_reason, context, context_id,
                                  position_in_session, hour, weekday, loop_count, seek_back, seek_forward_ms, tz_offset_min, source)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)",
        params![
            event.track_id,
            event.listening_session_id,
            started_at,
            played_ms,
            event.track_duration_ms,
            end_reason,
            event.context.as_ref().map(|c| c.kind.as_str()),
            event.context.as_ref().and_then(|c| c.id.as_deref()),
            event.position_in_session,
            hour,
            weekday,
            event.loop_count.max(0),
            event.has_seek_backward,
            event.seek_forward_ms.max(0),
            tz_offset_min,
            source
        ],
    )?;
    let is_new = tx.changes() == 1;
    let queued = is_new && scrobbles::enqueue_play(&tx, &event.track_id, started_at, played_ms, event.track_duration_ms)?;
    tx.commit()?;
    Ok(Recorded { is_new, queued })
}

pub fn history(conn: &Connection, limit: usize, cursor: Option<&str>, filter: Option<&str>) -> Result<PlaybackHistoryResponse, StoreError> {
    let limit = limit.clamp(1, 200);
    let before: Option<i64> = cursor
        .map(|c| c.parse().map_err(|_| StoreError::Invalid("bad cursor".into())))
        .transpose()?;
    let reason = match filter {
        None | Some("all") => None,
        Some("completed") => Some("complete"),
        Some("skipped") => Some("skip"),
        Some(_) => return Err(StoreError::Invalid("filter must be all, completed or skipped".into())),
    };
    // Plays under 3 s are kept for ranking (a skip at once is a signal) but hidden from History.
    let mut stmt = conn.prepare(
        "SELECT e.id, e.session_id, t.snapshot_json, e.played_ms, e.duration_ms, e.end_reason, e.loop_count,
                e.seek_back, e.context, e.context_id, e.started_at
         FROM play_events e JOIN tracks t ON t.id = e.track_id AND (e.played_ms >= 3000 OR e.end_reason = 'complete')
         WHERE (?1 IS NULL OR e.id < ?1) AND (?3 IS NULL OR e.end_reason = ?3) ORDER BY e.id DESC LIMIT ?2",
    )?;
    let rows = stmt
        .query_map(params![before, limit as i64 + 1, reason], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, i64>(3)?,
                row.get::<_, Option<i64>>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, i64>(6)?,
                row.get::<_, bool>(7)?,
                row.get::<_, Option<String>>(8)?,
                row.get::<_, Option<String>>(9)?,
                row.get::<_, i64>(10)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    let next_cursor = (rows.len() > limit).then(|| rows[limit - 1].0.to_string());
    let items = rows
        .into_iter()
        .take(limit)
        .map(|(id, session, raw, played, duration, reason, loops, seek_back, context, context_id, started_at)| {
            let completed = reason == "complete";
            let completion_rate = match duration {
                Some(d) if d > 0 => (played as f64 / d as f64).min(1.0),
                _ if completed => 1.0,
                _ => 0.0,
            };
            Ok(PlaybackHistoryItem {
                id: id.to_string(),
                playback_session_id: id.to_string(),
                listening_session_id: session,
                track: tracks::parse(&raw)?,
                played_duration_ms: played,
                completion_rate,
                completed,
                skipped: reason == "skip",
                loop_count: loops,
                has_seek_backward: seek_back,
                context: context.map(|kind| PlaybackContext { kind, id: context_id }),
                listened_at: iso_from_ms(started_at),
            })
        })
        .collect::<Result<_, StoreError>>()?;
    Ok(PlaybackHistoryResponse { items, next_cursor })
}
