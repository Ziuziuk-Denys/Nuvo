//! Co-occurrence similarity, computed per request for its anchors (seeds, recent plays, session
//! feedback) against its candidates only. Two sources: the candidate lists of seeds (two tracks
//! in one list) and own sessions (counted plays within 3 positions). Freed after the response.

use std::collections::{HashMap, HashSet};

use nuvo_store::StoreError;
use rusqlite::Connection;

const SESSION_WINDOW: usize = 3;
const COUNTED: &str = "(end_reason = 'complete' OR played_ms >= 30000)";
const SESSION_DAYS: i64 = 180 * 86_400_000;

/// Normalised PMI clamped to [0, 1]; negative association counts as none.
pub fn npmi(co: f64, a: f64, b: f64, n: f64) -> f64 {
    if co <= 0.0 || a <= 0.0 || b <= 0.0 || n <= 0.0 {
        return 0.0;
    }
    let p_ab = co / n;
    if p_ab >= 1.0 {
        return 1.0;
    }
    ((co * n / (a * b)).ln() / -p_ab.ln()).clamp(0.0, 1.0)
}

#[derive(Debug, Default)]
pub struct Pmi {
    pairs: HashMap<(String, String), f64>,
}

impl Pmi {
    pub fn get(&self, anchor: &str, candidate: &str) -> f64 {
        self.pairs.get(&(anchor.to_string(), candidate.to_string())).copied().unwrap_or(0.0)
    }

    fn keep_max(&mut self, anchor: &str, candidate: &str, value: f64) {
        let slot = self.pairs.entry((anchor.to_string(), candidate.to_string())).or_insert(0.0);
        *slot = slot.max(value);
    }
}

fn counts(conn: &Connection, sql: &str, ids: &str) -> Result<HashMap<String, f64>, StoreError> {
    let mut stmt = conn.prepare(sql)?;
    let rows = stmt.query_map([ids], |r| Ok((r.get::<_, String>(0)?, r.get::<_, f64>(1)?)))?;
    Ok(rows.collect::<Result<_, _>>()?)
}

// shortcut: the candidate-list part scans candidate_edges on every request; fine for a personal
// library (thousands of seeds), move to per-seed baskets if a rank takes over 100 ms.
pub fn compute(conn: &Connection, anchors: &[String], candidates: &[String]) -> Result<Pmi, StoreError> {
    let mut pmi = Pmi::default();
    if anchors.is_empty() || candidates.is_empty() {
        return Ok(pmi);
    }
    let anchors_json = serde_json::to_string(anchors)?;
    let candidates_json = serde_json::to_string(candidates)?;
    let mut both: Vec<&String> = anchors.iter().chain(candidates).collect();
    both.sort();
    both.dedup();
    let both_json = serde_json::to_string(&both)?;

    // Candidate lists: each seed's list plus the seed itself is one basket.
    let baskets = "b(seed, x) AS (SELECT seed_id, track_id FROM candidate_edges UNION SELECT DISTINCT seed_id, seed_id FROM candidate_edges)";
    let n: f64 = conn.query_row("SELECT count(DISTINCT seed_id) FROM candidate_edges", [], |r| r.get(0))?;
    let in_baskets = counts(conn, &format!("WITH {baskets} SELECT x, count(*) FROM b WHERE x IN (SELECT value FROM json_each(?1)) GROUP BY x"), &both_json)?;
    let mut stmt = conn.prepare(&format!(
        "WITH {baskets} SELECT ba.x, bc.x, count(*) FROM b ba JOIN b bc ON ba.seed = bc.seed
         WHERE ba.x IN (SELECT value FROM json_each(?1)) AND bc.x IN (SELECT value FROM json_each(?2)) AND ba.x != bc.x
         GROUP BY ba.x, bc.x"
    ))?;
    let pairs = stmt
        .query_map([&anchors_json, &candidates_json], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, f64>(2)?)))?
        .collect::<Result<Vec<_>, _>>()?;
    for (a, c, co) in pairs {
        let value = npmi(co, in_baskets.get(&a).copied().unwrap_or(0.0), in_baskets.get(&c).copied().unwrap_or(0.0), n);
        pmi.keep_max(&a, &c, value);
    }

    // Own sessions: counted plays within 3 positions of each other.
    let anchors_set: HashSet<&str> = anchors.iter().map(|s| s.as_str()).collect();
    let candidates_set: HashSet<&str> = candidates.iter().map(|s| s.as_str()).collect();
    let total: f64 = conn.query_row(&format!("SELECT count(*) FROM play_events WHERE {COUNTED}"), [], |r| r.get(0))?;
    let plays = counts(conn, &format!("SELECT track_id, count(*) FROM play_events WHERE {COUNTED} AND track_id IN (SELECT value FROM json_each(?1)) GROUP BY track_id"), &both_json)?;
    let now: i64 = conn.query_row("SELECT coalesce(max(started_at), CAST(strftime('%s', 'now') AS INTEGER) * 1000) FROM play_events", [], |r| r.get(0))?;
    let threshold = now - SESSION_DAYS;
    let mut stmt = conn.prepare(&format!(
        "SELECT session_id, track_id FROM play_events
         WHERE {COUNTED} AND started_at >= ?2 AND session_id IN (SELECT session_id FROM play_events WHERE track_id IN (SELECT value FROM json_each(?1)))
         ORDER BY session_id, started_at DESC, id DESC
         LIMIT 50000"
    ))?;
    let rows = stmt.query_map(rusqlite::params![&anchors_json, threshold], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?.collect::<Result<Vec<_>, _>>()?;
    let mut sessions: Vec<Vec<String>> = Vec::new();
    let mut last_session = None;
    for (session, track) in rows {
        if last_session.as_ref() != Some(&session) {
            sessions.push(Vec::new());
            last_session = Some(session);
        }
        sessions.last_mut().expect("pushed above").push(track);
    }
    let mut co: HashMap<(String, String), f64> = HashMap::new();
    for seq in &sessions {
        for i in 0..seq.len() {
            for j in i + 1..seq.len().min(i + 1 + SESSION_WINDOW) {
                for (a, c) in [(&seq[i], &seq[j]), (&seq[j], &seq[i])] {
                    if a != c && anchors_set.contains(a.as_str()) && candidates_set.contains(c.as_str()) {
                        *co.entry((a.clone(), c.clone())).or_default() += 1.0;
                    }
                }
            }
        }
    }
    for ((a, c), count) in co {
        let value = npmi(count, plays.get(&a).copied().unwrap_or(0.0), plays.get(&c).copied().unwrap_or(0.0), total);
        pmi.keep_max(&a, &c, value);
    }
    Ok(pmi)
}
