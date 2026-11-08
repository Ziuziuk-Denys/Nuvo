//! The ranker behind radio, continuation, suggestions and search: filters, scores and orders the
//! candidates the renderer fetched, 10 at a time, using the current session's feedback.

use std::collections::{HashMap, HashSet};

use nuvo_contracts::{RankReason, RankRequest, RankResponse, RankSignals, RankedItem};
use nuvo_store::{StoreError, new_id, tracks};
use rusqlite::{Connection, params};
use serde_json::Value;

use crate::features::{self, AUDIO_NEAR};
use crate::keys::{self, TrackKey};
use crate::model::{FEATURES, Model};
use crate::rewards::{self, Affinity, NEW_ARTIST_MAX_PLAYS, Outcome};
use crate::suppress::{FOREVER_W0, HIDDEN_AT, Suppressions};
use crate::mixes::{self, MOODS};
use crate::{pmi, pool, savepoint};

pub const DEFAULT_LIMIT: usize = 10;
pub const MAX_LIMIT: usize = 50;
pub const MAX_CANDIDATES: usize = 500;
const MAX_IDS: usize = 200;
const MAX_CONTEXT_CHARS: usize = 300;
const REFRESH_BATCHES: i64 = 3;
const WORK_SPACING: i64 = 50;
const ARTIST_WINDOW: usize = 10;
const ARTIST_CAP: usize = 2;
const MMR_LAMBDA: f64 = 0.7;
const EXPLORE_SHARE: f64 = 0.15;
const SEARCH_LEAD: usize = 3;
const RECENT_ANCHORS: usize = 10;
const POSITIVE_SEED_WEIGHT: f64 = 2.0;
const SUPPRESSION_STRENGTH: f64 = 1.5;
const PMI_NEIGHBOUR: f64 = 0.1;
pub(crate) const MAX_PMI_SUM: f64 = 3.0;
const REASON_FLOOR: f64 = 0.05;
const SESSION_LOOKBACK_MS: i64 = 86_400_000;
const SERVED_KEEP_MS: i64 = 30 * 86_400_000;
/// The stored lists of the last few finished tracks and of the seeds join a batch, at most `POOL_MERGE` tracks in all.
const POOL_FINISHED: usize = 3;
const POOL_ANCHORS: usize = 12;
const POOL_MERGE: usize = 50;

/// splitmix64: deterministic under a test seed, no dependency.
pub struct Rng(u64);

impl Rng {
    pub fn new(seed: u64) -> Self {
        Self(seed)
    }

    pub fn next_f64(&mut self) -> f64 {
        self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^= z >> 31;
        (z >> 11) as f64 / (1u64 << 53) as f64
    }

    /// Beta(a, b) for whole a, b >= 1: the a-th smallest of a + b - 1 uniform draws.
    pub fn beta(&mut self, a: u32, b: u32) -> f64 {
        let mut draws: Vec<f64> = (0..a + b - 1).map(|_| self.next_f64()).collect();
        draws.sort_by(f64::total_cmp);
        draws[a as usize - 1]
    }
}

struct Candidate {
    id: String,
    snapshot: Value,
    artist_name: String,
    key: TrackKey,
    x: [f64; FEATURES],
    score: f64,
    /// "Not interested" penalty, below `FOREVER_W0` (blocked tracks are dropped).
    penalty: f64,
    /// The anchor that makes it most similar, and whether that anchor is a track finished this session.
    best_anchor: Option<(String, bool)>,
    /// Shown in a recent batch, the same work as a recent play or hidden by a dislike: used only
    /// to avoid silence, hidden ones last.
    held_back: bool,
    /// Work group: tracks with same group are the same work.
    work_group: usize,
}

/// The current session's verdicts.
#[derive(Default)]
struct Session {
    finished: Vec<String>,
    negative: Vec<String>,
    played: HashSet<String>,
    signals: RankSignals,
}

fn push_unique(list: &mut Vec<String>, id: &str) {
    if !list.iter().any(|x| x == id) {
        list.push(id.to_string());
    }
}

