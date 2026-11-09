// Ids keep the `daily-mix-` prefix the renderer's collection route recognises

use std::collections::{HashMap, HashSet};

use nuvo_contracts::{DailyMixItem, DailyMixesResponse, iso_from_ms};
use nuvo_store::StoreError;
use rusqlite::{Connection, params};
use serde_json::Value;

use crate::{features, pmi, savepoint, starters};
use crate::keys;
use crate::model::Model;
use crate::pool::MAX_POOL_ITEMS;
use crate::rank::{MAX_CANDIDATES, MAX_PMI_SUM, suppressed};
use crate::rewards::{self, Affinity};
use crate::suppress::{HIDDEN_AT, Suppressions};

pub const MIX_SIZE: usize = 25;
const MIN_MIX_TRACKS: usize = 3;
const ARTIST_MIXES: usize = 3;
const FOR_YOU_PER_ARTIST: usize = 3;
const LIBRARY_WINDOW_MS: i64 = 90 * DAY_MS;
const DAY_MS: i64 = 86_400_000;
const HOME_REPEAT_PENALTY: f64 = 0.5;
const DISCOVER_SEEDS: usize = 12;
const DISCOVER_PER_ARTIST: usize = 2;

pub const MOODS: [(&str, &str); 4] = [("energy", "Energy"), ("calm", "Calm"), ("bright", "Bright"), ("late-night", "Late night")];
pub const MOOD_MIN_TRACKS: usize = 200;
/// Vector layout the mood axes read; a future analyser with another layout writes another version.
pub const MOOD_LAYOUT_VERSION: i64 = 1;
// Indices in the bliss-audio `AnalysisIndex` order: Tempo, MeanSpectralCentroid, MeanLoudness.
const TEMPO: usize = 0;
const BRIGHTNESS: usize = 2;
const LOUDNESS: usize = 8;

fn median(values: &mut [f64]) -> f64 {
    values.sort_by(f64::total_cmp);
    values[values.len() / 2]
}

pub fn moods(conn: &Connection) -> Result<HashMap<String, &'static str>, StoreError> {
    let ids: Vec<String> = {
        let mut stmt = conn.prepare("SELECT track_id FROM track_features WHERE version = ?1")?;
        stmt.query_map([MOOD_LAYOUT_VERSION], |r| r.get(0))?.collect::<Result<_, _>>()?
    };
    let axes: Vec<(String, f64, f64)> = features::load(conn, &ids)?
        .into_iter()
        .filter(|(_, v)| v.len() > LOUDNESS)
        .map(|(id, v)| (id, f64::from(v[TEMPO] + v[LOUDNESS]) / 2.0, f64::from(v[BRIGHTNESS])))
        .collect();
    if axes.len() < MOOD_MIN_TRACKS {
        return Ok(HashMap::new());
    }
    let energy_mid = median(&mut axes.iter().map(|a| a.1).collect::<Vec<_>>());
    let bright_mid = median(&mut axes.iter().map(|a| a.2).collect::<Vec<_>>());
    Ok(axes
        .into_iter()
        .map(|(id, energy, bright)| {
            let mood = match (energy >= energy_mid, bright >= bright_mid) {
                (true, false) => "energy",
                (true, true) => "bright",
                (false, true) => "calm",
                (false, false) => "late-night",
            };
            (id, mood)
        })
        .collect())
}

struct Scored {
    id: String,
    snapshot: Value,
    artist_key: String,
    artist_name: String,
    taste: f64,
    score: f64,
}

fn library(conn: &Connection, now: i64, affinity: &Affinity, repeat_from_home: &HashSet<String>) -> Result<Vec<Scored>, StoreError> {
    let suppressions = Suppressions::load(conn, now)?;
    let mut stmt = conn.prepare(
        "SELECT t.id, t.snapshot_json, t.artist FROM tracks t
         WHERE (t.id IN (SELECT track_id FROM liked_tracks)
                OR t.id IN (SELECT track_id FROM play_events WHERE started_at >= ?1 AND (end_reason = 'complete' OR played_ms >= 30000)))
           AND NOT EXISTS(SELECT 1 FROM taste_excluded x WHERE x.kind = 'track' AND x.id = t.id)",
    )?;
    let rows = stmt
        .query_map([now - LIBRARY_WINDOW_MS], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?)))?
        .collect::<Result<Vec<_>, _>>()?;
    let ids: Vec<String> = rows.iter().map(|r| r.0.clone()).collect();
    let key_map = keys::load(conn, &ids)?;
    let mut scored = Vec::new();
    for (id, raw, artist_name) in rows {
        let Some(key) = key_map.get(&id) else { continue };
        let Some(penalty) = suppressions.penalty(&id, key).filter(|p| *p < HIDDEN_AT) else { continue };
        let repeat = if repeat_from_home.contains(&id) { HOME_REPEAT_PENALTY } else { 0.0 };
        let taste = suppressed(affinity.track(&id) + 0.5 * affinity.artist(&key.artist), penalty);
        scored.push(Scored { id, snapshot: serde_json::from_str(&raw)?, artist_key: key.artist.clone(), artist_name, taste, score: taste - repeat });
    }
    scored.sort_by(|a, b| b.score.total_cmp(&a.score).then_with(|| a.id.cmp(&b.id)));
    Ok(scored)
}

