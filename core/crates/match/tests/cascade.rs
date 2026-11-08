use std::sync::{Arc, Mutex};

use nuvo_match::{Answer, Filter, Reason, Source, Step, memo, next, plan, run};
use serde_json::{Value, json};

fn source(title: &str, artist: &str, ms: i64) -> Source {
    let artists = if artist.is_empty() { vec![] } else { vec![artist.to_string()] };
    Source { title: title.into(), artists, duration_ms: Some(ms) }
}

fn track(id: &str, title: &str, artist: &str, ms: i64) -> Value {
    json!({"id": id, "title": title, "artists": [{"id": "a", "name": artist}], "durationMs": ms})
}

type Log = Arc<Mutex<Vec<(String, Filter)>>>;

/// A fake catalog: answer `i` serves search `i`; `None` fails that search.
async fn cascade(src: &Source, answers: Vec<Option<Vec<Value>>>) -> (Answer, Vec<(String, Filter)>) {
    let log: Log = Arc::default();
    let seen = log.clone();
    let answers = Arc::new(answers);
    let outcome = run(src, move |query, filter| {
        let seen = seen.clone();
        let answers = answers.clone();
        async move {
            let n = {
                let mut seen = seen.lock().unwrap();
                seen.push((query, filter));
                seen.len() - 1
            };
            answers.get(n).cloned().flatten().ok_or_else(|| "search failed".to_string())
        }
    })
    .await
    .unwrap();
    let searches = log.lock().unwrap().clone();
    (outcome, searches)
}

#[tokio::test]
async fn an_exact_first_answer_costs_one_search() {
    let src = source("Blinding Lights", "The Weeknd", 200000);
    let (outcome, searches) = cascade(&src, vec![Some(vec![track("dQw4w9WgXcQ", "Blinding Lights", "The Weeknd", 200500)])]).await;
    assert_eq!(searches, [("The Weeknd Blinding Lights".to_string(), Filter::Songs)]);
    assert!(matches!(outcome, Answer::Approved { score: 100, .. }));
}

#[tokio::test]
async fn the_second_search_can_approve() {
    let src = source("Blinding Lights", "The Weeknd", 200000);
    let (outcome, searches) = cascade(&src, vec![Some(vec![]), Some(vec![track("x", "Blinding Lights", "The Weeknd", 200500)])]).await;
    assert_eq!(searches.len(), 2);
    assert_eq!(searches[1].1, Filter::Any);
    assert!(matches!(outcome, Answer::Approved { .. }));
}

#[tokio::test]
async fn nothing_found_runs_all_four_searches() {
    let src = source("Teardrop", "Massive Attack", 330000);
    let (outcome, searches) = cascade(&src, vec![Some(vec![]); 4]).await;
    let expected = vec![
        ("Massive Attack Teardrop".to_string(), Filter::Songs),
        ("Massive Attack Teardrop".to_string(), Filter::Any),
        ("Teardrop".to_string(), Filter::Songs),
        ("Massive Attack Teardrop".to_string(), Filter::Videos),
    ];
    assert_eq!(searches, expected);
    assert_eq!(outcome, Answer::Pending { reason: Reason::NoCandidates, score: None, proposed_track: None });
}

#[tokio::test]
async fn without_an_artist_step_three_is_skipped() {
    let src = source("Teardrop", "", 330000);
    let (_, searches) = cascade(&src, vec![Some(vec![]); 4]).await;
    assert_eq!(searches.iter().map(|s| s.1).collect::<Vec<_>>(), [Filter::Songs, Filter::Any, Filter::Videos]);
}

#[tokio::test]
async fn a_failed_search_is_reported() {
    let src = source("Teardrop", "Massive Attack", 330000);
    let (outcome, searches) = cascade(&src, vec![Some(vec![]), None, Some(vec![]), Some(vec![])]).await;
    assert_eq!(searches.len(), 4);
    assert!(matches!(outcome, Answer::Pending { reason: Reason::LookupFailed, .. }));
}

