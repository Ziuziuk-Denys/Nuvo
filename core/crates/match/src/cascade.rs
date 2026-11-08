//! The search cascade: which catalog search runs next, and the outcome when it is over. Stateless:
//! every call replays the steps already run, so the renderer (which owns the YouTube client) can
//! drive it through `/v1/match/next` and Rust callers through [`run`].

use std::future::Future;

use serde::de::Error as _;
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use serde_json::{Value, json};

use crate::decide::{Candidate, Decision, Reason, Source, evaluate};
use crate::text::search_query;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Filter {
    Songs,
    Any,
    Videos,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Step {
    pub query: String,
    pub filter: Filter,
    #[serde(default)]
    pub failed: bool,
    /// How many candidates this step appended to the request's `candidates`.
    #[serde(default)]
    pub found: usize,
}

impl Serialize for Reason {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(self.as_str())
    }
}

impl<'de> Deserialize<'de> for Reason {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let code = String::deserialize(d)?;
        Reason::parse(&code).ok_or_else(|| D::Error::custom(format!("unknown reason {code}")))
    }
}

/// What `/v1/match/next` answers; `run` never returns `Search`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "lowercase")]
pub enum Answer {
    Approved {
        track: Value,
        score: i64,
    },
    Pending {
        reason: Reason,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        score: Option<i64>,
        #[serde(default, rename = "proposedTrack", skip_serializing_if = "Option::is_none")]
        proposed_track: Option<Value>,
    },
    Search {
        query: String,
        filter: Filter,
    },
}

/// The 3 or 4 searches for a source, in order.
pub fn plan(source: &Source) -> Vec<(String, Filter)> {
    let q = search_query(&source.title, &source.artists);
    let mut steps = vec![(q.query.clone(), Filter::Songs), (q.query.clone(), Filter::Any)];
    if !q.title.is_empty() && q.title != q.query {
        steps.push((q.title.clone(), Filter::Songs));
    }
    steps.push((q.query, Filter::Videos));
    steps
}

fn is_video_id(id: &str) -> bool {
    id.len() == 11 && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

/// An approved YouTube video without a cover gets its thumbnail.
fn with_cover(mut track: Value) -> Value {
    let id = track.get("id").and_then(Value::as_str).unwrap_or_default().to_string();
    if track.get("cover").is_none_or(Value::is_null) && is_video_id(&id) {
        track["cover"] = json!({"url": format!("https://i.ytimg.com/vi/{id}/hqdefault.jpg"), "width": 480, "height": 360});
    }
    track
}

fn merge(pool: &[Candidate], more: &[Candidate]) -> Vec<Candidate> {
    let mut merged: Vec<Candidate> = Vec::new();
    for candidate in pool.iter().chain(more) {
        if !merged.iter().any(|c| c.id == candidate.id) {
            merged.push(candidate.clone());
        }
    }
    merged
}

/// A decision as an answer: the approved track (with a derived cover), or the pending reason and proposal.
pub fn outcome(pool: &[Candidate], decision: &Decision) -> Answer {
    match decision {
        Decision::Approved { index, score } => Answer::Approved { track: with_cover(pool[*index].raw.clone()), score: *score },
        Decision::Pending { reason, score, proposal } => Answer::Pending { reason: *reason, score: *score, proposed_track: proposal.map(|i| pool[i].raw.clone()) },
    }
}

/// Replays `steps` (whose results are `candidates`, concatenated in step order) and says what to do next.
pub fn next(source: &Source, candidates: &[Value], steps: &[Step]) -> Result<Answer, String> {
    if source.title.trim().is_empty() {
        return Err("source title must not be blank".into());
    }
    let planned = plan(source);
    if steps.len() > planned.len() {
        return Err("more steps than the cascade has".into());
    }
    if steps.iter().map(|s| s.found).sum::<usize>() != candidates.len() {
        return Err("step counts do not add up to the candidates".into());
    }
    let mut pool: Vec<Candidate> = Vec::new();
    let mut decision: Option<Decision> = None;
    let mut offset = 0;
    for (step, (query, filter)) in steps.iter().zip(&planned) {
        if step.query != *query || step.filter != *filter {
            return Err(format!("step {query:?} ({filter:?}) was expected"));
        }
        let found: Vec<Candidate> = candidates[offset..offset + step.found].iter().filter_map(Candidate::from_track).collect();
        offset += step.found;
        if found.is_empty() {
            continue;
        }
        let merged = merge(&pool, &found);
        let merged_decision = evaluate(source, &merged);
        if merged_decision.is_approved() || decision.is_none() {
            pool = merged;
            decision = Some(merged_decision);
        }
        if decision.as_ref().is_some_and(Decision::is_approved) {
            break;
        }
    }
    if let Some(d) = &decision
        && (d.is_approved() || steps.len() == planned.len())
    {
        return Ok(outcome(&pool, d));
    }
    if let Some((query, filter)) = planned.get(steps.len()) {
        return Ok(Answer::Search { query: query.clone(), filter: *filter });
    }
    let reason = if steps.iter().any(|s| s.failed) { Reason::LookupFailed } else { Reason::NoCandidates };
    Ok(Answer::Pending { reason, score: None, proposed_track: None })
}

/// Drives the whole cascade with `search`, which returns tracks or fails. Dropping the future
/// cancels it: no outcome, nothing remembered.
pub async fn run<F, Fut>(source: &Source, mut search: F) -> Result<Answer, String>
where
    F: FnMut(String, Filter) -> Fut,
    Fut: Future<Output = Result<Vec<Value>, String>>,
{
    let mut candidates: Vec<Value> = Vec::new();
    let mut steps: Vec<Step> = Vec::new();
    loop {
        match next(source, &candidates, &steps)? {
            Answer::Search { query, filter } => {
                let (failed, found) = match search(query.clone(), filter).await {
                    Ok(items) => (false, items),
                    Err(_) => (true, Vec::new()),
                };
                steps.push(Step { query, filter, failed, found: found.len() });
                candidates.extend(found);
            }
            done => return Ok(done),
        }
    }
}
