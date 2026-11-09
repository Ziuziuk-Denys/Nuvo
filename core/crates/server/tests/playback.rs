mod common;

use axum::http::StatusCode;
use serde_json::{Value, json};

fn event(track_id: &str, extra: Value) -> Value {
    let mut body = json!({
        "playbackSessionId": "p", "listeningSessionId": "s", "trackId": track_id,
        "trackSnapshot": {"id": track_id, "title": track_id, "artists": [{"id": "a", "name": "Artist"}], "album": {"id": "al", "title": "Album"}, "durationMs": 200000},
        "playedDurationMs": 200000.4, "trackDurationMs": 200000, "completionRate": 1, "completed": true,
        "skipped": false, "loopCount": 0, "hasSeekBackward": false, "context": {"type": "playlist", "id": "p1"}
    });
    body.as_object_mut().unwrap().extend(extra.as_object().unwrap().clone());
    body
}

#[tokio::test]
async fn events_feed_history_and_explore() {
    let core = common::core();
    assert_eq!(common::call(&core.app, "POST", "/v1/me/playback/events", Some(event("a", json!({})))).await.0, StatusCode::NO_CONTENT);
    assert_eq!(common::call(&core.app, "POST", "/v1/me/playback/events", Some(event("a", json!({"listeningSessionId": "s2"})))).await.0, StatusCode::NO_CONTENT);
    assert_eq!(common::call(&core.app, "POST", "/v1/me/playback/events", Some(event("b", json!({})))).await.0, StatusCode::NO_CONTENT);
    assert_eq!(common::call(&core.app, "POST", "/v1/me/playback/events", Some(event("c", json!({})))).await.0, StatusCode::NO_CONTENT);
    let extended = event("d", json!({"endReason": "next", "positionInSession": 4, "tzOffsetMin": -120}));
    assert_eq!(common::call(&core.app, "POST", "/v1/me/playback/events", Some(extended)).await.0, StatusCode::NO_CONTENT);

    let (_, history) = common::call(&core.app, "GET", "/v1/me/history?limit=60", None).await;
    assert_eq!(history["items"].as_array().unwrap().len(), 5);
    assert_eq!(history["items"][1]["context"], json!({"type": "playlist", "id": "p1"}));

    let (_, popular) = common::call(&core.app, "GET", "/v1/explore/popular?window=7d&limit=50", None).await;
    assert_eq!(popular["items"][0]["track"]["id"], "a");
    assert_eq!(popular["items"][0]["playCount"], 2);
    assert_eq!(popular["window"], "7d");

    let (_, albums) = common::call(&core.app, "GET", "/v1/explore/popular/albums?window=7d&limit=40", None).await;
    assert_eq!(albums["items"][0]["id"], "al");

    let (_, mixes) = common::call(&core.app, "GET", "/v1/me/recommendations/daily-mixes", None).await;
    assert_eq!(mixes["items"][0]["title"], "For you");
    assert!(mixes["generatedAt"].is_string());

    let (status, saved) = common::call(&core.app, "GET", "/v1/explore/most-saved?type=all&limit=20", None).await;
    assert_eq!((status, saved["items"].clone()), (StatusCode::OK, json!([])));
}

