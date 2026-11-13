mod common;

use axum::http::StatusCode;
use nuvo_crypto::MemoryKeyStore;
use nuvo_net::fixture::{Fixture, Reply};
use serde_json::{Value, json};

fn track(id: &str, title: &str, artist: &str, ms: i64) -> Value {
    json!({"id": id, "title": title, "artists": [{"id": "a", "name": artist}], "durationMs": ms})
}

fn source() -> Value {
    json!({"title": "Teardrop", "artists": ["Massive Attack"], "durationMs": 330000})
}

#[tokio::test]
async fn evaluate_decides_without_the_network() {
    let core = common::core();
    let body = json!({"source": source(), "candidates": [track("dQw4w9WgXcQ", "Teardrop", "Massive Attack", 330500)]});
    let (status, answer) = common::call(&core.app, "POST", "/v1/match/evaluate", Some(body)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!((answer["status"].as_str(), answer["score"].as_i64()), (Some("approved"), Some(100)));
    assert_eq!(answer["track"]["cover"]["url"], "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg");
    let (_, answer) = common::call(&core.app, "POST", "/v1/match/evaluate", Some(json!({"source": source(), "candidates": []}))).await;
    assert_eq!(answer, json!({"status": "pending", "reason": "low_confidence_match"}));
}

#[tokio::test]
async fn oversized_and_blank_requests_are_refused() {
    let core = common::core();
    let many: Vec<Value> = (0..101).map(|i| track(&format!("c{i}"), "x", "y", 1000)).collect();
    let (status, body) = common::call(&core.app, "POST", "/v1/match/evaluate", Some(json!({"source": source(), "candidates": many}))).await;
    assert_eq!((status, body["code"].as_str()), (StatusCode::BAD_REQUEST, Some("INVALID_INPUT")));
    let (status, _) = common::call(&core.app, "POST", "/v1/match/next", Some(json!({"source": {"title": "  "}}))).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn next_asks_for_the_third_search() {
    let core = common::core();
    let steps = json!([
        {"query": "Massive Attack Teardrop", "filter": "songs", "failed": false, "found": 1},
        {"query": "Massive Attack Teardrop", "filter": "any", "failed": false, "found": 0}
    ]);
    let body = json!({"source": source(), "candidates": [track("u", "Unrelated", "Someone", 100000)], "steps": steps});
    let (status, answer) = common::call(&core.app, "POST", "/v1/match/next", Some(body)).await;
    assert_eq!((status, answer), (StatusCode::OK, json!({"status": "search", "query": "Teardrop", "filter": "songs"})));
}

#[tokio::test]
async fn a_matched_source_is_remembered() {
    let core = common::core();
    let (_, first) = common::call(&core.app, "POST", "/v1/match/next", Some(json!({"source": source()}))).await;
    assert_eq!(first["status"], "search");
    let steps = json!([{"query": "Massive Attack Teardrop", "filter": "songs", "failed": false, "found": 1}]);
    let body = json!({"source": source(), "candidates": [track("v1", "Teardrop", "Massive Attack", 330000)], "steps": steps});
    let (_, done) = common::call(&core.app, "POST", "/v1/match/next", Some(body)).await;
    assert_eq!(done["status"], "approved");
    let (_, again) = common::call(&core.app, "POST", "/v1/match/next", Some(json!({"source": source()}))).await;
    assert_eq!(again, done, "answered from the memo, no search requested");
}

#[tokio::test]
async fn stand_ins_are_remembered_per_track() {
    let core = common::core();
    let src = json!({"title": "Night Drive", "artists": ["dj"], "durationMs": 200000});
    let steps = json!([{"query": "dj Night Drive", "filter": "songs", "failed": false, "found": 1}]);
    let body = json!({"source": src, "candidates": [track("dQw4w9WgXcQ", "Night Drive", "dj", 200000)], "steps": steps, "standInFor": "sc:5"});
    let (_, done) = common::call(&core.app, "POST", "/v1/match/next", Some(body)).await;
    assert_eq!(done["status"], "approved");
    let other_source = json!({"title": "Renamed upload", "artists": [], "durationMs": 1});
    let (_, again) = common::call(&core.app, "POST", "/v1/match/next", Some(json!({"source": other_source, "standInFor": "sc:5"}))).await;
    assert_eq!(again["track"]["id"], "dQw4w9WgXcQ");
}

#[tokio::test]
async fn a_locked_library_still_matches_but_remembers_nothing() {
    let first = common::core();
    let locked = common::boot(first.dir, MemoryKeyStore::with_key([9u8; 32]), "http://127.0.0.1:9");
    assert!(locked.state.is_locked());
    let (status, answer) = common::call(&locked.app, "POST", "/v1/match/next", Some(json!({"source": source()}))).await;
    assert_eq!((status, answer["status"].as_str()), (StatusCode::OK, Some("search")));
}

const ID_A: &str = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA1";

async fn sc_fixture(results: Value) -> Fixture {
    let fx = Fixture::start().await;
    fx.on("https://soundcloud.com/", Reply::bytes("text/html", "<script src=\"https://a-v2.sndcdn.com/assets/app.js\"></script>"));
    fx.on("https://a-v2.sndcdn.com/assets/app.js", Reply::bytes("application/javascript", format!("({{client_id:\"{ID_A}\"}})")));
    fx.on("https://api-v2.soundcloud.com/search/tracks", Reply::json(json!({"collection": results})));
    fx
}

fn sc_record(id: u64) -> Value {
    json!({"id": id, "kind": "track", "title": "Teardrop", "duration": 330200, "user": {"id": 9, "username": "Massive Attack"}})
}

fn approved_body(exclude: Value) -> Value {
    json!({"target": "soundcloud", "source": source(), "exclude": exclude})
}

#[tokio::test]
async fn approved_runs_the_cascade_against_soundcloud() {
    let fx = sc_fixture(json!([sc_record(1)])).await;
    let core = common::boot_net(tempfile::tempdir().unwrap(), MemoryKeyStore::default(), &fx.base);
    let (status, answer) = common::call(&core.app, "POST", "/v1/match/approved", Some(approved_body(json!([])))).await;
    assert_eq!((status, answer["status"].as_str(), answer["track"]["id"].as_str()), (StatusCode::OK, Some("approved"), Some("sc:1")));
    let (_, answer) = common::call(&core.app, "POST", "/v1/match/approved", Some(approved_body(json!(["sc:1"])))).await;
    assert_eq!(answer, json!({"status": "pending", "reason": "no_catalog_candidates"}));
}

#[tokio::test]
async fn approved_validates_its_request() {
    let core = common::core();
    for body in [
        json!({"target": "youtube", "source": source()}),
        json!({"target": "soundcloud", "source": {"title": " "}}),
        approved_body(json!((0..101).map(|i| format!("sc:{i}")).collect::<Vec<_>>())),
    ] {
        let (status, answer) = common::call(&core.app, "POST", "/v1/match/approved", Some(body)).await;
        assert_eq!((status, answer["code"].as_str()), (StatusCode::BAD_REQUEST, Some("INVALID_INPUT")));
    }
}

#[tokio::test]
async fn rank_orders_search_songs_and_keeps_one_copy() {
    let core = common::core();
    let mut official = track("sc:1", "Numb", "Linkin Park", 187_000);
    official["verified"] = json!(true);
    let songs = json!([
        track("sc:2", "Numb (Slowed + Reverb)", "someone", 220_000),
        track("abcdefghijk", "Numb", "Linkin Park", 187_000),
        official,
        track("sc:3", "Numb / Encore", "Linkin Park", 206_000),
    ]);
    let (status, answer) = common::call(&core.app, "POST", "/v1/match/rank", Some(json!({"query": "linkin park numb", "songs": songs}))).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(answer["ids"], json!(["abcdefghijk", "sc:3", "sc:2"]));
    let many: Vec<Value> = (0..201).map(|i| track(&format!("c{i}"), "x", "y", 1000)).collect();
    let (status, _) = common::call(&core.app, "POST", "/v1/match/rank", Some(json!({"query": "x", "songs": many}))).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}
