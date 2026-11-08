//! "Not interested": decaying suppressions by exact track, work or artist. Likes are the
//! exceptions: a liked track and every upload of the same variant survive work and decaying
//! artist suppressions. A permanent artist block wins over likes.

use std::collections::{HashMap, HashSet};

use nuvo_contracts::{NotInterestedResult, RecordPlaybackEvent, SuppressionItem, iso_from_ms};
use nuvo_store::{StoreError, tracks};
use rusqlite::{Connection, params};

use crate::keys::{self, TrackKey};
use crate::rewards;

const DAY_MS: f64 = 86_400_000.0;
/// A permanent artist block: tracks at this penalty are never shown.
pub const FOREVER_W0: f64 = 10.0;
/// Tracks whose suppression reached this (one "any version" dislike) are hidden from mixes and
/// held back by the ranker.
pub const HIDDEN_AT: f64 = 1.0;
/// Every user dislike of a track also counts against its artist at the artist-scope rate.
const DISLIKE_ARTIST: (f64, f64) = (0.3, 30.0);
const SCRUB_SKIP: Rule = ("work", 0.3, Some(30.0));
pub const OFFER_HIDE_ARTIST_AT: f64 = 1.0;
/// Below this an entry no longer matters and is dropped from the blocklist.
const FADED_BELOW: f64 = 0.05;
/// Contexts where a full play is the user's own choice.
const USER_CONTEXTS: [&str; 2] = ["library", "playlist"];

pub fn decayed(w0: f64, half_life_days: Option<f64>, age_ms: i64) -> f64 {
    match half_life_days {
        Some(days) => w0 * 2f64.powf(-(age_ms.max(0) as f64 / DAY_MS) / days),
        None => w0,
    }
}

/// Request scope -> (stored scope, w0, half-life in days; `None` never fades).
fn rule(scope: &str) -> Result<Rule, StoreError> {
    match scope {
        "exact" => Ok(("exact", 1.0, None)),
        "work" => Ok(("work", 1.0, Some(180.0))),
        "artist" => Ok(("artist", 0.3, Some(30.0))),
        "artist_forever" => Ok(("artist", FOREVER_W0, None)),
        _ => Err(StoreError::Invalid("scope must be exact, work, artist or artist_forever".into())),
    }
}

#[derive(Debug, Clone)]
struct Row {
    id: i64,
    scope: String,
    key: String,
    w0: f64,
    half_life: Option<f64>,
    track_id: Option<String>,
    origin: String,
    created_at: i64,
}

impl Row {
    fn weight(&self, now: i64) -> f64 {
        decayed(self.w0, self.half_life, now - self.created_at)
    }

    fn api_scope(&self) -> &'static str {
        match (self.scope.as_str(), self.half_life) {
            ("exact", _) => "exact",
            ("work", _) => "work",
            ("artist", None) => "artist_forever",
            _ => "artist",
        }
    }
}