#[tokio::test]
async fn an_early_duration_mismatch_survives_unrelated_results() {
    let src = source("Levels", "Avicii", 199000);
    let long = track("v", "Levels", "Avicii", 259000);
    let unrelated = || Some(vec![track("u", "Something Else", "Another Artist", 199000)]);
    let (outcome, _) = cascade(&src, vec![Some(vec![long.clone()]), unrelated(), unrelated(), unrelated()]).await;
    match outcome {
        Answer::Pending { reason: Reason::DurationMismatch, proposed_track: Some(track), .. } => assert_eq!(track["id"], "v"),
        other => panic!("{other:?}"),
    }
}

/// A non-YouTube id.
#[tokio::test]
async fn approved_videos_get_their_thumbnail() {
    let src = source("Blinding Lights", "The Weeknd", 200000);
    let (outcome, _) = cascade(&src, vec![Some(vec![track("dQw4w9WgXcQ", "Blinding Lights", "The Weeknd", 200500)])]).await;
    let Answer::Approved { track: video, .. } = outcome else { panic!() };
    assert_eq!(video["cover"], json!({"url": "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg", "width": 480, "height": 360}));
    let (outcome, _) = cascade(&src, vec![Some(vec![track("sc:5", "Blinding Lights", "The Weeknd", 200500)])]).await;
    let Answer::Approved { track: other, .. } = outcome else { panic!() };
    assert!(other.get("cover").is_none());
}

/// Dropping the driver mid-search gives no outcome.
#[tokio::test]
async fn cancelling_mid_search_gives_no_outcome() {
    let src = source("Teardrop", "Massive Attack", 330000);
    let searches = Arc::new(Mutex::new(0));
    let counter = searches.clone();
    let driver = run(&src, move |_, _| {
        let counter = counter.clone();
        async move {
            let n = {
                let mut c = counter.lock().unwrap();
                *c += 1;
                *c
            };
            if n == 2 {
                std::future::pending::<()>().await;
            }
            Ok(Vec::new())
        }
    });
    let finished = tokio::time::timeout(std::time::Duration::from_millis(100), driver).await;
    assert!(finished.is_err(), "the cascade waits on step 2 and is dropped there");
    assert_eq!(*searches.lock().unwrap(), 2);
}

#[test]
fn next_answers_the_third_step() {
    let src = source("Teardrop", "Massive Attack", 330000);
    let steps = [
        Step { query: "Massive Attack Teardrop".into(), filter: Filter::Songs, failed: false, found: 1 },
        Step { query: "Massive Attack Teardrop".into(), filter: Filter::Any, failed: false, found: 0 },
    ];
    let candidates = [track("u", "Unrelated", "Someone", 100000)];
    assert_eq!(next(&src, &candidates, &steps).unwrap(), Answer::Search { query: "Teardrop".into(), filter: Filter::Songs });
    assert_eq!(plan(&src).len(), 4);
}

#[test]
fn next_refuses_inconsistent_requests() {
    let src = source("Teardrop", "Massive Attack", 330000);
    let wrong = [Step { query: "something else".into(), filter: Filter::Songs, failed: false, found: 0 }];
    assert!(next(&src, &[], &wrong).is_err());
    let miscounted = [Step { query: "Massive Attack Teardrop".into(), filter: Filter::Songs, failed: false, found: 2 }];
    assert!(next(&src, &[track("a", "x", "y", 1)], &miscounted).is_err());
    assert!(next(&source("  ", "x", 1), &[], &[]).is_err());
}

#[test]
fn answers_serialize_to_the_wire_shape() {
    let pending = Answer::Pending { reason: Reason::Ambiguous, score: Some(80), proposed_track: Some(json!({"id": "a"})) };
    assert_eq!(serde_json::to_value(&pending).unwrap(), json!({"status": "pending", "reason": "ambiguous_match", "score": 80, "proposedTrack": {"id": "a"}}));
    let search = Answer::Search { query: "q".into(), filter: Filter::Videos };
    assert_eq!(serde_json::to_value(&search).unwrap(), json!({"status": "search", "query": "q", "filter": "videos"}));
    let back: Answer = serde_json::from_value(serde_json::to_value(&pending).unwrap()).unwrap();
    assert_eq!(back, pending);
}