pub fn mood_seeds(conn: &Connection, moods: &HashMap<String, &'static str>, mood: &str, affinity: &Affinity, now: i64) -> Result<Vec<String>, StoreError> {
    Ok(library(conn, now, affinity, &HashSet::new())?.into_iter().filter(|t| moods.get(&t.id) == Some(&mood)).take(5).map(|t| t.id).collect())
}

fn push_mix(mixes: &mut Vec<DailyMixItem>, id: String, title: String, description: &str, cluster_artists: Vec<String>, tracks: Vec<Value>) {
    if tracks.len() < MIN_MIX_TRACKS {
        return;
    }
    mixes.push(DailyMixItem {
        id,
        title,
        description: description.into(),
        cluster_artists,
        cover: tracks[0].get("cover").cloned(),
        track_count: tracks.len(),
        tracks,
    });
}

fn discover(conn: &Connection, now: i64, affinity: &Affinity, library: &[Scored], shown_before: &HashSet<String>) -> Result<Vec<(String, Value)>, StoreError> {
    let mut seeds: Vec<String> = library.iter().filter(|t| t.taste > 0.0).take(DISCOVER_SEEDS).map(|t| t.id.clone()).collect();
    // A young library borrows the starters' and playlists' taste until it has enough of its own.
    if seeds.len() < DISCOVER_SEEDS {
        let more = starters::fallback_seeds(conn, DISCOVER_SEEDS - seeds.len(), &seeds)?;
        seeds.extend(more);
    }
    if seeds.is_empty() {
        return Ok(Vec::new());
    }
    let mut stmt = conn.prepare(
        "SELECT e.track_id, t.snapshot_json, min(e.rank) FROM candidate_edges e JOIN tracks t ON t.id = e.track_id
         WHERE e.seed_id IN (SELECT value FROM json_each(?1))
           AND NOT EXISTS(SELECT 1 FROM play_events p WHERE p.track_id = e.track_id)
           AND NOT EXISTS(SELECT 1 FROM liked_tracks l WHERE l.track_id = e.track_id)
           AND NOT EXISTS(SELECT 1 FROM playlist_items i WHERE i.track_id = e.track_id)
           AND NOT EXISTS(SELECT 1 FROM taste_excluded x WHERE x.kind = 'track' AND x.id = e.track_id)
         GROUP BY e.track_id ORDER BY min(e.rank), e.track_id LIMIT ?2",
    )?;
    let rows = stmt
        .query_map(params![serde_json::to_string(&seeds)?, MAX_CANDIDATES as i64], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, i64>(2)?)))?
        .collect::<Result<Vec<_>, _>>()?;
    let mut stmt = conn.prepare(
        "SELECT work_key FROM track_keys WHERE work_key != ''
           AND track_id IN (SELECT track_id FROM play_events UNION SELECT track_id FROM liked_tracks UNION SELECT track_id FROM playlist_items)",
    )?;
    let known_works: HashSet<String> = stmt.query_map([], |r| r.get(0))?.collect::<Result<_, _>>()?;
    let ids: Vec<String> = rows.iter().map(|r| r.0.clone()).collect();
    let key_map = keys::load(conn, &ids)?;
    let pmi = pmi::compute(conn, &seeds, &ids)?;
    let suppressions = Suppressions::load(conn, now)?;
    let model = Model::load(conn)?;

    let mut fresh: Vec<(f64, String, String, String)> = Vec::new();
    for (id, raw, best_rank) in rows {
        let Some(key) = key_map.get(&id) else { continue };
        if known_works.contains(&key.work) {
            continue;
        }
        let Some(penalty) = suppressions.penalty(&id, key).filter(|p| *p < HIDDEN_AT) else { continue };
        let similar: f64 = seeds.iter().map(|seed| pmi.get(seed, &id)).sum();
        let x = [0.0, affinity.artist(&key.artist), 0.0, similar.min(MAX_PMI_SUM), 0.0, 1.0, 1.0 - best_rank as f64 / MAX_POOL_ITEMS as f64];
        let repeat = if shown_before.contains(&id) { HOME_REPEAT_PENALTY } else { 0.0 };
        fresh.push((suppressed(model.score(&x), penalty) - repeat, id, key.artist.clone(), raw));
    }
    fresh.sort_by(|a, b| b.0.total_cmp(&a.0).then_with(|| a.1.cmp(&b.1)));
    let mut per_artist: HashMap<String, usize> = HashMap::new();
    let mut picked = Vec::new();
    for (_, id, artist, raw) in fresh {
        if picked.len() == MIX_SIZE {
            break;
        }
        let count = per_artist.entry(artist.clone()).or_default();
        if !artist.is_empty() && *count >= DISCOVER_PER_ARTIST {
            continue;
        }
        *count += 1;
        picked.push((id, serde_json::from_str(&raw)?));
    }
    Ok(picked)
}

