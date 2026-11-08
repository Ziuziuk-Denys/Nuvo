//! What a play says about taste (the reward table) and the decayed, smoothed affinities
//! built from all plays, likes and playlist adds.

use std::collections::HashMap;

use nuvo_contracts::{MAX_TRACK_ID_LEN, RecordPlaybackEvent, local_hour_weekday};
use nuvo_store::StoreError;
use rusqlite::{Connection, params};

const DAY_MS: f64 = 86_400_000.0;
const DECAY_DAYS: f64 = 75.0;
const PRIOR_COUNT: f64 = 3.0;
/// Plays older than this weigh under 1 % (exp(-365 / 75)) and are not read.
pub const HISTORY_DAYS: i64 = 365;
pub const SKIP_AT_ONCE_MS: i64 = 15_000;
/// A session needs this many plays before its skip rate can mark it as browsing.
const BROWSING_MIN_PLAYS: i64 = 5;
const BROWSING_SKIP_RATE: f64 = 0.6;
pub const AUTOPLAY_CONTEXTS: [&str; 4] = ["radio", "mix", "search", "continue"];
/// An artist with fewer plays than this still counts as new for exploration.
pub const NEW_ARTIST_MAX_PLAYS: u32 = 3;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Outcome {
    Finished,
    Skimmed,
    SkippedAtOnce,
    ScrubSkipped,
    SkippedLater,
    Neutral,
}

#[derive(Debug, Clone)]
pub struct Play {
    pub track_id: String,
    pub artist_key: String,
    pub session_id: String,
    pub started_at: i64,
    pub played_ms: i64,
    pub duration_ms: Option<i64>,
    pub end_reason: String,
    pub context: Option<String>,
    pub seek_forward_ms: i64,
    pub hour: i64,
    pub weekday: i64,
}

#[derive(Debug, Clone)]
pub struct RewardedPlay {
    pub play: Play,
    pub outcome: Outcome,
    pub reward: f64,
}

/// The stored end reason, derived the way `events::record` does for clients that omit it.
pub fn end_reason(event: &RecordPlaybackEvent) -> &str {
    match event.end_reason.as_deref() {
        Some(reason) => reason,
        None if event.completed => "complete",
        None if event.skipped => "skip",
        None => "stop",
    }
}

pub fn outcome(play: &Play) -> Outcome {
    let complete = play.end_reason == "complete";
    let skipped = play.end_reason == "skip" || play.end_reason == "next";
    if complete {
        return if play.seek_forward_ms > 0 { Outcome::Skimmed } else { Outcome::Finished };
    }
    if !skipped {
        return Outcome::Neutral;
    }
    if play.seek_forward_ms > 0 {
        return Outcome::ScrubSkipped;
    }
    if play.played_ms < SKIP_AT_ONCE_MS {
        return Outcome::SkippedAtOnce;
    }
    match play.duration_ms {
        Some(duration) if duration > 0 && play.played_ms.saturating_mul(2) >= duration => Outcome::Neutral,
        _ => Outcome::SkippedLater,
    }
}

/// `skip_weight` is the context weight (1.5 autoplay, 0.5 own playlist, else 1) times 0.5 in a
/// browsing session. It scales penalties only.
pub fn reward(outcome: Outcome, replay: bool, skip_weight: f64) -> f64 {
    match outcome {
        Outcome::Finished if replay => 1.5,
        Outcome::Finished => 1.0,
        Outcome::Skimmed => 0.3,
        Outcome::SkippedAtOnce => -skip_weight,
        Outcome::ScrubSkipped => -1.5 * skip_weight,
        Outcome::SkippedLater => -0.3 * skip_weight,
        Outcome::Neutral => 0.0,
    }
}

fn skip_weight(context: Option<&str>, own_playlist: bool, session_plays: i64, session_skips: i64) -> f64 {
    let context_weight = match context {
        Some(kind) if AUTOPLAY_CONTEXTS.contains(&kind) => 1.5,
        Some("playlist") if own_playlist => 0.5,
        _ => 1.0,
    };
    let browsing = session_plays >= BROWSING_MIN_PLAYS && session_skips as f64 > BROWSING_SKIP_RATE * session_plays as f64;
    if browsing { context_weight * 0.5 } else { context_weight }
}

