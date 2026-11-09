use serde::{Deserialize, Serialize};
use nuvo_match::Filter;
use serde_json::{Value, json};

use crate::SourceRow;
use crate::matcher::{Decision, evaluate, ranked, source};

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
pub struct Cascade {
    pub steps: Vec<Step>,
    pub pool: Vec<Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Step {
    pub query: String,
    pub filter: String,
    pub source: String,
    pub failed: bool,
    pub found: usize,
}

/// One search for the renderer. `filter` is `songs`, `any` or `videos`; `source` is `youtube` or `soundcloud`.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Search {
    pub query: String,
    pub filter: &'static str,
    pub source: &'static str,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Outcome {
    /// `likely`, `check` or `missing`.
    pub label: &'static str,
    pub score: Option<u8>,
    /// `matched` or a reason code.
    pub reason: &'static str,
    pub track: Option<Value>,
    pub candidates: Vec<Value>,
}

fn plan(row: &SourceRow) -> Vec<Search> {
    let mut steps: Vec<Search> = nuvo_match::plan(&source(row))
        .into_iter()
        .map(|(query, filter)| Search {
            query,
            filter: match filter {
                Filter::Songs => "songs",
                Filter::Any => "any",
                Filter::Videos => "videos",
            },
            source: "youtube",
        })
        .collect();
    let query = steps[0].query.clone();
    steps.push(Search { query, filter: "any", source: "soundcloud" });
    steps
}

fn approved(row: &SourceRow, pool: &[Value]) -> bool {
    !pool.is_empty() && matches!(evaluate(row, pool), Decision::Approved { .. })
}

pub fn is_finished(row: &SourceRow, cascade: &Cascade) -> bool {
    approved(row, &cascade.pool) || cascade.steps.len() >= plan(row).len()
}

pub fn next_search(row: &SourceRow, cascade: &Cascade) -> Option<Search> {
    if is_finished(row, cascade) { None } else { plan(row).into_iter().nth(cascade.steps.len()) }
}

// A repeated id keeps its first place; entries without an id are dropped
pub fn record(row: &SourceRow, cascade: &mut Cascade, candidates: Vec<Value>, failed: bool) {
    let Some(search) = next_search(row, cascade) else { return };
    let candidates: Vec<Value> = if failed { Vec::new() } else { candidates };
    cascade.steps.push(Step { query: search.query, filter: search.filter.into(), source: search.source.into(), failed, found: candidates.len() });
    if candidates.is_empty() {
        return;
    }
    let mut merged = cascade.pool.clone();
    for mut candidate in candidates {
        let has_id = candidate["id"].as_str().is_some_and(|id| !id.is_empty());
        if !has_id || merged.iter().any(|c| c["id"] == candidate["id"]) {
            continue;
        }
        // The cover rule needs to know where the candidate came from.
        if let Some(obj) = candidate.as_object_mut() {
            obj.entry("source").or_insert_with(|| search.source.into());
        }
        merged.push(candidate);
    }
    // Misses stay too, so "Pick another" can offer them; the pool is the best five.
    cascade.pool = ranked(row, &merged).into_iter().take(5).map(|(i, _)| merged[i].clone()).collect();
}

fn with_cover(mut track: Value) -> Value {
    let id = track["id"].as_str().unwrap_or_default().to_string();
    let youtube = !id.is_empty() && track["source"] == "youtube";
    if youtube && track.get("cover").is_none_or(Value::is_null) && let Some(obj) = track.as_object_mut() {
        obj.insert("cover".into(), json!({"url": format!("https://i.ytimg.com/vi/{id}/hqdefault.jpg"), "width": 480, "height": 360}));
    }
    track
}

/// Approved at 85 or more is Likely, 75 to 84 Check; everything else is Missing with its reason.
pub fn outcome(row: &SourceRow, cascade: &Cascade) -> Outcome {
    let candidates = ranked(row, &cascade.pool).into_iter().take(5).map(|(i, _)| cascade.pool[i].clone()).collect();
    if cascade.pool.is_empty() {
        let reason = if cascade.steps.iter().any(|s| s.failed) { "catalog_lookup_failed" } else { "no_catalog_candidates" };
        return Outcome { label: "missing", score: None, reason, track: None, candidates };
    }
    match evaluate(row, &cascade.pool) {
        Decision::Approved { index, score } => {
            let label = if score >= 85 { "likely" } else { "check" };
            Outcome { label, score: Some(score), reason: "matched", track: Some(with_cover(cascade.pool[index].clone())), candidates }
        }
        Decision::Pending { reason, score, index } => {
            Outcome { label: "missing", score, reason, track: index.map(|i| with_cover(cascade.pool[i].clone())), candidates }
        }
    }
}