fn session(conn: &Connection, session_id: Option<&str>, now: i64) -> Result<Session, StoreError> {
    let mut s = Session::default();
    let Some(session_id) = session_id else { return Ok(s) };
    let (mut skipped, mut scrubbed) = (Vec::new(), Vec::new());
    for rp in rewards::load(conn, now - SESSION_LOOKBACK_MS, Some(session_id))? {
        let id = rp.play.track_id.as_str();
        s.played.insert(id.to_string());
        match rp.outcome {
            Outcome::Finished => push_unique(&mut s.finished, id),
            Outcome::SkippedAtOnce => push_unique(&mut skipped, id),
            Outcome::ScrubSkipped => push_unique(&mut scrubbed, id),
            _ => {}
        }
    }
    s.signals = RankSignals { liked: s.finished.len(), skipped: skipped.len(), scrubbed: scrubbed.len() };
    s.negative = skipped.into_iter().chain(scrubbed).collect();
    Ok(s)
}

fn ids_query(conn: &Connection, sql: &str, args: impl rusqlite::Params) -> Result<Vec<String>, StoreError> {
    let mut stmt = conn.prepare(sql)?;
    let rows = stmt.query_map(args, |r| r.get(0))?;
    Ok(rows.collect::<Result<_, _>>()?)
}

fn titles(conn: &Connection, ids: &[String]) -> Result<HashMap<String, String>, StoreError> {
    let mut stmt = conn.prepare("SELECT id, title FROM tracks WHERE id IN (SELECT value FROM json_each(?1))")?;
    let rows = stmt.query_map([serde_json::to_string(ids)?], |r| Ok((r.get(0)?, r.get(1)?)))?;
    Ok(rows.collect::<Result<_, _>>()?)
}

fn validate(req: &RankRequest) -> Result<usize, StoreError> {
    let context_chars = req.context.chars().count();
    if context_chars == 0 || context_chars > MAX_CONTEXT_CHARS {
        return Err(StoreError::Invalid(format!("context must be 1-{MAX_CONTEXT_CHARS} characters")));
    }
    if req.candidates.len() > MAX_CANDIDATES {
        return Err(StoreError::Invalid(format!("at most {MAX_CANDIDATES} candidates")));
    }
    if req.seeds.len() > MAX_IDS || req.recent.len() > MAX_IDS {
        return Err(StoreError::Invalid(format!("at most {MAX_IDS} seeds and {MAX_IDS} recent ids")));
    }
    Ok(req.limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT))
}

/// Suppression scales a positive score down and pushes a negative one further down, within +-10.
pub(crate) fn suppressed(score: f64, penalty: f64) -> f64 {
    let factor = (-SUPPRESSION_STRENGTH * penalty).exp();
    let score = if score >= 0.0 { score * factor } else { score / factor };
    score.clamp(-10.0, 10.0)
}

fn similarity(a: &Candidate, b: &Candidate, vectors: &HashMap<String, Vec<f32>>) -> f64 {
    if a.work_group != 0 && a.work_group == b.work_group {
        return 1.0;
    }
    if a.key.same_artist(&b.key) {
        return 0.6;
    }
    features::similarity(vectors.get(&a.id), vectors.get(&b.id))
}

/// Ranks one batch. `seed` drives exploration; pass something that changes per call.
/// `mix:mood:<key>` seeds itself with the mood's best-loved tracks and holds back other moods.
/// One savepoint over the whole batch: all writes commit together, or none.
pub fn rank(conn: &Connection, req: &RankRequest, now: i64, seed: u64) -> Result<RankResponse, StoreError> {
    let limit = validate(req)?;
    let mood = req.context.strip_prefix("mix:mood:");
    if let Some(mood) = mood
        && !MOODS.iter().any(|(key, _)| *key == mood)
    {
        return Err(StoreError::Invalid(format!("unknown mood {mood}")));
    }
    savepoint(conn, "rank", || rank_with(conn, req, limit, mood, now, seed))
}

