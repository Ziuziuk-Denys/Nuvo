use std::time::Instant;

use nuvo_match::{Candidate, Decision, Reason, Source, evaluate};
use serde_json::{Value, json};

fn source(value: &Value) -> Source {
    Source {
        title: value["title"].as_str().unwrap().to_string(),
        artists: value["artists"].as_array().unwrap().iter().map(|a| a.as_str().unwrap().to_string()).collect(),
        duration_ms: value["durationMs"].as_i64(),
    }
}

/// Decisions from the fixture shared with the renderer.
#[test]
fn shared_decision_cases() {
    let cases: Vec<Value> = serde_json::from_str(include_str!("../../contracts/fixtures/match_cases.json")).unwrap();
    assert_eq!(cases.len(), 29);
    for case in &cases {
        let name = format!("behaviour {}: {}", case["behaviour"], case["name"].as_str().unwrap());
        let candidates: Vec<Candidate> = case["candidates"].as_array().unwrap().iter().map(|c| Candidate::from_track(c).unwrap()).collect();
        let expect = &case["expect"];
        match evaluate(&source(&case["source"]), &candidates) {
            Decision::Approved { index, score } => {
                assert_eq!(expect["status"], "approved", "{name}: approved {} at {score}", candidates[index].id);
                if let Some(id) = expect["id"].as_str() {
                    assert_eq!(candidates[index].id, id, "{name}");
                }
                assert!(score >= expect["minScore"].as_i64().unwrap() && score <= 100, "{name}: score {score}");
            }
            Decision::Pending { reason, proposal, .. } => {
                assert_eq!(expect["status"], "pending", "{name}: pending {reason:?}");
                assert_eq!(reason.as_str(), expect["reason"].as_str().unwrap(), "{name}");
                let proposed = proposal.map(|i| candidates[i].id.clone());
                if let Some(id) = expect["proposal"].as_str() {
                    assert_eq!(proposed.as_deref(), Some(id), "{name}");
                }
                if let Some(ids) = expect["proposalOneOf"].as_array() {
                    assert!(ids.iter().any(|id| id.as_str() == proposed.as_deref()), "{name}: {proposed:?}");
                }
            }
        }
    }
}

#[test]
fn no_candidates_is_low_confidence_without_score_or_proposal() {
    let src = Source { title: "Anything".into(), artists: vec!["Anyone".into()], duration_ms: Some(1000) };
    assert_eq!(evaluate(&src, &[]), Decision::Pending { reason: Reason::LowConfidence, score: None, proposal: None });
}

#[test]
fn reason_codes_are_the_persisted_strings() {
    let codes: Vec<&str> = [Reason::LowConfidence, Reason::Ambiguous, Reason::DurationMismatch, Reason::NoCandidates, Reason::LookupFailed].iter().map(|r| r.as_str()).collect();
    assert_eq!(codes, ["low_confidence_match", "ambiguous_match", "duration_mismatch", "no_catalog_candidates", "catalog_lookup_failed"]);
    assert_eq!(Reason::parse("ambiguous_match"), Some(Reason::Ambiguous));
}

/// Review focus 2: renderer tracks without artists, with fractional or missing durations.
#[test]
fn loose_renderer_tracks_are_still_candidates() {
    let src = Source { title: "Night Drive".into(), artists: vec!["Someone".into()], duration_ms: Some(200_000) };
    let bare = Candidate::from_track(&json!({"id": "x", "title": "Night Drive", "durationMs": 200_000.6, "cover": null})).unwrap();
    assert_eq!((bare.artists.len(), bare.duration_ms), (0, Some(200_001)));
    assert!(matches!(evaluate(&src, &[bare]), Decision::Approved { score, .. } if score >= 88));
    let no_duration = Candidate::from_track(&json!({"id": "y", "title": "Night Drive"})).unwrap();
    assert!(matches!(evaluate(&src, &[no_duration]), Decision::Pending { reason: Reason::LowConfidence, .. }));
    assert!(Candidate::from_track(&json!({"id": "x", "title": " "})).is_none());
    assert!(Candidate::from_track(&json!({"title": "x"})).is_none());
}

#[test]
fn long_text_is_cut_before_processing() {
    let long = "Блюз ".repeat(200);
    let src = Source { title: long.clone(), artists: vec!["Artist".into()], duration_ms: Some(200_000) };
    let candidate = Candidate::from_track(&json!({"id": "x", "title": long, "artists": [{"id": "a", "name": "Artist"}], "durationMs": 200_000})).unwrap();
    assert!(matches!(evaluate(&src, &[candidate]), Decision::Approved { score, .. } if score >= 95));
}

/// Section 6: under 2 ms per source against 50 candidates in a release build.
#[test]
fn fifty_candidates_decide_quickly() {
    let candidates: Vec<Candidate> = (0..50)
        .map(|i| Candidate::from_track(&json!({"id": format!("c{i}"), "title": format!("Song Number {i} (Remix)"), "artists": [{"id": "a", "name": format!("Artist {i}")}], "durationMs": 200_000 + i * 1000})).unwrap())
        .collect();
    let src = Source { title: "Song Number 7 (Remix) [FREE DL]".into(), artists: vec!["Artist 7".into()], duration_ms: Some(207_000) };
    let started = Instant::now();
    for _ in 0..20 {
        evaluate(&src, &candidates);
    }
    let per_source = started.elapsed() / 20;
    let budget_ms = if cfg!(debug_assertions) { 40 } else { 2 };
    assert!(per_source.as_millis() < budget_ms, "{per_source:?}");
}

/// Containment lifts the title score only on word boundaries: "Light" is not inside "Lights".
#[test]
fn containment_needs_a_word_boundary() {
    let src = Source { title: "Light".into(), artists: vec!["Someone".into()], duration_ms: Some(200_000) };
    let pool = |title: &str| [Candidate::from_track(&json!({"id": "x", "title": title, "artists": [{"name": "Else"}], "durationMs": 200_000})).unwrap()];
    let lights = nuvo_match::rank(&src, &pool("Lights"))[0].1;
    let light_song = nuvo_match::rank(&src, &pool("Light 2"))[0].1;
    assert!(lights < 70, "{lights}");
    assert!(light_song > lights);
}

/// `rank` lists every candidate best first, ties in the given order.
#[test]
fn rank_orders_candidates() {
    let src = Source { title: "Levels".into(), artists: vec!["Avicii".into()], duration_ms: Some(199_000) };
    let track = |id: &str, title: &str| Candidate::from_track(&json!({"id": id, "title": title, "artists": [{"name": "Avicii"}], "durationMs": 199_000})).unwrap();
    let list = [track("a", "Other"), track("b", "Levels"), track("c", "Levels")];
    let order: Vec<usize> = nuvo_match::rank(&src, &list).into_iter().map(|(i, _)| i).collect();
    assert_eq!(order, [1, 2, 0]);
}
