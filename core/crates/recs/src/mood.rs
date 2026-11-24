use std::collections::{HashMap, HashSet};

use nuvo_contracts::{MoodMap, MoodPoint};
use nuvo_store::StoreError;
use rusqlite::{Connection, OptionalExtension, params};
use rustfft::FftPlanner;
use rustfft::num_complex::Complex;
use serde_json::Value;

use crate::keys;
use crate::mixes::library;
use crate::rewards;
use crate::suppress::{HIDDEN_AT, Suppressions};

pub const SAMPLE_RATE: usize = 16_000;
pub const MIN_SONGS: usize = 12;
const MAX_LIBRARY: usize = 450;
const MAX_FRESH: i64 = 150;
const EXCERPT_SECONDS: usize = 90;
const FRAME: usize = 1024;
const HOP: usize = 512;
const LOWEST_HZ: f32 = 60.0;
const QUIET_DB: f64 = -60.0;
const PUNCH_WEIGHT: f64 = 0.55;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Sound {
    pub loudness: f64,
    pub punch: f64,
    pub brightness: f64,
}

pub fn measure(samples: &[f32]) -> Option<Sound> {
    let length = samples.len().min(EXCERPT_SECONDS * SAMPLE_RATE);
    let start = (samples.len() - length) / 2;
    let excerpt = &samples[start..start + length];
    let fft = FftPlanner::new().plan_fft_forward(FRAME);
    let hann: Vec<f32> = (0..FRAME).map(|i| 0.5 - 0.5 * (std::f32::consts::TAU * i as f32 / FRAME as f32).cos()).collect();
    let bin_hz = SAMPLE_RATE as f32 / FRAME as f32;
    let first_bin = (LOWEST_HZ / bin_hz).ceil() as usize;
    let mut before = vec![0.0_f32; FRAME / 2];
    let (mut frames, mut db_sum, mut flux_sum, mut octave_sum, mut weight_sum) = (0_usize, 0.0_f64, 0.0_f64, 0.0_f64, 0.0_f64);
    for frame in excerpt.windows(FRAME).step_by(HOP) {
        let power = frame.iter().map(|s| f64::from(s * s)).sum::<f64>() / FRAME as f64;
        let db = 10.0 * power.max(1e-12).log10();
        if db < QUIET_DB {
            continue;
        }
        let mut spectrum: Vec<Complex<f32>> = frame.iter().zip(&hann).map(|(s, w)| Complex::new(s * w, 0.0)).collect();
        fft.process(&mut spectrum);
        let (mut rise, mut total) = (0.0_f64, 0.0_f64);
        for (bin, previous) in before.iter_mut().enumerate().skip(first_bin) {
            let magnitude = spectrum[bin].norm();
            rise += f64::from((magnitude - *previous).max(0.0));
            total += f64::from(magnitude);
            octave_sum += f64::from(magnitude) * f64::from((bin as f32 * bin_hz).log2());
            weight_sum += f64::from(magnitude);
            *previous = magnitude;
        }
        frames += 1;
        db_sum += db;
        flux_sum += rise / total.max(1e-9);
    }
    (frames > 0 && weight_sum > 0.0).then(|| Sound { loudness: db_sum / frames as f64, punch: flux_sum / frames as f64, brightness: octave_sum / weight_sum })
}

pub fn next_due(conn: &Connection) -> Result<Option<String>, StoreError> {
    let sql = "SELECT t.id FROM tracks t LEFT JOIN cache_entries c ON c.track_id = t.id
               WHERE (c.track_id IS NOT NULL OR t.id IN (SELECT track_id FROM local_files))
                 AND (t.id IN (SELECT track_id FROM liked_tracks) OR t.id IN (SELECT track_id FROM play_events) OR t.id IN (SELECT track_id FROM playlist_items))
                 AND t.id NOT IN (SELECT track_id FROM track_moods)
               ORDER BY coalesce(c.last_played_at, 0) DESC, t.id LIMIT 1";
    Ok(conn.query_row(sql, [], |r| r.get(0)).optional()?)
}

pub fn store(conn: &Connection, track_id: &str, sound: Option<Sound>, now: i64) -> Result<(), StoreError> {
    conn.execute(
        "INSERT OR REPLACE INTO track_moods (track_id, loudness, punch, brightness, analysed_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![track_id, sound.map(|s| s.loudness), sound.map(|s| s.punch), sound.map(|s| s.brightness), now],
    )?;
    Ok(())
}

// Places each song among the listener's own songs, so the field is used edge to edge
fn ranks(values: &[f64]) -> Vec<f64> {
    let mut order: Vec<usize> = (0..values.len()).collect();
    order.sort_by(|a, b| values[*a].total_cmp(&values[*b]));
    let mut out = vec![0.0; values.len()];
    for (place, index) in order.into_iter().enumerate() {
        out[index] = (place as f64 + 0.5) / values.len() as f64;
    }
    out
}

