use nuvo_store::StoreError;
use rusqlite::{Connection, OptionalExtension, params};

// Feature order: track, artist, time-bucket, PMI, audio similarity, novelty, source rank
pub const FEATURES: usize = 7;
/// The last weight is the bias.
pub const FIXED: [f64; FEATURES + 1] = [1.0, 0.8, 0.3, 1.2, 0.8, 0.2, 0.6, 0.0];
pub const LEARN_AFTER: i64 = 500;
const MODEL_KEY: &str = "global";
const LEARNING_RATE: f64 = 0.05;

#[derive(Debug, Clone, PartialEq)]
pub struct Model {
    pub weights: [f64; FEATURES + 1],
    pub learned: bool,
}

impl Model {
    pub fn load(conn: &Connection) -> Result<Self, StoreError> {
        let row: Option<(String, i64)> = conn
            .query_row("SELECT weights_json, events_seen FROM rec_model WHERE key = ?1", [MODEL_KEY], |r| Ok((r.get(0)?, r.get(1)?)))
            .optional()?;
        match row {
            Some((json, seen)) if seen >= LEARN_AFTER => {
                match serde_json::from_str::<[f64; FEATURES + 1]>(&json) {
                    Ok(weights) if weights.iter().all(|w| w.is_finite()) => Ok(Self { weights, learned: true }),
                    _ => Ok(Self { weights: FIXED, learned: false }),
                }
            }
            _ => Ok(Self { weights: FIXED, learned: false }),
        }
    }

    pub fn score(&self, x: &[f64; FEATURES]) -> f64 {
        x.iter().zip(&self.weights).map(|(x, w)| x * w).sum::<f64>() + self.weights[FEATURES]
    }
}

pub fn learn(conn: &Connection, x: &[f64; FEATURES], label: bool, now: i64) -> Result<(), StoreError> {
    let row: Option<(String, i64)> = conn
        .query_row("SELECT weights_json, events_seen FROM rec_model WHERE key = ?1", [MODEL_KEY], |r| Ok((r.get(0)?, r.get(1)?)))
        .optional()?;
    let (mut weights, seen): ([f64; FEATURES + 1], i64) = match row {
        Some((json, seen)) => {
            let w: [f64; FEATURES + 1] = match serde_json::from_str::<[f64; FEATURES + 1]>(&json) {
                Ok(arr) if arr.iter().all(|v| v.is_finite()) => arr,
                _ => FIXED,
            };
            (w, seen)
        }
        None => (FIXED, 0),
    };
    let z = x.iter().zip(&weights).map(|(x, w)| x * w).sum::<f64>() + weights[FEATURES];
    let error = f64::from(u8::from(label)) - 1.0 / (1.0 + (-z).exp());
    for (w, x) in weights.iter_mut().zip(x) {
        *w += LEARNING_RATE * error * x;
        *w = w.clamp(-10.0, 10.0);
    }
    weights[FEATURES] += LEARNING_RATE * error;
    weights[FEATURES] = weights[FEATURES].clamp(-10.0, 10.0);
    if !weights.iter().all(|w| w.is_finite()) {
        return Ok(());
    }
    conn.execute(
        "INSERT INTO rec_model (key, weights_json, events_seen, updated_at) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(key) DO UPDATE SET weights_json = excluded.weights_json, events_seen = excluded.events_seen, updated_at = excluded.updated_at",
        params![MODEL_KEY, serde_json::to_string(&weights)?, seen + 1, now],
    )?;
    Ok(())
}
