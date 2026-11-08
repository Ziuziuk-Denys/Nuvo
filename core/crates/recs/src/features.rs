//! Audio feature vectors (`track_features`, f32 little-endian). Optional input: nothing analyses
//! audio yet (the analyser and its licence are a later decision), so every caller treats a
//! missing vector as "no audio evidence" and ranks on the other signals.

use std::collections::HashMap;

use nuvo_store::StoreError;
use rusqlite::{Connection, params};

// shortcut: the threshold assumes features scaled to [-1, 1]; calibrate it with the analyser.
pub const AUDIO_NEAR: f64 = 1.0;

pub fn store(conn: &Connection, track_id: &str, version: i64, vector: &[f32], now: i64) -> Result<(), StoreError> {
    for &v in vector {
        if !v.is_finite() {
            return Err(StoreError::Invalid("non-finite vector values".into()));
        }
    }
    let blob: Vec<u8> = vector.iter().flat_map(|v| v.to_le_bytes()).collect();
    conn.execute(
        "INSERT OR REPLACE INTO track_features (track_id, version, vector, analysed_at) VALUES (?1, ?2, ?3, ?4)",
        params![track_id, version, blob, now],
    )?;
    Ok(())
}

pub fn load(conn: &Connection, ids: &[String]) -> Result<HashMap<String, Vec<f32>>, StoreError> {
    let mut stmt = conn.prepare("SELECT track_id, vector FROM track_features WHERE track_id IN (SELECT value FROM json_each(?1))")?;
    let rows = stmt.query_map([serde_json::to_string(ids)?], |r| {
        let blob: Vec<u8> = r.get(1)?;
        let vector = blob.chunks_exact(4).map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]])).collect();
        Ok((r.get::<_, String>(0)?, vector))
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

/// Euclidean distance; `None` when either vector is missing or they come from different layouts.
pub fn distance(a: Option<&Vec<f32>>, b: Option<&Vec<f32>>) -> Option<f64> {
    let (a, b) = (a?, b?);
    if a.len() != b.len() || a.is_empty() {
        return None;
    }
    Some(a.iter().zip(b).map(|(x, y)| (f64::from(*x) - f64::from(*y)).powi(2)).sum::<f64>().sqrt())
}

/// 1 for identical sound, toward 0 as the distance grows; 0 without vectors.
pub fn similarity(a: Option<&Vec<f32>>, b: Option<&Vec<f32>>) -> f64 {
    distance(a, b).map_or(0.0, |d| 1.0 / (1.0 + d))
}
