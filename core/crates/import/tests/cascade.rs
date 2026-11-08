use nuvo_import::SourceRow;
use nuvo_import::cascade::{Cascade, is_finished, next_search, outcome, record};
use serde_json::{Value, json};

fn row(title: &str, artist: &str, ms: i64) -> SourceRow {
    SourceRow { title: title.into(), artists: if artist.is_empty() { vec![] } else { vec![artist.into()] }, duration_ms: Some(ms), ..Default::default() }
}

fn track(id: &str, title: &str, artist: &str, ms: i64) -> Value {
    json!({"id": id, "title": title, "artists": [{"id": "", "name": artist}], "durationMs": ms})
}

/// Runs the cascade with `answers[i]` as the answer to the i-th search (`None` = the search failed).
fn drive(source: &SourceRow, answers: &[Option<Vec<Value>>]) -> (Cascade, Vec<(String, &'static str, &'static str)>) {
    let mut cascade = Cascade::default();
    let mut asked = Vec::new();
    while let Some(search) = next_search(source, &cascade) {
        asked.push((search.query.clone(), search.filter, search.source));
        let answer = answers.get(asked.len() - 1).cloned().unwrap_or(Some(vec![]));
        record(source, &mut cascade, answer.clone().unwrap_or_default(), answer.is_none());
    }
    assert!(is_finished(source, &cascade));
    (cascade, asked)
}

#[test]
fn an_exact_first_answer_costs_one_search() {
    let source = row("Blinding Lights", "The Weeknd", 200_000);
    let (cascade, asked) = drive(&source, &[Some(vec![track("dQw4w9WgXcQ", "Blinding Lights", "The Weeknd", 200_500)])]);
    assert_eq!(asked, [("The Weeknd Blinding Lights".to_string(), "songs", "youtube")]);
    let result = outcome(&source, &cascade);
    assert_eq!((result.label, result.reason, result.score), ("likely", "matched", Some(100)));
    assert_eq!(result.track.unwrap()["cover"]["url"], "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg", "[43]");
}

#[test]
fn the_second_step_can_find_it() {
    let source = row("Blinding Lights", "The Weeknd", 200_000);
    let (cascade, asked) = drive(&source, &[Some(vec![]), Some(vec![track("x", "Blinding Lights", "The Weeknd", 200_000)])]);
    assert_eq!(asked.len(), 2, "[38]");
    assert_eq!(outcome(&source, &cascade).label, "likely");
}

#[test]
fn nothing_found_runs_every_step_then_soundcloud() {
    let source = row("Archangel (Live)", "Burial", 200_000);
    let (cascade, asked) = drive(&source, &[]);
    let filters: Vec<(&str, &str)> = asked.iter().map(|(_, f, s)| (*f, *s)).collect();
    assert_eq!(filters, [("songs", "youtube"), ("any", "youtube"), ("songs", "youtube"), ("videos", "youtube"), ("any", "soundcloud")], "[39] plus SoundCloud");
    assert_eq!(asked[2].0, "Archangel (Live)", "step 3 searches the cleaned title");
    let result = outcome(&source, &cascade);
    assert_eq!((result.label, result.reason, result.track), ("missing", "no_catalog_candidates", None));

    let bare = row("Teardrop", "", 200_000);
    assert_eq!(drive(&bare, &[]).1.len(), 4, "[40] step 3 skipped when T equals Q");
}

#[test]
fn a_failed_search_is_named() {
    let source = row("Blinding Lights", "The Weeknd", 200_000);
    let (cascade, _) = drive(&source, &[Some(vec![]), None]);
    assert_eq!(outcome(&source, &cascade).reason, "catalog_lookup_failed", "[41]");
}

#[test]
fn an_early_proposal_survives_unrelated_later_answers() {
    let source = row("Levels", "Avicii", 199_000);
    let long = track("v", "Levels", "Avicii", 260_000);
    let noise = |id: &str| Some(vec![track(id, "Something Else", "Other", 180_000)]);
    let (cascade, _) = drive(&source, &[Some(vec![long]), noise("n1"), noise("n2"), noise("n3")]);
    let result = outcome(&source, &cascade);
    assert_eq!((result.label, result.reason), ("missing", "duration_mismatch"), "[42]");
    assert_eq!(result.track.unwrap()["id"], "v", "the step 1 candidate is the proposal");
}

#[test]
fn check_rows_and_the_top_five() {
    let source = row("Song Title Here", "", 200_000);
    let found: Vec<Value> = (0..7).map(|i| track(&format!("c{i}"), &format!("Song Title Here {i}"), "Someone", 200_000 + i * 1000)).collect();
    let (cascade, _) = drive(&source, &[Some(found)]);
    let result = outcome(&source, &cascade);
    assert_eq!(result.candidates.len(), 5);
    assert!(result.candidates.iter().all(|c| c["id"].as_str().unwrap().starts_with('c')));
}

#[test]
fn a_soundcloud_match_gets_no_youtube_cover() {
    let source = row("Teardrop", "Massive Attack", 330_000);
    let found = track("12345678901", "Teardrop", "Massive Attack", 330_000);
    let (cascade, asked) = drive(&source, &[Some(vec![]), Some(vec![]), Some(vec![]), Some(vec![]), Some(vec![found])]);
    assert_eq!(asked.last().unwrap().2, "soundcloud");
    let result = outcome(&source, &cascade);
    assert_eq!(result.label, "likely");
    assert!(result.track.unwrap().get("cover").is_none_or(Value::is_null));
}

#[test]
fn later_misses_stay_in_the_pool_capped_at_five_without_idless_entries() {
    let source = row("Levels", "Avicii", 199_000);
    let first: Vec<Value> = (0..4).map(|i| track(&format!("a{i}"), "Levels Remix Pack", "Avicii", 199_000 + i)).collect();
    let second = vec![track("b0", "Levels Other", "Avicii", 199_000), json!({"title": "Levels", "artists": [], "durationMs": 1})];
    let (cascade, _) = drive(&source, &[Some(first), Some(second)]);
    let result = outcome(&source, &cascade);
    assert_eq!(result.candidates.len(), 5);
    assert!(cascade.pool.len() <= 5);
    assert!(cascade.pool.iter().all(|c| c["id"].as_str().is_some_and(|id| !id.is_empty())));
    assert!(result.candidates.iter().any(|c| c["id"] == "b0"), "a later miss can still be offered");
}
