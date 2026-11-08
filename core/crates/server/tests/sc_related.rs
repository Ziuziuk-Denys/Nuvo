mod common;

use axum::Router;
use axum::http::StatusCode;
use nuvo_crypto::MemoryKeyStore;
use nuvo_net::fixture::{Fixture, Reply};
use serde_json::{Value, json};

const ID_A: &str = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA1";

fn api(path: &str) -> String {
    format!("https://api-v2.soundcloud.com/{path}")
}

/// SoundCloud with a discoverable client id; `search` answers every track search.
async fn soundcloud(search: Value) -> Fixture {
    let fx = Fixture::start().await;
    fx.on("https://soundcloud.com/", Reply::bytes("text/html", "<script src=\"https://a-v2.sndcdn.com/assets/app.js\"></script>"));
    fx.on("https://a-v2.sndcdn.com/assets/app.js", Reply::bytes("application/javascript", format!("({{client_id:\"{ID_A}\"}})")));
    fx.on(&api("search/tracks"), Reply::json(json!({"collection": search})));
    fx
}

fn record(id: u64, title: &str, user: u64, artist: &str, duration: i64) -> Value {
    json!({"id": id, "kind": "track", "title": title, "duration": duration, "user": {"id": user, "username": artist}})
}

/// Six related tracks by six different artists, ids `<from>00`..`<from>05`.
fn related(from: u64) -> Value {
    json!({"collection": (0..6).map(|i| record(from * 100 + i, &format!("Near {i}"), 500 + i, &format!("Artist {i}"), 200_000)).collect::<Vec<_>>()})
}

async fn finish(app: &Router, id: &str, title: &str, artist: &str, duration: i64) {
    let snapshot = json!({"id": id, "title": title, "artists": [{"id": artist, "name": artist}], "durationMs": duration});
    let body = json!({
        "listeningSessionId": "s1", "trackId": id, "trackSnapshot": snapshot, "playedDurationMs": duration,
        "trackDurationMs": duration, "completed": true, "startedAt": nuvo_store::now_ms() - 60_000
    });
    assert_eq!(common::call(app, "POST", "/v1/me/playback/events", Some(body)).await.0, StatusCode::NO_CONTENT);
}

async fn seeds(app: &Router, source: &str) -> Vec<String> {
    let (_, body) = common::call(app, "GET", &format!("/v1/recs/seeds?source={source}"), None).await;
    serde_json::from_value(body["seeds"].clone()).unwrap()
}

async fn job(app: &Router, seed: &str) -> (StatusCode, Value) {
    common::call(app, "POST", "/v1/recs/pool/sc-related", Some(json!({"seedId": seed}))).await
}

#[tokio::test]
async fn a_youtube_seed_reaches_its_soundcloud_upload_and_feeds_new_to_you() {
    let fx = soundcloud(json!([record(77, "Teardrop", 9, "Massive Attack", 330_200)])).await;
    fx.on(&api("tracks/77/related"), Reply::json(related(77)));
    let core = common::boot_net(tempfile::tempdir().unwrap(), MemoryKeyStore::default(), &fx.base);
    finish(&core.app, "tearDrop001", "Teardrop", "Massive Attack", 330_200).await;
    assert_eq!(seeds(&core.app, "sc_related").await, ["tearDrop001"]);

    assert_eq!(job(&core.app, "tearDrop001").await, (StatusCode::OK, json!({"stored": 6})));
    assert!(seeds(&core.app, "sc_related").await.is_empty(), "fresh for a day");
    assert_eq!(seeds(&core.app, "yt_radio").await, ["tearDrop001"], "the YouTube radio is still due");

    let (_, mixes) = common::call(&core.app, "GET", "/v1/me/recommendations/daily-mixes", None).await;
    let discover = mixes["items"].as_array().unwrap().iter().find(|m| m["id"] == "daily-mix-discover").expect("New to you");
    let ids: Vec<&str> = discover["tracks"].as_array().unwrap().iter().map(|t| t["id"].as_str().unwrap()).collect();
    assert!(!ids.is_empty() && ids.iter().all(|id| id.starts_with("sc:77")), "{ids:?}");
    assert!(fx.hosts().iter().all(|host| nuvo_soundcloud::host_allowed(host)), "only allowed hosts: {:?}", fx.hosts());
}

#[tokio::test]
async fn a_soundcloud_seed_skips_the_search_and_a_miss_rests() {
    let fx = soundcloud(json!([record(5, "Something else", 1, "Nobody", 100_000)])).await;
    fx.on(&api("tracks/31/related"), Reply::json(related(31)));
    let core = common::boot_net(tempfile::tempdir().unwrap(), MemoryKeyStore::default(), &fx.base);
    finish(&core.app, "sc:31", "Cloud", "Cloudy", 200_000).await;
    finish(&core.app, "ytNoMatch01", "Teardrop", "Massive Attack", 330_200).await;

    assert_eq!(job(&core.app, "sc:31").await, (StatusCode::OK, json!({"stored": 6})));
    assert_eq!(fx.count(&api("search/tracks")), 0, "a SoundCloud seed needs no search");
    assert_eq!(job(&core.app, "ytNoMatch01").await, (StatusCode::OK, json!({"stored": 0})));
    assert!(seeds(&core.app, "sc_related").await.is_empty(), "a hit rests a day, a miss a week");
}

#[tokio::test]
async fn soundcloud_out_of_reach_stores_nothing() {
    let fx = soundcloud(json!([])).await;
    fx.on(&api("search/tracks"), Reply::status(500));
    let core = common::boot_net(tempfile::tempdir().unwrap(), MemoryKeyStore::default(), &fx.base);
    finish(&core.app, "tearDrop001", "Teardrop", "Massive Attack", 330_200).await;

    let (status, body) = job(&core.app, "tearDrop001").await;
    assert_eq!((status, body["code"].as_str()), (StatusCode::SERVICE_UNAVAILABLE, Some("SC_UNAVAILABLE")));
    assert_eq!(seeds(&core.app, "sc_related").await, ["tearDrop001"], "still due at the next idle minute");
    assert_eq!(job(&core.app, "unknown").await.0, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn a_failed_related_read_is_not_a_miss_but_an_empty_answer_is() {
    let fx = soundcloud(json!([record(77, "Teardrop", 9, "Massive Attack", 330_200)])).await;
    fx.on(&api("tracks/77/related"), Reply::status(500));
    fx.on(&api("tracks/31/related"), Reply::json(json!({"collection": []})));
    let core = common::boot_net(tempfile::tempdir().unwrap(), MemoryKeyStore::default(), &fx.base);
    finish(&core.app, "tearDrop001", "Teardrop", "Massive Attack", 330_200).await;
    finish(&core.app, "sc:31", "Cloud", "Cloudy", 200_000).await;

    assert_eq!(job(&core.app, "tearDrop001").await.0, StatusCode::BAD_GATEWAY);
    assert!(seeds(&core.app, "sc_related").await.contains(&"tearDrop001".to_string()), "a failure leaves the seed due");

    assert_eq!(job(&core.app, "sc:31").await, (StatusCode::OK, json!({"stored": 0})));
    assert!(!seeds(&core.app, "sc_related").await.contains(&"sc:31".to_string()), "a real empty list rests");
}
