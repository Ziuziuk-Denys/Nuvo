use nuvo_import::SourceRow;
use nuvo_import::cascade::{Cascade, Step, is_finished, next_searches, outcome, record};
use serde_json::{Value, json};

fn row(title: &str, artist: &str, ms: i64) -> SourceRow {
    SourceRow { title: title.into(), artists: if artist.is_empty() { vec![] } else { vec![artist.into()] }, duration_ms: Some(ms), ..Default::default() }
}

fn track(id: &str, title: &str, artist: &str, ms: i64) -> Value {
    json!({"id": id, "title": title, "artists": [{"id": "", "name": artist}], "durationMs": ms})
}

type Asked = Vec<(String, &'static str, &'static str)>;

// Every search of a round is asked at once; answers count in order until the row is decided
fn drive(source: &SourceRow, answers: &[Option<Vec<Value>>]) -> (Cascade, Asked) {
    let mut cascade = Cascade::default();
    let mut asked = Vec::new();
    loop {
        let round = next_searches(source, &cascade);
        if round.is_empty() {
            break;
        }
        let first = asked.len();
        asked.extend(round.iter().map(|(_, s)| (s.query.clone(), s.filter, s.source)));
        for (offset, (step, _)) in round.into_iter().enumerate() {
            let answer = answers.get(first + offset).cloned().unwrap_or(Some(vec![]));
            assert!(record(source, &mut cascade, step, answer.clone().unwrap_or_default(), answer.is_none()));
            if is_finished(source, &cascade) {
                break;
            }
        }
    }
    assert!(is_finished(source, &cascade));
    (cascade, asked)
}

#[test]
fn youtube_and_soundcloud_are_asked_together_and_a_sure_official_answer_ends_the_row() {
    let source = row("Blinding Lights", "The Weeknd", 200_000);
    let mut release = track("dQw4w9WgXcQ", "Blinding Lights", "The Weeknd", 200_500);
    release["album"] = json!({"id": "", "title": "After Hours"});
    let (cascade, asked) = drive(&source, &[Some(vec![release])]);
    let query = "The Weeknd Blinding Lights".to_string();
    assert_eq!(asked, [(query.clone(), "songs", "youtube"), (query, "any", "soundcloud")]);
    assert_eq!(cascade.steps.len(), 1, "SoundCloud's answer is not awaited");
    let result = outcome(&source, &cascade);
    assert_eq!((result.label, result.reason, result.score), ("likely", "matched", Some(100)));
    assert_eq!(result.track.unwrap()["cover"]["url"], "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg", "[43]");
}

#[test]
fn the_second_round_can_find_it() {
    let source = row("Blinding Lights", "The Weeknd", 200_000);
    let (cascade, asked) = drive(&source, &[Some(vec![]), Some(vec![]), Some(vec![track("x", "Blinding Lights", "The Weeknd", 200_000)])]);
    assert_eq!(asked.len(), 3, "[38]");
    assert_eq!(outcome(&source, &cascade).label, "likely");
}

#[test]
fn nothing_found_runs_every_step() {
    let source = row("Archangel (Live)", "Burial", 200_000);
    let (cascade, asked) = drive(&source, &[]);
    let filters: Vec<(&str, &str)> = asked.iter().map(|(_, f, s)| (*f, *s)).collect();
    assert_eq!(filters, [("songs", "youtube"), ("any", "soundcloud"), ("any", "youtube"), ("songs", "youtube"), ("videos", "youtube")], "[39]");
    assert_eq!(asked[3].0, "Archangel (Live)", "step 3 searches the cleaned title");
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
    let (cascade, asked) = drive(&source, &[Some(vec![]), Some(vec![found])]);
    assert_eq!(asked.len(), 2, "found in the first round");
    let result = outcome(&source, &cascade);
    assert_eq!(result.label, "likely");
    let matched = result.track.unwrap();
    assert_eq!(matched["source"], "soundcloud");
    assert!(matched.get("cover").is_none_or(Value::is_null));
}

#[test]
fn an_unsure_answer_waits_for_the_other_source() {
    let source = row("Numb", "emilysmith15", 228_000);
    let stranger = track("wecmB_xQZI0", "Numb", "B.I", 227_000);
    let original = track("sc:145402165", "Numb", "emilysmith15", 228_000);
    let (cascade, asked) = drive(&source, &[Some(vec![stranger]), Some(vec![original])]);
    assert_eq!((asked.len(), cascade.steps.len()), (2, 2));
    assert_eq!(outcome(&source, &cascade).track.unwrap()["id"], "sc:145402165");
}