pub fn daily_mixes(conn: &Connection, now: i64) -> Result<DailyMixesResponse, StoreError> {
    let today = format!("home:{}", now.div_euclid(DAY_MS));
    let mut stmt = conn.prepare("SELECT DISTINCT track_id FROM served WHERE context = 'home' AND batch_id != ?1 AND served_at >= ?2")?;
    let shown_before: HashSet<String> = stmt.query_map(params![today, now - 2 * DAY_MS], |r| r.get(0))?.collect::<Result<_, _>>()?;
    keys::refresh(conn)?;
    let affinity = rewards::affinity(conn, now)?;
    let library = library(conn, now, &affinity, &shown_before)?;
    let mut mixes = Vec::new();

    let mut per_artist: HashMap<&str, usize> = HashMap::new();
    // Tracks shown on an earlier day sort last but stay: a small library still has a For you.
    let for_you: Vec<&Scored> = library
        .iter()
        .filter(|t| t.taste > 0.0)
        .filter(|t| {
            if t.artist_key.is_empty() {
                return true;
            }
            let count = per_artist.entry(&t.artist_key).or_default();
            *count += 1;
            *count <= FOR_YOU_PER_ARTIST
        })
        .take(MIX_SIZE)
        .collect();
    // A broken snapshot only drops New to you; a database failure still passes through
    let discover = match discover(conn, now, &affinity, &library, &shown_before) {
        Ok(picked) => picked,
        Err(StoreError::Json(_)) => Vec::new(),
        Err(err) => return Err(err),
    };
    savepoint(conn, "mixes", || {
        for id in for_you.iter().map(|t| &t.id).chain(discover.iter().map(|(id, _)| id)) {
            conn.execute(
                "INSERT OR IGNORE INTO served (batch_id, track_id, context, served_at) VALUES (?1, ?2, 'home', ?3)",
                params![today, id, now],
            )?;
        }
        Ok(())
    })?;
    push_mix(&mut mixes, "daily-mix-for-you".into(), "For you".into(), "What you play most, freshly ordered", vec![], for_you.iter().map(|t| t.snapshot.clone()).collect());
    push_mix(&mut mixes, "daily-mix-discover".into(), "New to you".into(), "Tracks you have not heard yet, close to what you play", vec![], discover.into_iter().map(|(_, snapshot)| snapshot).collect());

    let mut artists: Vec<(&str, &str)> = Vec::new();
    for t in library.iter().filter(|t| t.taste > 0.0 && !t.artist_key.is_empty()) {
        if !artists.iter().any(|(key, _)| *key == t.artist_key) {
            artists.push((&t.artist_key, &t.artist_name));
        }
    }
    for (n, (key, name)) in artists.into_iter().take(ARTIST_MIXES).enumerate() {
        let tracks = library.iter().filter(|t| t.artist_key == key).take(MIX_SIZE).map(|t| t.snapshot.clone()).collect();
        push_mix(&mut mixes, format!("daily-mix-artist-{}", n + 1), format!("{name} Mix"), &format!("Your favourite tracks by {name}"), vec![name.to_string()], tracks);
    }

    let allowed: HashSet<&str> = library.iter().map(|t| t.id.as_str()).collect();
    let mut stmt = conn.prepare("SELECT l.track_id, t.snapshot_json FROM liked_tracks l JOIN tracks t ON t.id = l.track_id ORDER BY l.liked_at DESC")?;
    let liked = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?.collect::<Result<Vec<_>, _>>()?;
    let recent: Vec<Value> = liked
        .into_iter()
        .filter(|(id, _)| allowed.contains(id.as_str()))
        .take(MIX_SIZE)
        .map(|(_, raw)| serde_json::from_str(&raw))
        .collect::<Result<_, _>>()?;
    push_mix(&mut mixes, "daily-mix-recent-likes".into(), "Recent likes".into(), "The tracks you liked most recently", vec![], recent);

    let moods = moods(conn)?;
    for (key, title) in MOODS {
        let tracks = library.iter().filter(|t| moods.get(&t.id) == Some(&key)).take(MIX_SIZE).map(|t| t.snapshot.clone()).collect();
        push_mix(&mut mixes, format!("daily-mix-mood-{key}"), title.into(), "", vec![], tracks);
    }
    Ok(DailyMixesResponse { items: mixes, generated_at: iso_from_ms(now) })
}