fn open() -> (tempfile::TempDir, nuvo_store::Connection) {
    let dir = tempfile::tempdir().unwrap();
    let conn = nuvo_store::open_connection(&dir.path().join("library.db"), &[5u8; 32], &dir.path().join("backups")).unwrap();
    (dir, conn)
}

const DAY: i64 = 86_400_000;

/// Remembered sources at the store level, with their expiry rules.
#[test]
fn memo_entries_expire_by_kind_and_version() {
    let (_dir, conn) = open();
    let src = source("Teardrop", "Massive Attack", 330400);
    assert_eq!(memo::key(&src), "teardrop|massive attack|330");
    let approved = Answer::Approved { track: json!({"id": "v"}), score: 97 };
    memo::put(&conn, &src, &approved, 0).unwrap();
    assert_eq!(memo::get(&conn, &src, 89 * DAY).unwrap(), Some(approved));
    assert_eq!(memo::get(&conn, &src, 91 * DAY).unwrap(), None);
    let pending = Answer::Pending { reason: Reason::LowConfidence, score: Some(60), proposed_track: None };
    memo::put(&conn, &src, &pending, 0).unwrap();
    assert!(memo::get(&conn, &src, DAY - 1).unwrap().is_some());
    assert_eq!(memo::get(&conn, &src, DAY + 1).unwrap(), None);
    memo::put(&conn, &src, &pending, 0).unwrap();
    nuvo_store::settings::set(&conn, memo::VERSION_KEY, &json!(memo::MATCHER_VERSION - 1)).unwrap();
    assert_eq!(memo::get(&conn, &src, 1).unwrap(), None, "a new matcher version drops the memo");
}

/// A transient lookup failure must not answer repeats for a day without searching again.
#[test]
fn a_failed_lookup_is_not_remembered() {
    let (_dir, conn) = open();
    let src = source("Teardrop", "Massive Attack", 330400);
    memo::put(&conn, &src, &Answer::Pending { reason: Reason::LookupFailed, score: None, proposed_track: None }, 0).unwrap();
    assert_eq!(memo::get(&conn, &src, 1).unwrap(), None);
}

#[test]
fn standins_are_kept_across_versions() {
    let (_dir, conn) = open();
    let approved = Answer::Approved { track: json!({"id": "dQw4w9WgXcQ", "title": "x"}), score: 91 };
    memo::put_standin(&conn, "sc:1", &approved, 0).unwrap();
    memo::put_standin(&conn, "sc:2", &Answer::Pending { reason: Reason::NoCandidates, score: None, proposed_track: None }, 0).unwrap();
    nuvo_store::settings::set(&conn, memo::VERSION_KEY, &json!(0)).unwrap();
    memo::get(&conn, &source("x", "y", 1), 0).unwrap();
    assert_eq!(memo::standin(&conn, "sc:1").unwrap(), Some(approved));
    assert_eq!(memo::standin(&conn, "sc:2").unwrap(), None);
}

#[test]
fn standins_and_memo_return_the_track_with_its_duration() {
    let (_dir, conn) = open();
    let src = source("Teardrop", "Massive Attack", 330000);
    let video = track("dQw4w9WgXcQ", "Teardrop", "Massive Attack", 329000);
    let approved = Answer::Approved { track: video.clone(), score: 97 };
    memo::put_standin(&conn, "sc:9", &approved, 0).unwrap();
    memo::put(&conn, &src, &approved, 0).unwrap();
    for found in [memo::standin(&conn, "sc:9").unwrap(), memo::get(&conn, &src, 1).unwrap()] {
        let Some(Answer::Approved { track, .. }) = found else { panic!("missing") };
        assert_eq!(track["durationMs"], 329000);
    }
}
