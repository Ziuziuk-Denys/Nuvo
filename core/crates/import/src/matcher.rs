//! Adapter between import rows and `nuvo-match`, which owns the text rules, scoring and decisions.
//! This module only converts types.

use nuvo_match::{Candidate, Reason, Source};
use serde_json::Value;

use crate::SourceRow;

#[derive(Debug, Clone, PartialEq)]
pub enum Decision {
    /// `index` points into the evaluated pool.
    Approved { index: usize, score: u8 },
    /// `index` is the best candidate, offered to the user as a proposal.
    Pending { reason: &'static str, score: Option<u8>, index: Option<usize> },
}

pub fn source(row: &SourceRow) -> Source {
    Source { title: row.title.clone(), artists: row.artists.clone(), duration_ms: row.duration_ms }
}

/// The pool entries nuvo-match can read, with their positions in the pool. An entry without an id
/// or a title cannot be a candidate.
fn candidates(pool: &[Value]) -> (Vec<Candidate>, Vec<usize>) {
    pool.iter().enumerate().filter_map(|(at, track)| Candidate::from_track(track).map(|c| (c, at))).unzip()
}

fn scale(score: i64) -> u8 {
    score.clamp(0, 100) as u8
}

/// Candidate positions in `pool` by score, best first; ties keep the pool order.
pub fn ranked(row: &SourceRow, pool: &[Value]) -> Vec<(usize, u8)> {
    let (list, at) = candidates(pool);
    nuvo_match::rank(&source(row), &list).into_iter().map(|(i, score)| (at[i], scale(score))).collect()
}

pub fn evaluate(row: &SourceRow, pool: &[Value]) -> Decision {
    let (list, at) = candidates(pool);
    match nuvo_match::evaluate(&source(row), &list) {
        nuvo_match::Decision::Approved { index, score } => Decision::Approved { index: at[index], score: scale(score) },
        nuvo_match::Decision::Pending { reason, score, proposal } => {
            Decision::Pending { reason: Reason::as_str(reason), score: score.map(scale), index: proposal.map(|i| at[i]) }
        }
    }
}