fn places(conn: &Connection) -> Result<HashMap<String, (f64, f64)>, StoreError> {
    let mut stmt = conn.prepare("SELECT track_id, loudness, punch, brightness FROM track_moods WHERE loudness IS NOT NULL ORDER BY track_id")?;
    let rows = stmt
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, f64>(1)?, r.get::<_, f64>(2)?, r.get::<_, f64>(3)?)))?
        .collect::<Result<Vec<_>, _>>()?;
    let column = |pick: fn(&(String, f64, f64, f64)) -> f64| ranks(&rows.iter().map(pick).collect::<Vec<_>>());
    let (loudness, punch, brightness) = (column(|r| r.1), column(|r| r.2), column(|r| r.3));
    let energy = ranks(&loudness.iter().zip(&punch).map(|(l, p)| (1.0 - PUNCH_WEIGHT) * l + PUNCH_WEIGHT * p).collect::<Vec<_>>());
    Ok(rows.into_iter().enumerate().map(|(i, row)| (row.0, (energy[i], brightness[i]))).collect())
}

pub fn map(conn: &Connection, now: i64) -> Result<MoodMap, StoreError> {
    keys::refresh(conn)?;
    let places = places(conn)?;
    let affinity = rewards::affinity(conn, now)?;
    let library = library(conn, now, &affinity, &HashSet::new())?;
    let mut points: Vec<MoodPoint> = library
        .into_iter()
        .filter_map(|song| {
            let &(energy, brightness) = places.get(&song.id)?;
            Some(MoodPoint { track: song.snapshot, energy, brightness, taste: song.taste, fresh: false })
        })
        .collect();
    let analysed = points.len();
    if analysed < MIN_SONGS {
        return Ok(MoodMap { analysed, needed: MIN_SONGS, points: Vec::new() });
    }
    points.truncate(MAX_LIBRARY);
    points.extend(fresh(conn, now, &places, &affinity)?);
    Ok(MoodMap { analysed, needed: MIN_SONGS, points })
}

// An unheard song has no sound on this device yet: it stands between the measured songs it was listed with
fn fresh(conn: &Connection, now: i64, places: &HashMap<String, (f64, f64)>, affinity: &rewards::Affinity) -> Result<Vec<MoodPoint>, StoreError> {
    let mut stmt = conn.prepare(
        "SELECT e.track_id, e.seed_id, e.rank, t.snapshot_json FROM candidate_edges e JOIN tracks t ON t.id = e.track_id
         WHERE e.seed_id IN (SELECT track_id FROM track_moods WHERE loudness IS NOT NULL)
           AND e.track_id NOT IN (SELECT track_id FROM play_events)
           AND e.track_id NOT IN (SELECT track_id FROM liked_tracks)
           AND e.track_id NOT IN (SELECT track_id FROM playlist_items)
           AND e.track_id NOT IN (SELECT id FROM taste_excluded WHERE kind = 'track')
         ORDER BY e.rank, e.track_id LIMIT ?1",
    )?;
    let rows = stmt
        .query_map([MAX_FRESH * 4], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, f64>(2)?, r.get::<_, String>(3)?)))?
        .collect::<Result<Vec<_>, _>>()?;
    let mut sums: HashMap<String, (f64, f64, f64)> = HashMap::new();
    let mut order: Vec<(String, String)> = Vec::new();
    for (id, seed, rank, raw) in rows {
        let Some((energy, brightness)) = places.get(&seed) else { continue };
        let weight = 1.0 / (1.0 + rank / 10.0);
        let sum = sums.entry(id.clone()).or_insert_with(|| {
            order.push((id, raw));
            (0.0, 0.0, 0.0)
        });
        *sum = (sum.0 + weight * energy, sum.1 + weight * brightness, sum.2 + weight);
    }
    let ids: Vec<String> = order.iter().map(|(id, _)| id.clone()).collect();
    let key_map = keys::load(conn, &ids)?;
    let suppressions = Suppressions::load(conn, now)?;
    let mut points = Vec::new();
    for (id, raw) in order {
        let Some(key) = key_map.get(&id) else { continue };
        if suppressions.penalty(&id, key).is_none_or(|penalty| penalty >= HIDDEN_AT) {
            continue;
        }
        let Ok(track) = serde_json::from_str::<Value>(&raw) else { continue };
        let (energy, brightness, weight) = sums[&id];
        points.push(MoodPoint { track, energy: energy / weight, brightness: brightness / weight, taste: affinity.artist(&key.artist), fresh: true });
        if points.len() == MAX_FRESH as usize {
            break;
        }
    }
    Ok(points)
}
