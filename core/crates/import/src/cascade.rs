use std::collections::BTreeMap;

use nuvo_match::Filter;
use nuvo_match::relevance::{Song, distinct, is_official};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::SourceRow;
use crate::matcher::{Decision, evaluate, ranked, source};

/// A match this sure on an official copy ends the row at once; the other source's answer is not awaited.
pub const SURE: u8 = 85;

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
pub struct Cascade {
    pub steps: Vec<Step>,
    pub pool: Vec<Value>,
    /// The best place each pooled YouTube candidate took in YouTube's own answers.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub ranks: BTreeMap<String, usize>,
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
/// The searches of one round run together.
#[derive(Debug, Clone, PartialEq)]
pub struct Search {
    pub query: String,
    pub filter: &'static str,
    pub source: &'static str,
    pub round: usize,
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

// YouTube and SoundCloud first, side by side; the YouTube fallbacks after, one at a time
fn plan(row: &SourceRow) -> Vec<Search> {
    let youtube = nuvo_match::plan(&source(row));
    let first = youtube[0].0.clone();
    let mut steps = Vec::with_capacity(youtube.len() + 1);
    for (round, (query, filter)) in youtube.into_iter().enumerate() {
        let filter = match filter {
            Filter::Songs => "songs",
            Filter::Any => "any",
            Filter::Videos => "videos",
        };
        steps.push(Search { query, filter, source: "youtube", round });
        if round == 0 {
            steps.push(Search { query: first.clone(), filter: "any", source: "soundcloud", round });
        }
    }
    steps
}

// Matched by what was searched, so a cascade saved under an older plan still resumes
fn answered(plan: &[Search], cascade: &Cascade) -> Vec<bool> {
    plan.iter().map(|s| cascade.steps.iter().any(|done| done.query == s.query && done.filter == s.filter && done.source == s.source)).collect()
}

fn finished(row: &SourceRow, cascade: &Cascade, plan: &[Search], done: &[bool]) -> bool {
    let Some(round) = plan.iter().zip(done).filter(|(_, d)| !**d).map(|(s, _)| s.round).min() else { return true };
    let started = plan.iter().zip(done).any(|(s, d)| *d && s.round == round);
    match evaluate(row, &cascade.pool, &cascade.ranks) {
        Decision::Approved { index, score } => (score >= SURE && Song::from_track(&cascade.pool[index]).is_some_and(|s| is_official(&s))) || !started,
        Decision::Pending { .. } => false,
    }
}

pub fn is_finished(row: &SourceRow, cascade: &Cascade) -> bool {
    let plan = plan(row);
    finished(row, cascade, &plan, &answered(&plan, cascade))
}

/// The open round's unanswered searches with their step numbers; empty once the row is decided.
pub fn next_searches(row: &SourceRow, cascade: &Cascade) -> Vec<(usize, Search)> {
    let plan = plan(row);
    let done = answered(&plan, cascade);
    if finished(row, cascade, &plan, &done) {
        return Vec::new();
    }
    let open: Vec<(usize, Search)> = plan.into_iter().enumerate().filter(|(i, _)| !done[*i]).collect();
    let round = open.iter().map(|(_, s)| s.round).min();
    open.into_iter().filter(|(_, s)| Some(s.round) == round).collect()
}

/// Adds one search's answer. False when `step` is not an open search of this row.
// A repeated id keeps its first place; entries without an id are dropped
pub fn record(row: &SourceRow, cascade: &mut Cascade, step: usize, candidates: Vec<Value>, failed: bool) -> bool {
    let Some((_, search)) = next_searches(row, cascade).into_iter().find(|(i, _)| *i == step) else { return false };
    let candidates: Vec<Value> = if failed { Vec::new() } else { candidates };
    cascade.steps.push(Step { query: search.query, filter: search.filter.into(), source: search.source.into(), failed, found: candidates.len() });
    let mut merged = cascade.pool.clone();
    for (place, mut candidate) in candidates.into_iter().enumerate() {
        let Some(id) = candidate["id"].as_str().filter(|id| !id.is_empty()).map(str::to_string) else { continue };
        if search.source == "youtube" {
            cascade.ranks.entry(id.clone()).and_modify(|r| *r = (*r).min(place)).or_insert(place);
        }
        if merged.iter().any(|c| c["id"] == id.as_str()) {
            continue;
        }
        // The cover rule needs to know where the candidate came from.
        if let Some(obj) = candidate.as_object_mut() {
            obj.entry("source").or_insert_with(|| search.source.into());
        }
        merged.push(candidate);
    }
    // Misses stay too, so "Pick another" can offer them; the pool is the best five.
    cascade.pool = ranked(row, &merged, &cascade.ranks).into_iter().take(5).map(|(i, _)| merged[i].clone()).collect();
    let pooled: Vec<&str> = cascade.pool.iter().filter_map(|c| c["id"].as_str()).collect();
    cascade.ranks.retain(|id, _| pooled.contains(&id.as_str()));
    true
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
    let best: Vec<Value> = ranked(row, &cascade.pool, &cascade.ranks).into_iter().map(|(i, _)| cascade.pool[i].clone()).collect();
    // One song found on both sources is offered once
    let songs: Vec<Song> = best.iter().filter_map(Song::from_track).collect();
    let candidates = distinct(&songs).into_iter().map(|i| best[i].clone()).collect();
    if cascade.pool.is_empty() {
        let reason = if cascade.steps.iter().any(|s| s.failed) { "catalog_lookup_failed" } else { "no_catalog_candidates" };
        return Outcome { label: "missing", score: None, reason, track: None, candidates };
    }
    match evaluate(row, &cascade.pool, &cascade.ranks) {
        Decision::Approved { index, score } => {
            let label = if score >= SURE { "likely" } else { "check" };
            Outcome { label, score: Some(score), reason: "matched", track: Some(with_cover(cascade.pool[index].clone())), candidates }
        }
        Decision::Pending { reason, score, index } => {
            Outcome { label: "missing", score, reason, track: index.map(|i| with_cover(cascade.pool[i].clone())), candidates }
        }
    }
}