#[tokio::test]
async fn bad_inputs_are_rejected_cleanly() {
    let core = common::core();
    let (status, body) = common::call(&core.app, "GET", "/v1/explore/popular?window=1y", None).await;
    assert_eq!((status, body["code"].as_str()), (StatusCode::BAD_REQUEST, Some("INVALID_INPUT")));
    let (status, _) = common::call(&core.app, "POST", "/v1/me/playback/events", Some(json!({"trackId": "x"}))).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn radio_defers_to_the_client() {
    let core = common::core();
    assert_eq!(common::call(&core.app, "GET", "/v1/tracks/x/radio?k=20", None).await.0, StatusCode::NOT_FOUND);
    assert_eq!(common::call(&core.app, "POST", "/v1/tracks/x/radio", Some(json!({"history": ["a"]}))).await.0, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn history_filter_chips() {
    let core = common::core();
    common::call(&core.app, "POST", "/v1/me/playback/events", Some(event("a", json!({})))).await;
    common::call(&core.app, "POST", "/v1/me/playback/events", Some(event("b", json!({"completed": false, "skipped": true})))).await;
    let (_, skipped) = common::call(&core.app, "GET", "/v1/me/history?limit=30&filter=skipped", None).await;
    assert_eq!(skipped["items"].as_array().unwrap().len(), 1);
    assert_eq!(skipped["items"][0]["track"]["id"], "b");
    let (_, completed) = common::call(&core.app, "GET", "/v1/me/history?filter=completed", None).await;
    assert_eq!(completed["items"][0]["track"]["id"], "a");
    assert_eq!(common::call(&core.app, "GET", "/v1/me/history?filter=all", None).await.1["items"].as_array().unwrap().len(), 2);
    assert_eq!(common::call(&core.app, "GET", "/v1/me/history?filter=bogus", None).await.0, StatusCode::BAD_REQUEST);
}

fn play(id: &str, session: &str, started_at: i64) -> Value {
    event(id, json!({"listeningSessionId": session, "startedAt": started_at, "tzOffsetMin": -180, "source": "cache", "endReason": "complete"}))
}

#[tokio::test]
async fn stats_routes_answer_from_real_events() {
    let core = common::core();
    let now = nuvo_store::now_ms();
    for (index, id) in ["a", "a", "b"].iter().enumerate() {
        assert_eq!(common::call(&core.app, "POST", "/v1/me/playback/events", Some(play(id, &format!("s{index}"), now - 1000 * index as i64))).await.0, StatusCode::NO_CONTENT);
    }
    let (status, overview) = common::call(&core.app, "GET", "/v1/stats/overview?tzOffsetMin=-180", None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(overview["totals"]["plays"], 3);
    assert_eq!(overview["top"]["tracks"][0]["id"], "a");
    assert_eq!(overview["top"]["tracks"][0]["track"]["id"], "a");
    assert_eq!(overview["origins"][0]["kind"], "cache");
    assert_eq!(overview["currentStreak"], 1);

    let key = overview["top"]["artists"][0]["id"].as_str().unwrap().to_string();
    let (_, track) = common::call(&core.app, "GET", "/v1/stats/tracks/a", None).await;
    assert_eq!(track["plays"], 2);
    let (_, artist) = common::call(&core.app, "GET", &format!("/v1/stats/artists/{key}"), None).await;
    assert_eq!(artist["plays"], 3);
    assert_eq!(common::call(&core.app, "GET", "/v1/stats/tracks/nope", None).await.0, StatusCode::NOT_FOUND);

    assert_eq!(common::call(&core.app, "POST", "/v1/me/playback/events", Some(play("c", "s9", now + 1000))).await.0, StatusCode::NO_CONTENT);
    assert_eq!(common::call(&core.app, "GET", "/v1/stats/overview?tzOffsetMin=-180", None).await.1["totals"]["plays"], 4);

    let bad = |route: &str| {
        let app = core.app.clone();
        let route = route.to_string();
        async move { common::call(&app, "GET", &route, None).await.0 }
    };
    assert_eq!(bad("/v1/stats/overview?from=2026-07-01").await, StatusCode::BAD_REQUEST);
    assert_eq!(bad("/v1/stats/overview?from=2026-02-30&to=2026-03-01").await, StatusCode::BAD_REQUEST);
    assert_eq!(bad("/v1/stats/overview?from=2026-07-02&to=2026-07-01").await, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn stats_export_lists_the_events_as_json_and_csv() {
    let core = common::core();
    let now = nuvo_store::now_ms();
    common::call(&core.app, "POST", "/v1/me/playback/events", Some(play("a", "s1", now))).await;
    let (status, json_body) = common::call(&core.app, "GET", "/v1/fs/export/stats?format=json", None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json_body["kind"], "nuvo-listening");
    assert_eq!(json_body["events"][0]["trackId"], "a");
    assert_eq!(json_body["events"][0]["source"], "cache");
    assert_eq!(common::call(&core.app, "GET", "/v1/fs/export/stats?format=xml", None).await.0, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn deleting_stats_really_deletes_and_recommendations_keep_answering() {
    let core = common::core();
    let now = nuvo_store::now_ms();
    for (index, id) in ["a", "b"].iter().enumerate() {
        common::call(&core.app, "POST", "/v1/me/playback/events", Some(play(id, "s", now + index as i64))).await;
    }
    assert_eq!(common::call(&core.app, "GET", "/v1/stats/overview?tzOffsetMin=-180", None).await.1["totals"]["plays"], 2);
    let (status, deleted) = common::call(&core.app, "POST", "/v1/stats/delete", Some(json!({}))).await;
    assert_eq!((status, deleted["events"].clone()), (StatusCode::OK, json!(2)));
    assert_eq!(common::call(&core.app, "GET", "/v1/stats/overview?tzOffsetMin=-180", None).await.1["totals"]["plays"], 0);
    assert_eq!(common::call(&core.app, "GET", "/v1/me/history", None).await.1["items"], json!([]));
    assert_eq!(common::call(&core.app, "GET", "/v1/me/recommendations/daily-mixes", None).await.0, StatusCode::OK);
    let (status, ranked) = common::call(&core.app, "POST", "/v1/recs/rank", Some(json!({"context": "continue:queue", "seeds": [], "candidates": [], "limit": 5}))).await;
    assert_eq!((status, ranked["items"].clone()), (StatusCode::OK, json!([])));
    assert_eq!(common::call(&core.app, "POST", "/v1/stats/delete", Some(json!({"from": "2026-07-01"}))).await.0, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn a_paused_collection_records_nothing_until_it_resumes() {
    let core = common::core();
    let now = nuvo_store::now_ms();
    assert_eq!(common::call(&core.app, "GET", "/v1/stats/collection", None).await.1["paused"], false);
    assert_eq!(common::call(&core.app, "PUT", "/v1/stats/collection", Some(json!({"paused": true}))).await.1["paused"], true);
    assert_eq!(common::call(&core.app, "POST", "/v1/me/playback/events", Some(play("a", "s", now))).await.0, StatusCode::NO_CONTENT);
    assert_eq!(common::call(&core.app, "GET", "/v1/stats/overview?tzOffsetMin=-180", None).await.1["totals"]["plays"], 0);
    common::call(&core.app, "PUT", "/v1/stats/collection", Some(json!({"paused": false}))).await;
    common::call(&core.app, "POST", "/v1/me/playback/events", Some(play("a", "s", now + 1))).await;
    assert_eq!(common::call(&core.app, "GET", "/v1/stats/overview?tzOffsetMin=-180", None).await.1["totals"]["plays"], 1);
}