fn rank_with(conn: &Connection, req: &RankRequest, limit: usize, mood: Option<&str>, now: i64, seed: u64) -> Result<RankResponse, StoreError> {
    let mut rng = Rng::new(seed);
    let mut dropped = 0;

    // Store the snapshots; invalid ones and repeats are dropped, not fatal.
    let mut incoming: Vec<(String, Value, String)> = Vec::new();
    let mut incoming_ids = HashSet::new();
    for snapshot in &req.candidates {
        match tracks::upsert(conn, snapshot, now) {
            Ok(fields) if incoming_ids.insert(fields.id.clone()) => incoming.push((fields.id, snapshot.clone(), fields.artist)),
            _ => dropped += 1,
        }
    }
    keys::refresh(conn)?;
    let session = session(conn, req.session_id.as_deref(), now)?;
    // Breadth: the stored lists (YouTube radio, SoundCloud related) of this session's finished
    // tracks and of the seeds join the catalog's list, so one batch draws on several sources.
    let request_count = incoming.len();
    let mut pool_anchors: Vec<String> = Vec::new();
    for id in session.finished.iter().rev().take(POOL_FINISHED).chain(req.seeds.iter().rev()) {
        if pool_anchors.len() < POOL_ANCHORS && !session.negative.contains(id) && !pool_anchors.contains(id) {
            pool_anchors.push(id.clone());
        }
    }
    for (id, snapshot, artist) in pool::neighbours(conn, &pool_anchors, POOL_MERGE)? {
        if incoming_ids.insert(id.clone()) {
            incoming.push((id, snapshot, artist));
        }
    }
    let affinity: Affinity = rewards::affinity(conn, now)?;
    let moods = match mood {
        Some(_) => mixes::moods(conn)?,
        None => HashMap::new(),
    };
    let seed_list: Vec<String> = match mood {
        Some(mood) => mixes::mood_seeds(conn, &moods, mood, &affinity, now)?.into_iter().chain(req.seeds.iter().cloned()).collect(),
        None => req.seeds.clone(),
    };
    let seeds = seed_list.as_slice();
    let suppressions = Suppressions::load(conn, now)?;
    let model = Model::load(conn)?;
    let bucket = rewards::bucket_now(now, req.tz_offset_min.unwrap_or(0));

    // Anchors: seeds and recent plays at weight 1, tracks finished this session at weight 2.
    let mut anchors: HashMap<String, (f64, bool)> = HashMap::new();
    let recent_tail = &req.recent[req.recent.len().saturating_sub(RECENT_ANCHORS)..];
    for id in seeds.iter().chain(recent_tail) {
        anchors.insert(id.clone(), (1.0, false));
    }
    for id in &session.finished {
        anchors.insert(id.clone(), (POSITIVE_SEED_WEIGHT, true));
    }
    // A track skipped this session lifts nothing, even when it is a seed or a recent play.
    for id in &session.negative {
        anchors.remove(id);
    }
    // Sorted once, so evidence adds up in the same order for every candidate (determinism).
    let mut sorted_anchors: Vec<(&String, f64, bool)> = anchors.iter().map(|(id, (weight, positive))| (id, *weight, *positive)).collect();
    sorted_anchors.sort_by(|a, b| a.0.cmp(b.0));
    let anchor_ids: Vec<String> = anchors.keys().cloned().chain(session.negative.iter().cloned()).collect();
    let candidate_ids: Vec<String> = incoming.iter().map(|(id, ..)| id.clone()).collect();
    let pmi = pmi::compute(conn, &anchor_ids, &candidate_ids)?;
    let all_ids: Vec<String> = candidate_ids.iter().chain(&anchor_ids).chain(&req.recent).cloned().collect();
    let vectors = features::load(conn, &all_ids)?;

    // Same work once in 50: recent plays from the database, the request's recent ids and the seeds.
    let mut spaced_ids = ids_query(conn, "SELECT track_id FROM play_events ORDER BY started_at DESC, id DESC LIMIT ?1", [WORK_SPACING])?;
    spaced_ids.extend(req.recent.iter().cloned());
    spaced_ids.extend(seeds.iter().cloned());
    let key_ids: Vec<String> = all_ids.iter().chain(&spaced_ids).cloned().collect();
    let key_map = keys::load(conn, &key_ids)?;
    let spaced: Vec<&TrackKey> = spaced_ids.iter().filter_map(|id| key_map.get(id)).collect();
    let refreshed: HashSet<String> = ids_query(
        conn,
        "SELECT DISTINCT track_id FROM served WHERE batch_id IN
           (SELECT batch_id FROM served WHERE context = ?1 GROUP BY batch_id ORDER BY max(served_at) DESC, batch_id DESC LIMIT ?2)",
        params![req.context, REFRESH_BATCHES],
    )?
    .into_iter()
    .collect();
    let blocked: HashSet<&String> = seeds.iter().chain(&req.recent).chain(&session.played).collect();

    let total = incoming.len().max(1) as f64;
    let mut candidates: Vec<Candidate> = Vec::new();
    for (index, (id, snapshot, artist_name)) in incoming.into_iter().enumerate() {
        let Some(key) = key_map.get(&id).cloned() else {
            dropped += usize::from(index < request_count);
            continue;
        };
        // An exact suppression or a permanently blocked artist never shows.
        let penalty = match suppressions.penalty(&id, &key) {
            Some(penalty) if penalty < FOREVER_W0 && !blocked.contains(&id) => penalty,
            _ => {
                dropped += usize::from(index < request_count);
                continue;
            }
        };
        // Evidence adds up over anchors, so a finished track lifts its neighbours even when the
        // seed already relates to every candidate.
        let mut best_anchor = None;
        let (mut pmi_sum, mut best_pmi) = (0.0, 0.0);
        for (anchor, weight, positive) in &sorted_anchors {
            let value = weight * pmi.get(anchor, &id);
            pmi_sum += value;
            if value > best_pmi {
                best_pmi = value;
                best_anchor = Some(((*anchor).clone(), *positive));
            }
        }
        let audio = seeds
            .iter()
            .chain(&session.finished)
            .filter(|s| !session.negative.contains(s))
            .map(|s| features::similarity(vectors.get(s), vectors.get(&id)))
            .fold(0.0, f64::max);
        let plays = affinity.plays.get(&id).copied().unwrap_or(0);
        let x = [
            affinity.track(&id),
            affinity.artist(&key.artist),
            affinity.bucket(&key.artist, bucket),
            pmi_sum.min(MAX_PMI_SUM),
            audio,
            1.0 / (1.0 + f64::from(plays)),
            1.0 - index as f64 / total,
        ];
        // Session feedback: neighbours of tracks skipped this session go down, capped at -1.
        let mut feedback: f64 = 0.0;
        for negative in &session.negative {
            if key_map.get(negative).is_some_and(|k| k.same_artist(&key)) {
                feedback -= 0.6;
            }
            if pmi.get(negative, &id) > PMI_NEIGHBOUR {
                feedback -= 0.4;
            }
            if features::distance(vectors.get(negative), vectors.get(&id)).is_some_and(|d| d < AUDIO_NEAR) {
                feedback -= 0.4;
            }
        }
        let other_mood = mood.is_some_and(|wanted| moods.get(&id).is_some_and(|m| *m != wanted));
        let held_back = penalty >= HIDDEN_AT || other_mood || refreshed.contains(&id) || spaced.iter().any(|k| k.same_work(&key) >= 1.0);
        let score = suppressed(model.score(&x), penalty) + feedback.max(-1.0);
        let work_group = 0;
        candidates.push(Candidate { id, snapshot, artist_name, key, x, score, penalty, best_anchor, held_back, work_group });
    }

    // Assign work groups: group candidates by same work; compare each to group representatives.
    let mut group_keys: Vec<TrackKey> = Vec::new();
    for c in &mut candidates {
        let mut group = 0;
        for (i, gk) in group_keys.iter().enumerate() {
            if gk.same_work(&c.key) >= 1.0 {
                group = i + 1;
                break;
            }
        }
        if group == 0 {
            group = group_keys.len() + 1;
            group_keys.push(c.key.clone());
        }
        c.work_group = group;
    }

    let order = select(&candidates, limit, req, seeds, &key_map, &vectors, &affinity, &pmi, &mut rng);
    let names = titles(conn, &anchor_ids.iter().chain(seeds).cloned().collect::<Vec<_>>())?;
    let batch_id = new_id();
    let mut items = Vec::new();
    // Served rows: track id and the features the model learns from (none for fallback tracks).
    let mut served: Vec<(String, Option<String>)> = Vec::new();
    if order.is_empty() && !req.candidates.is_empty() {
        for (id, track) in fallback(conn, &blocked, &session.negative, limit)? {
            served.push((id, None));
            items.push(RankedItem { track, reason: RankReason { kind: "similar", name: None } });
        }
    }
    for (index, explored) in &order {
        let c = &candidates[*index];
        served.push((c.id.clone(), Some(serde_json::to_string(&c.x)?)));
        items.push(RankedItem { track: c.snapshot.clone(), reason: reason(c, *explored, &model, seeds, &names) });
    }
    for (id, features_json) in &served {
        conn.execute(
            "INSERT OR IGNORE INTO served (batch_id, track_id, context, session_id, features_json, served_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![batch_id, id, req.context, req.session_id, features_json, now],
        )?;
    }
    if let [only] = seeds {
        let own = &candidate_ids[..request_count];
        pool::record(conn, only, &own[..own.len().min(pool::MAX_POOL_ITEMS)], now)?;
    }
    conn.execute("DELETE FROM served WHERE served_at < ?1", [now - SERVED_KEEP_MS])?;

    Ok(RankResponse { batch_id, items, signals: session.signals, dropped })
}

