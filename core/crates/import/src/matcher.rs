use std::collections::BTreeMap;

use nuvo_match::{Candidate, Reason, Source};
use serde_json::Value;

use crate::SourceRow;

#[derive(Debug, Clone, PartialEq)]
pub enum Decision {
    Approved { index: usize, score: u8 },
    Pending { reason: &'static str, score: Option<u8>, index: Option<usize> },
}

pub fn source(row: &SourceRow) -> Source {
    Source { title: row.title.clone(), artists: row.artists.clone(), duration_ms: row.duration_ms }
}

fn candidates(pool: &[Value], ranks: &BTreeMap<String, usize>) -> (Vec<Candidate>, Vec<usize>) {
    pool.iter()
        .enumerate()
        .filter_map(|(at, track)| {
            let rank = track["id"].as_str().and_then(|id| ranks.get(id)).copied();
            Candidate::ranked(track, rank).map(|c| (c, at))
        })
        .unzip()
}

fn scale(score: i64) -> u8 {
    score.clamp(0, 100) as u8
}

// Best first; equal matches go by the better copy, then the pool order
pub fn ranked(row: &SourceRow, pool: &[Value], ranks: &BTreeMap<String, usize>) -> Vec<(usize, u8)> {
    let (list, at) = candidates(pool, ranks);
    nuvo_match::rank(&source(row), &list).into_iter().map(|(i, score)| (at[i], scale(score))).collect()
}

pub fn evaluate(row: &SourceRow, pool: &[Value], ranks: &BTreeMap<String, usize>) -> Decision {
    let (list, at) = candidates(pool, ranks);
    match nuvo_match::evaluate(&source(row), &list) {
        nuvo_match::Decision::Approved { index, score } => Decision::Approved { index: at[index], score: scale(score) },
        nuvo_match::Decision::Pending { reason, score, proposal } => {
            Decision::Pending { reason: Reason::as_str(reason), score: score.map(scale), index: proposal.map(|i| at[i]) }
        }
    }
}