#[test]
fn a_sure_reupload_waits_for_the_official_release() {
    let source = row("Blinding Lights", "The Weeknd", 200_000);
    let reupload = track("sc:9", "Blinding Lights", "The Weeknd", 200_000);
    let mut release = track("dQw4w9WgXcQ", "Blinding Lights", "The Weeknd", 202_000);
    release["album"] = json!({"id": "", "title": "After Hours"});
    let mut cascade = Cascade::default();
    assert!(record(&source, &mut cascade, 1, vec![reupload], false));
    assert!(!is_finished(&source, &cascade));
    assert!(record(&source, &mut cascade, 0, vec![release], false));
    assert_eq!(outcome(&source, &cascade).track.unwrap()["id"], "dQw4w9WgXcQ");
}

#[test]
fn of_equal_matches_the_official_release_wins() {
    let source = row("Numb", "Linkin Park", 187_000);
    let reupload = track("aaaaaaaaaaa", "Numb", "Linkin Park", 187_000);
    let mut release = track("bbbbbbbbbbb", "Numb", "Linkin Park", 187_000);
    release["album"] = json!({"id": "", "title": "Meteora"});
    let (cascade, _) = drive(&source, &[Some(vec![reupload, release])]);
    assert_eq!(outcome(&source, &cascade).track.unwrap()["id"], "bbbbbbbbbbb");
}

#[test]
fn one_song_from_both_sources_is_offered_once() {
    let source = row("Numb", "Linkin Park", 300_000);
    let youtube = track("aaaaaaaaaaa", "Numb", "Linkin Park", 187_000);
    let soundcloud = track("sc:1", "Linkin Park - Numb", "someone", 186_000);
    let (cascade, _) = drive(&source, &[Some(vec![youtube]), Some(vec![soundcloud])]);
    let result = outcome(&source, &cascade);
    assert_eq!(cascade.pool.len(), 2);
    assert_eq!(result.candidates.len(), 1);
}

#[test]
fn a_preview_is_never_a_match() {
    let source = row("Numb", "Linkin Park", 187_000);
    let mut preview = track("sc:1", "Numb", "Linkin Park", 187_000);
    preview["preview"] = json!(true);
    let (cascade, _) = drive(&source, &[Some(vec![]), Some(vec![preview])]);
    let result = outcome(&source, &cascade);
    assert_eq!(result.label, "missing");
    assert!(result.candidates.is_empty());
}

#[test]
fn only_open_searches_are_recorded() {
    let source = row("Blinding Lights", "The Weeknd", 200_000);
    let mut cascade = Cascade::default();
    assert!(!record(&source, &mut cascade, 2, vec![], false), "the next round is not open yet");
    assert!(record(&source, &mut cascade, 0, vec![], false));
    assert!(!record(&source, &mut cascade, 0, vec![], false), "answered already");
    assert!(!record(&source, &mut cascade, 9, vec![], false));
}

#[test]
fn a_cascade_saved_by_the_old_plan_resumes() {
    let source = row("Blinding Lights", "The Weeknd", 200_000);
    let query = "The Weeknd Blinding Lights".to_string();
    let step = |filter: &str| Step { query: query.clone(), filter: filter.into(), source: "youtube".into(), failed: false, found: 0 };
    let cascade = Cascade { steps: vec![step("songs"), step("any")], ..Default::default() };
    let open: Vec<&str> = next_searches(&source, &cascade).iter().map(|(_, s)| s.source).collect();
    assert_eq!(open, ["soundcloud"]);
}

#[test]
fn later_misses_stay_in_the_pool_capped_at_five_without_idless_entries() {
    let source = row("Levels", "Avicii", 199_000);
    let first: Vec<Value> = (0..4).map(|i| track(&format!("a{i}"), &format!("Levels Remix Pack {i}"), "Avicii", 199_000 + i)).collect();
    let second = vec![track("b0", "Levels Other", "Avicii", 199_000), json!({"title": "Levels", "artists": [], "durationMs": 1})];
    let (cascade, _) = drive(&source, &[Some(first), Some(second)]);
    let result = outcome(&source, &cascade);
    assert_eq!(result.candidates.len(), 5);
    assert!(cascade.pool.len() <= 5);
    assert!(cascade.pool.iter().all(|c| c["id"].as_str().is_some_and(|id| !id.is_empty())));
    assert!(result.candidates.iter().any(|c| c["id"] == "b0"), "a later miss can still be offered");
}