/// Plays since `since` with their rewards, oldest first. Plays of tracks or from playlists
/// excluded from taste are left out. Call `keys::refresh` first so artist keys are known.
pub fn load(conn: &Connection, since: i64, session: Option<&str>) -> Result<Vec<RewardedPlay>, StoreError> {
    let mut stmt = conn.prepare(
        "WITH s AS (SELECT session_id, count(*) AS n, sum(end_reason IN ('skip', 'next')) AS skips
                    FROM play_events WHERE started_at >= ?1 GROUP BY session_id)
         SELECT e.track_id, coalesce(k.artist_key, ''), e.session_id, e.started_at, e.played_ms, e.duration_ms, e.end_reason,
                e.context, e.seek_forward_ms, e.hour, e.weekday, s.n, s.skips,
                EXISTS(SELECT 1 FROM play_events p WHERE p.session_id = e.session_id AND p.track_id = e.track_id
                       AND p.started_at < e.started_at AND p.end_reason = 'complete'),
                e.context = 'playlist' AND EXISTS(SELECT 1 FROM playlists pl WHERE pl.id = e.context_id)
         FROM play_events e JOIN s ON s.session_id = e.session_id LEFT JOIN track_keys k ON k.track_id = e.track_id
         WHERE e.started_at >= ?1 AND (?2 IS NULL OR e.session_id = ?2)
           AND NOT EXISTS(SELECT 1 FROM taste_excluded x WHERE x.kind = 'track' AND x.id = e.track_id)
           AND NOT (e.context = 'playlist' AND EXISTS(SELECT 1 FROM taste_excluded x WHERE x.kind = 'playlist' AND x.id = e.context_id))
         ORDER BY e.started_at, e.id",
    )?;
    let rows = stmt.query_map(params![since, session], |r| {
        let play = Play {
            track_id: r.get(0)?,
            artist_key: r.get(1)?,
            session_id: r.get(2)?,
            started_at: r.get(3)?,
            played_ms: r.get(4)?,
            duration_ms: r.get(5)?,
            end_reason: r.get(6)?,
            context: r.get(7)?,
            seek_forward_ms: r.get(8)?,
            hour: r.get(9)?,
            weekday: r.get(10)?,
        };
        let weight = skip_weight(play.context.as_deref(), r.get(14)?, r.get(11)?, r.get(12)?);
        let outcome = outcome(&play);
        let replay: bool = r.get(13)?;
        Ok(RewardedPlay { reward: reward(outcome, replay, weight), outcome, play })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

/// 0-3 for each 6-hour slice of the day, plus 4 on weekends.
pub fn time_bucket(hour: i64, weekday: i64) -> u8 {
    let weekend = weekday == 0 || weekday == 6;
    (hour.clamp(0, 23) / 6) as u8 + if weekend { 4 } else { 0 }
}

pub fn bucket_now(now: i64, tz_offset_min: i64) -> u8 {
    let (hour, weekday) = local_hour_weekday(now, tz_offset_min);
    time_bucket(hour, weekday)
}

#[derive(Default)]
struct Acc {
    weighted: f64,
    weight: f64,
}

impl Acc {
    fn add(&mut self, reward: f64, weight: f64) {
        self.weighted += reward * weight;
        self.weight += weight;
    }

    /// Bayesian average toward 0 with a prior of 3 plays.
    fn smoothed(&self) -> f64 {
        self.weighted / (self.weight + PRIOR_COUNT)
    }
}

#[derive(Debug, Default)]
pub struct Affinity {
    pub track: HashMap<String, f64>,
    pub artist: HashMap<String, f64>,
    pub bucket: HashMap<(String, u8), f64>,
    /// Plays per track, any outcome.
    pub plays: HashMap<String, u32>,
    /// Per artist: (finished, skipped at once or scrubbed), for Thompson sampling.
    pub artist_outcomes: HashMap<String, (u32, u32)>,
}

impl Affinity {
    pub fn track(&self, id: &str) -> f64 {
        self.track.get(id).copied().unwrap_or(0.0)
    }

    pub fn artist(&self, key: &str) -> f64 {
        self.artist.get(key).copied().unwrap_or(0.0)
    }

    pub fn bucket(&self, key: &str, bucket: u8) -> f64 {
        self.bucket.get(&(key.to_string(), bucket)).copied().unwrap_or(0.0)
    }

    pub fn artist_play_count(&self, key: &str) -> u32 {
        self.artist_outcomes.get(key).map_or(0, |(s, f)| s + f)
    }
}

/// Explicit signals outside play events: likes (+3) and playlist adds (+2), by artist key.
fn explicit(conn: &Connection, since: i64) -> Result<Vec<(String, String, i64, f64)>, StoreError> {
    let mut stmt = conn.prepare(
        "SELECT l.track_id, coalesce(k.artist_key, ''), l.liked_at, 3.0 FROM liked_tracks l
         LEFT JOIN track_keys k ON k.track_id = l.track_id
         WHERE l.liked_at >= ?1 AND NOT EXISTS(SELECT 1 FROM taste_excluded x WHERE x.kind = 'track' AND x.id = l.track_id)
         UNION ALL
         SELECT i.track_id, coalesce(k.artist_key, ''), i.added_at, 2.0 FROM playlist_items i
         LEFT JOIN track_keys k ON k.track_id = i.track_id
         WHERE i.added_at >= ?1 AND NOT EXISTS(SELECT 1 FROM taste_excluded x WHERE x.kind = 'track' AND x.id = i.track_id)
           AND NOT EXISTS(SELECT 1 FROM taste_excluded x WHERE x.kind = 'playlist' AND x.id = i.playlist_id)",
    )?;
    let rows = stmt.query_map([since], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?;
    Ok(rows.collect::<Result<_, _>>()?)
}

pub fn affinity(conn: &Connection, now: i64) -> Result<Affinity, StoreError> {
    let since = now - HISTORY_DAYS * 86_400_000;
    let plays = load(conn, since, None)?;
    let decay = |at: i64| (-((now - at).max(0) as f64 / DAY_MS) / DECAY_DAYS).exp();
    let mut track: HashMap<String, Acc> = HashMap::new();
    let mut artist: HashMap<String, Acc> = HashMap::new();
    let mut bucket: HashMap<(String, u8), Acc> = HashMap::new();
    let mut result = Affinity::default();
    for rp in &plays {
        let p = &rp.play;
        let w = decay(p.started_at);
        *result.plays.entry(p.track_id.clone()).or_default() += 1;
        if rp.outcome == Outcome::Neutral {
            continue;
        }
        track.entry(p.track_id.clone()).or_default().add(rp.reward, w);
        // An empty artist key is no artist: nothing to pool across tracks.
        if p.artist_key.is_empty() {
            continue;
        }
        artist.entry(p.artist_key.clone()).or_default().add(rp.reward, w);
        bucket.entry((p.artist_key.clone(), time_bucket(p.hour, p.weekday))).or_default().add(rp.reward, w);
        let counts = result.artist_outcomes.entry(p.artist_key.clone()).or_default();
        match rp.outcome {
            Outcome::Finished => counts.0 += 1,
            Outcome::SkippedAtOnce | Outcome::ScrubSkipped => counts.1 += 1,
            _ => {}
        }
    }
    for (track_id, artist_key, at, reward) in explicit(conn, since)? {
        let w = decay(at);
        track.entry(track_id).or_default().add(reward, w);
        if !artist_key.is_empty() {
            artist.entry(artist_key).or_default().add(reward, w);
        }
    }
    result.track = track.into_iter().map(|(k, a)| (k, a.smoothed())).collect();
    result.artist = artist.into_iter().map(|(k, a)| (k, a.smoothed())).collect();
    result.bucket = bucket.into_iter().map(|(k, a)| (k, a.smoothed())).collect();
    Ok(result)
}

/// Exclude a playlist or a track from taste ("Exclude from taste").
pub fn set_excluded(conn: &Connection, kind: &str, id: &str, excluded: bool) -> Result<(), StoreError> {
    if kind != "playlist" && kind != "track" {
        return Err(StoreError::Invalid("kind must be playlist or track".into()));
    }
    if id.is_empty() || id.len() > MAX_TRACK_ID_LEN {
        return Err(StoreError::Invalid(format!("id must be 1-{MAX_TRACK_ID_LEN} characters")));
    }
    if excluded {
        conn.execute("INSERT OR IGNORE INTO taste_excluded (kind, id) VALUES (?1, ?2)", params![kind, id])?;
    } else {
        conn.execute("DELETE FROM taste_excluded WHERE kind = ?1 AND id = ?2", params![kind, id])?;
    }
    Ok(())
}

pub fn excluded(conn: &Connection) -> Result<Vec<(String, String)>, StoreError> {
    let mut stmt = conn.prepare("SELECT kind, id FROM taste_excluded ORDER BY kind, id")?;
    let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?;
    Ok(rows.collect::<Result<_, _>>()?)
}