fn rows(conn: &Connection) -> Result<Vec<Row>, StoreError> {
    let mut stmt = conn.prepare("SELECT id, scope, key, w0, half_life_days, track_id, origin, created_at FROM suppressions ORDER BY id")?;
    let rows = stmt.query_map([], |r| {
        Ok(Row {
            id: r.get(0)?,
            scope: r.get(1)?,
            key: r.get(2)?,
            w0: r.get(3)?,
            half_life: r.get(4)?,
            track_id: r.get(5)?,
            origin: r.get(6)?,
            created_at: r.get(7)?,
        })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

/// Everything needed to judge candidates, loaded once per request.
pub struct Suppressions {
    now: i64,
    rows: Vec<Row>,
    row_keys: HashMap<String, TrackKey>,
    liked: HashSet<String>,
    liked_variants: HashSet<String>,
}

impl Suppressions {
    /// Call `keys::refresh` first.
    pub fn load(conn: &Connection, now: i64) -> Result<Self, StoreError> {
        let rows = rows(conn)?;
        let mut stmt = conn.prepare("SELECT track_id FROM liked_tracks")?;
        let liked: HashSet<String> = stmt.query_map([], |r| r.get(0))?.collect::<Result<_, _>>()?;
        let mut ids: Vec<String> = rows.iter().filter_map(|r| r.track_id.clone()).collect();
        ids.extend(liked.iter().cloned());
        let all_keys = keys::load(conn, &ids)?;
        let liked_variants = liked.iter().filter_map(|id| all_keys.get(id)).map(TrackKey::variant_key).collect();
        Ok(Self { now, rows, row_keys: all_keys, liked, liked_variants })
    }

    /// Decaying artist penalty: explicit artist entries plus every user dislike of their tracks.
    pub fn artist_decaying(&self, artist: &str) -> f64 {
        // An empty artist key is no artist; it never collects penalties from other tracks.
        if artist.is_empty() {
            return 0.0;
        }
        self.rows
            .iter()
            .map(|row| match (row.scope.as_str(), row.half_life) {
                ("artist", Some(_)) if row.key == artist => row.weight(self.now),
                ("exact" | "work", _) if row.origin == "user" && self.track_artist(row) == Some(artist) => {
                    decayed(DISLIKE_ARTIST.0, Some(DISLIKE_ARTIST.1), self.now - row.created_at)
                }
                _ => 0.0,
            })
            .sum()
    }

    fn track_artist(&self, row: &Row) -> Option<&str> {
        row.track_id.as_ref().and_then(|id| self.row_keys.get(id)).map(|k| k.artist.as_str())
    }

    fn forever(&self, artist: &str) -> f64 {
        if artist.is_empty() {
            return 0.0;
        }
        self.rows.iter().filter(|r| r.scope == "artist" && r.half_life.is_none() && r.key == artist).map(|r| r.w0).sum()
    }

    /// `None`: never show this track (exact suppression). Otherwise the penalty to apply.
    pub fn penalty(&self, track_id: &str, key: &TrackKey) -> Option<f64> {
        if self.rows.iter().any(|r| r.scope == "exact" && r.key == track_id) {
            return None;
        }
        let forever = self.forever(&key.artist);
        if self.liked.contains(track_id) || self.liked_variants.contains(&key.variant_key()) {
            return Some(forever);
        }
        let work: f64 = self
            .rows
            .iter()
            .filter(|r| r.scope == "work")
            .map(|r| {
                let suppressed = match r.track_id.as_ref().and_then(|id| self.row_keys.get(id)) {
                    Some(row_key) => row_key.same_work(key),
                    None if r.key == key.work => 1.0,
                    None => 0.0,
                };
                suppressed * r.weight(self.now)
            })
            .sum();
        Some(work + self.artist_decaying(&key.artist) + forever)
    }
}

type Rule = (&'static str, f64, Option<f64>);

fn insert(conn: &Connection, (scope, w0, half_life): Rule, key: &str, track_id: &str, origin: &str, created_at: i64) -> Result<i64, StoreError> {
    conn.execute(
        "INSERT INTO suppressions (scope, key, w0, half_life_days, track_id, origin, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![scope, key, w0, half_life, track_id, origin, created_at],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn not_interested(conn: &Connection, track_id: &str, scope: &str, now: i64) -> Result<NotInterestedResult, StoreError> {
    let rule = rule(scope)?;
    keys::refresh(conn)?;
    let key = keys::load(conn, &[track_id.to_string()])?.remove(track_id).ok_or(StoreError::NotFound("track"))?;
    let target = match rule.0 {
        "exact" => track_id.to_string(),
        "work" => key.work.clone(),
        _ if key.artist.is_empty() => return Err(StoreError::Invalid("the track has no artist".into())),
        _ => key.artist.clone(),
    };
    let suppression_id = insert(conn, rule, &target, track_id, "user", now)?;
    let all = Suppressions::load(conn, now)?;
    let offer_hide_artist = all.forever(&key.artist) == 0.0 && all.artist_decaying(&key.artist) >= OFFER_HIDE_ARTIST_AT;
    Ok(NotInterestedResult { suppression_id, offer_hide_artist })
}

pub fn delete(conn: &Connection, id: i64) -> Result<(), StoreError> {
    match conn.execute("DELETE FROM suppressions WHERE id = ?1", [id])? {
        0 => Err(StoreError::NotFound("suppression")),
        _ => Ok(()),
    }
}

/// The blocklist, newest first. Entries that faded are deleted on the way.
pub fn list(conn: &Connection, now: i64) -> Result<Vec<SuppressionItem>, StoreError> {
    let mut items = Vec::new();
    for row in rows(conn)?.into_iter().rev() {
        let penalty = row.weight(now);
        if row.half_life.is_some() && penalty < FADED_BELOW {
            conn.execute("DELETE FROM suppressions WHERE id = ?1", [row.id])?;
            continue;
        }
        let fades_at = row.half_life.map(|days| row.created_at + (days * DAY_MS * (row.w0 / FADED_BELOW).log2()) as i64);
        let track = match &row.track_id {
            Some(id) => tracks::snapshot(conn, id)?,
            None => None,
        };
        items.push(SuppressionItem {
            id: row.id,
            scope: row.api_scope().into(),
            origin: row.origin.clone(),
            track,
            penalty,
            fades_at: fades_at.map(iso_from_ms),
            created_at: iso_from_ms(row.created_at),
        });
    }
    Ok(items)
}

/// After a play is recorded: a scrub-then-skip adds a weak work suppression, and a full play the
/// user chose (library or playlist) halves the work suppressions on that song.
pub fn after_play(conn: &Connection, event: &RecordPlaybackEvent, now: i64) -> Result<(), StoreError> {
    let reason = rewards::end_reason(event);
    let scrub_skipped = event.seek_forward_ms > 0 && (reason == "skip" || reason == "next");
    let chosen_full_play = reason == "complete"
        && event.seek_forward_ms == 0
        && event.context.as_ref().is_some_and(|c| USER_CONTEXTS.contains(&c.kind.as_str()));
    if !scrub_skipped && !chosen_full_play {
        return Ok(());
    }
    keys::refresh(conn)?;
    let Some(key) = keys::load(conn, std::slice::from_ref(&event.track_id))?.remove(&event.track_id) else {
        return Ok(());
    };
    if scrub_skipped {
        // created_at is the play's start, so a re-sent event does not add a second entry.
        let at = event.started_at.unwrap_or(now);
        let exists: bool = conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM suppressions WHERE origin = 'scrub_skip' AND key = ?1 AND created_at = ?2)",
            params![key.work, at],
            |r| r.get(0),
        )?;
        if !exists {
            insert(conn, SCRUB_SKIP, &key.work, &event.track_id, "scrub_skip", at)?;
        }
    } else {
        conn.execute("UPDATE suppressions SET w0 = w0 / 2 WHERE scope = 'work' AND key = ?1", [&key.work])?;
    }
    Ok(())
}