/// When every candidate was dropped, tracks already heard (seeds, recent and session plays) rather
/// than silence: least recently played first, never one skipped this session, an exact
/// suppression or a permanently blocked artist.
fn fallback(conn: &Connection, heard: &HashSet<&String>, negative: &[String], limit: usize) -> Result<Vec<(String, Value)>, StoreError> {
    let ids: Vec<&String> = heard.iter().copied().filter(|id| !negative.contains(id)).collect();
    let mut stmt = conn.prepare(
        "SELECT t.id, t.snapshot_json FROM tracks t LEFT JOIN track_keys k ON k.track_id = t.id
         WHERE t.id IN (SELECT value FROM json_each(?1))
           AND NOT EXISTS(SELECT 1 FROM suppressions s WHERE s.scope = 'exact' AND s.key = t.id)
           AND NOT EXISTS(SELECT 1 FROM suppressions s WHERE s.scope = 'artist' AND s.half_life_days IS NULL
                          AND k.artist_key != '' AND s.key = k.artist_key)
         ORDER BY (SELECT max(e.started_at) FROM play_events e WHERE e.track_id = t.id), t.id
         LIMIT ?2",
    )?;
    let rows = stmt
        .query_map(params![serde_json::to_string(&ids)?, limit as i64], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?
        .collect::<Result<Vec<_>, _>>()?;
    rows.into_iter().map(|(id, raw)| Ok((id, serde_json::from_str(&raw)?))).collect()
}

/// Batch order as (candidate index, picked by exploration). Greedy MMR under the artist cap and
/// work spacing; search leads with the seed's neighbours; 15 % of slots explore new artists.
#[allow(clippy::too_many_arguments)]
fn select(
    candidates: &[Candidate],
    limit: usize,
    req: &RankRequest,
    seeds: &[String],
    key_map: &HashMap<String, TrackKey>,
    vectors: &HashMap<String, Vec<f32>>,
    affinity: &Affinity,
    pmi: &pmi::Pmi,
    rng: &mut Rng,
) -> Vec<(usize, bool)> {
    let (min, max) = candidates.iter().fold((f64::MAX, f64::MIN), |(lo, hi), c| (lo.min(c.score), hi.max(c.score)));
    let relevance = |c: &Candidate| if max > min { (c.score - min) / (max - min) } else { 1.0 };
    let is_search = req.context.starts_with("search:");

    // Exploration: 1-2 of every 10 slots, spread through the batch, never in the search lead.
    let share = limit as f64 * EXPLORE_SHARE;
    let slots = share.floor() as usize + usize::from(rng.next_f64() < share.fract());
    let explore_at: Vec<usize> = (1..=slots).map(|k| k * limit / (slots + 1)).filter(|p| !is_search || *p >= SEARCH_LEAD).collect();
    let mut explorers: Vec<(f64, usize)> = Vec::new();
    let mut explored_artists = HashSet::new();
    for (i, c) in candidates.iter().enumerate() {
        // A new artist: known by name, never disliked, rarely played.
        if c.held_back
            || c.penalty > 0.0
            || c.score < -0.5
            || c.key.artist.is_empty()
            || affinity.artist_play_count(&c.key.artist) >= NEW_ARTIST_MAX_PLAYS
            || !explored_artists.insert(c.key.artist.clone())
        {
            continue;
        }
        let (finished, skipped) = affinity.artist_outcomes.get(&c.key.artist).copied().unwrap_or((0, 0));
        explorers.push((rng.beta(finished + 1, skipped + 1), i));
    }
    explorers.sort_by(|a, b| b.0.total_cmp(&a.0));

    // Search: the first picks come from the seed's PMI and audio neighbourhood, then catalog order.
    let seed_key = seeds.first().and_then(|s| key_map.get(s));
    let mut lead: Vec<usize> = Vec::new();
    if is_search && let Some(seed) = seeds.first() {
        let mut near: Vec<usize> = (0..candidates.len())
            .filter(|&i| {
                let c = &candidates[i];
                pmi.get(seed, &c.id) > 0.0 || features::distance(vectors.get(seed), vectors.get(&c.id)).is_some_and(|d| d < AUDIO_NEAR)
            })
            .collect();
        near.sort_by(|&a, &b| candidates[b].score.total_cmp(&candidates[a].score));
        lead = near.into_iter().chain(0..candidates.len()).collect();
    }

    let recent_artists: Vec<String> = req.recent.iter().filter_map(|id| key_map.get(id)).map(|k| k.artist.clone()).collect();
    let mut chosen: Vec<(usize, bool)> = Vec::new();
    let mut used = vec![false; candidates.len()];
    let allowed = |i: usize, chosen: &[(usize, bool)], cap: bool| {
        let c = &candidates[i];
        if c.work_group != 0 && chosen.iter().any(|(j, _)| candidates[*j].work_group == c.work_group) {
            return false;
        }
        if !cap || c.key.artist.is_empty() {
            return true;
        }
        let artists: Vec<&String> = recent_artists.iter().chain(chosen.iter().map(|(j, _)| &candidates[*j].key.artist)).collect();
        let window = &artists[artists.len().saturating_sub(ARTIST_WINDOW - 1)..];
        window.iter().filter(|a| ***a == c.key.artist).count() < ARTIST_CAP
    };
    while chosen.len() < limit {
        let position = chosen.len();
        let mut pick: Option<(usize, bool)> = None;
        if is_search && position < SEARCH_LEAD {
            let seed_artist_used = chosen.iter().any(|(j, _)| seed_key.is_some_and(|k| k.same_artist(&candidates[*j].key)));
            pick = lead
                .iter()
                .copied()
                .find(|&i| {
                    let same_artist = seed_key.is_some_and(|k| k.same_artist(&candidates[i].key));
                    !used[i] && !candidates[i].held_back && !(same_artist && seed_artist_used) && allowed(i, &chosen, true)
                })
                .map(|i| (i, false));
        }
        if pick.is_none() && explore_at.contains(&position) {
            pick = explorers.iter().map(|(_, i)| *i).find(|&i| !used[i] && allowed(i, &chosen, true)).map(|i| (i, true));
        }
        if pick.is_none() {
            // Fresh candidates under the cap first; then held-back repeats; then without the cap;
            // works hidden by a dislike only when nothing else is left.
            let level = |c: &Candidate| if c.penalty >= HIDDEN_AT { 2 } else { u8::from(c.held_back) };
            for (max_level, cap) in [(0, true), (1, true), (1, false), (2, false)] {
                let best = (0..candidates.len())
                    .filter(|&i| !used[i] && level(&candidates[i]) <= max_level && allowed(i, &chosen, cap))
                    .map(|i| {
                        let c = &candidates[i];
                        let redundancy = chosen.iter().map(|(j, _)| similarity(c, &candidates[*j], vectors)).fold(0.0, f64::max);
                        (MMR_LAMBDA * relevance(c) - (1.0 - MMR_LAMBDA) * redundancy, i)
                    })
                    .max_by(|a, b| a.0.total_cmp(&b.0));
                if let Some((_, i)) = best {
                    pick = Some((i, false));
                    break;
                }
            }
        }
        let Some((i, explored)) = pick else { break };
        used[i] = true;
        chosen.push((i, explored));
    }
    chosen
}

fn reason(c: &Candidate, explored: bool, model: &Model, seeds: &[String], names: &HashMap<String, String>) -> RankReason {
    if explored {
        return RankReason { kind: "new", name: None };
    }
    let w = &model.weights;
    let artist = w[1] * c.x[1];
    let time = w[2] * c.x[2];
    let similar = w[3] * c.x[3];
    if let Some((anchor, true)) = &c.best_anchor
        && similar > REASON_FLOOR
        && similar >= artist
    {
        return RankReason { kind: "session", name: names.get(anchor).cloned() };
    }
    if similar > REASON_FLOOR && similar >= artist && similar >= time {
        let anchor = c.best_anchor.as_ref().map(|(a, _)| a);
        return RankReason { kind: "similar", name: anchor.and_then(|a| names.get(a)).cloned() };
    }
    if artist > REASON_FLOOR && artist >= time {
        return RankReason { kind: "artist", name: Some(c.artist_name.clone()) };
    }
    if time > REASON_FLOOR {
        return RankReason { kind: "time", name: None };
    }
    // No strong signal: the catalog put it next to the seed.
    RankReason { kind: "similar", name: seeds.first().and_then(|s| names.get(s)).cloned() }
}
