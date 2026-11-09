mod common;

use axum::http::StatusCode;
use serde_json::{Value, json};

fn snapshot(id: &str, title: &str, artist: &str) -> Value {
    json!({"id": id, "title": title, "artists": [{"id": artist, "name": artist}], "durationMs": 200000})
}

fn play(id: &str, extra: Value) -> Value {
    let mut body = json!({
        "listeningSessionId": "s1", "trackId": id, "trackSnapshot": snapshot(id, id, "Artist"),
        "playedDurationMs": 200000, "trackDurationMs": 200000, "completed": true
    });
    body.as_object_mut().unwrap().extend(extra.as_object().unwrap().clone());
    body
}

#[tokio::test]
async fn forward_seeks_are_stored_and_short_plays_are_hidden_from_history() {
    let core = common::core();
    let events = [
        play("quick", json!({"completed": false, "endReason": "skip", "playedDurationMs": 1000, "startedAt": 1_000})),
        play("skimmed", json!({"seekForwardMs": 42000.4, "startedAt": 2_000})),
        play("almost", json!({"completed": false, "endReason": "next", "playedDurationMs": 2999, "startedAt": 3_000})),
        play("old-client", json!({"startedAt": 4_000})),
    ];
    for event in events {
        assert_eq!(common::call(&core.app, "POST", "/v1/me/playback/events", Some(event)).await.0, StatusCode::NO_CONTENT);
    }
    let stored = core.state.data().unwrap().db.call(|c| {
        let mut stmt = c.prepare("SELECT track_id, seek_forward_ms FROM play_events ORDER BY started_at")?;
        let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))?.collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }).await.unwrap();
    let expected: Vec<(String, i64)> = [("quick", 0), ("skimmed", 42000), ("almost", 0), ("old-client", 0)].map(|(t, ms)| (t.to_string(), ms)).into();
    assert_eq!(stored, expected, "every play is recorded, even a 1 s skip");

    let (_, history) = common::call(&core.app, "GET", "/v1/me/history?limit=10", None).await;
    let ids: Vec<&str> = history["items"].as_array().unwrap().iter().map(|i| i["track"]["id"].as_str().unwrap()).collect();
    assert_eq!(ids, ["old-client", "skimmed"], "plays under 3 s stay out of History");
}

fn candidates(n: usize) -> Vec<Value> {
    (0..n).map(|i| snapshot(&format!("c{i}"), &format!("Candidate {i}"), &format!("Artist {i}"))).collect()
}

#[tokio::test]
async fn rank_returns_a_batch_of_ten_with_reasons() {
    let core = common::core();
    let body = json!({"context": "radio:seed", "seeds": ["seed"], "candidates": candidates(14), "recent": [], "sessionId": "s1", "limit": 10, "tzOffsetMin": -120});
    let (status, res) = common::call(&core.app, "POST", "/v1/recs/rank", Some(body)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(res["items"].as_array().unwrap().len(), 10);
    assert!(res["batchId"].is_string());
    assert!(res["items"][0]["reason"]["kind"].is_string());
    assert_eq!(res["signals"], json!({"liked": 0, "skipped": 0, "scrubbed": 0}));
    assert_eq!(res["dropped"], 0);

    let (status, err) = common::call(&core.app, "POST", "/v1/recs/rank", Some(json!({"context": "", "candidates": []}))).await;
    assert_eq!((status, err["code"].as_str()), (StatusCode::BAD_REQUEST, Some("INVALID_INPUT")));
    let (status, _) = common::call(&core.app, "POST", "/v1/recs/rank", Some(json!({"context": "radio:x"}))).await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "candidates are required");
}

#[tokio::test]
async fn not_interested_blocklist_and_undo() {
    let core = common::core();
    let body = json!({"trackId": "c3", "scope": "exact", "track": snapshot("c3", "Candidate 3", "Artist 3")});
    let (status, res) = common::call(&core.app, "POST", "/v1/recs/not-interested", Some(body)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(res["offerHideArtist"], false);
    let id = res["suppressionId"].as_i64().unwrap();

    let (_, list) = common::call(&core.app, "GET", "/v1/recs/suppressions", None).await;
    assert_eq!(list["items"][0]["scope"], "exact");
    assert_eq!(list["items"][0]["track"]["id"], "c3");
    assert!(list["items"][0]["fadesAt"].is_null(), "exact never fades");

    let rank = json!({"context": "radio:x", "candidates": candidates(5)});
    let (_, res) = common::call(&core.app, "POST", "/v1/recs/rank", Some(rank.clone())).await;
    assert!(res["items"].as_array().unwrap().iter().all(|i| i["track"]["id"] != "c3"));
    assert_eq!(res["dropped"], 1);

    assert_eq!(common::call(&core.app, "DELETE", &format!("/v1/recs/suppressions/{id}"), None).await.0, StatusCode::NO_CONTENT);
    assert_eq!(common::call(&core.app, "DELETE", &format!("/v1/recs/suppressions/{id}"), None).await.0, StatusCode::NOT_FOUND);
    assert_eq!(common::call(&core.app, "DELETE", "/v1/recs/suppressions/abc", None).await.0, StatusCode::NOT_FOUND);
    let (_, res) = common::call(&core.app, "POST", "/v1/recs/rank", Some(json!({"context": "radio:y", "candidates": candidates(5)}))).await;
    assert_eq!(res["dropped"], 0, "undo restores at once");

    let (status, _) = common::call(&core.app, "POST", "/v1/recs/not-interested", Some(json!({"trackId": "c3", "scope": "album"}))).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let (status, _) = common::call(&core.app, "POST", "/v1/recs/not-interested", Some(json!({"trackId": "never-seen", "scope": "work"}))).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn pool_refresh_and_seeds() {
    let core = common::core();
    let like = json!({"track": snapshot("fav", "Favourite", "Artist")});
    assert_eq!(common::call(&core.app, "PUT", "/v1/me/library/tracks/fav", Some(like)).await.0, StatusCode::NO_CONTENT);
    let (_, seeds) = common::call(&core.app, "GET", "/v1/recs/seeds", None).await;
    assert_eq!(seeds, json!({"seeds": ["fav"]}));

    let pool = json!({"seedId": "fav", "source": "yt_radio", "items": candidates(20)});
    assert_eq!(common::call(&core.app, "PUT", "/v1/recs/pool", Some(pool)).await.0, StatusCode::NO_CONTENT);
    let (_, seeds) = common::call(&core.app, "GET", "/v1/recs/seeds", None).await;
    assert_eq!(seeds, json!({"seeds": []}), "a fresh list is not asked for again within 24 h");
    let (_, seeds) = common::call(&core.app, "GET", "/v1/recs/seeds?source=sc_related", None).await;
    assert_eq!(seeds, json!({"seeds": ["fav"]}), "a YouTube list leaves the SoundCloud list due");

    let too_many = json!({"seedId": "fav", "source": "yt_radio", "items": candidates(101)});
    assert_eq!(common::call(&core.app, "PUT", "/v1/recs/pool", Some(too_many)).await.0, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn taste_exclusions_round_trip() {
    let core = common::core();
    assert_eq!(common::call(&core.app, "PUT", "/v1/recs/excluded/playlist/p1", None).await.0, StatusCode::NO_CONTENT);
    assert_eq!(common::call(&core.app, "PUT", "/v1/recs/excluded/track/t1", None).await.0, StatusCode::NO_CONTENT);
    let (_, list) = common::call(&core.app, "GET", "/v1/recs/excluded", None).await;
    assert_eq!(list, json!({"items": [{"kind": "playlist", "id": "p1"}, {"kind": "track", "id": "t1"}]}));
    assert_eq!(common::call(&core.app, "DELETE", "/v1/recs/excluded/playlist/p1", None).await.0, StatusCode::NO_CONTENT);
    assert_eq!(common::call(&core.app, "PUT", "/v1/recs/excluded/album/a1", None).await.0, StatusCode::BAD_REQUEST);
    let (_, list) = common::call(&core.app, "GET", "/v1/recs/excluded", None).await;
    assert_eq!(list["items"].as_array().unwrap().len(), 1);
}

#[tokio::test]
async fn a_scrubbed_skip_reaches_the_blocklist_through_the_events_route() {
    let core = common::core();
    let event = play("skimmed", json!({"completed": false, "endReason": "skip", "playedDurationMs": 70000, "seekForwardMs": 50000}));
    assert_eq!(common::call(&core.app, "POST", "/v1/me/playback/events", Some(event)).await.0, StatusCode::NO_CONTENT);
    let (_, list) = common::call(&core.app, "GET", "/v1/recs/suppressions", None).await;
    assert_eq!(list["items"][0]["origin"], "scrub_skip");
    assert_eq!(list["items"][0]["scope"], "work");
    assert!(list["items"][0]["fadesAt"].is_string());
}

#[tokio::test]
async fn a_re_sent_play_teaches_once() {
    let core = common::core();
    let body = json!({"trackId": "song", "scope": "work", "track": snapshot("song", "song", "Artist")});
    assert_eq!(common::call(&core.app, "POST", "/v1/recs/not-interested", Some(body)).await.0, StatusCode::OK);
    let event = play("song", json!({"startedAt": 1_700_000_000_000i64, "context": {"type": "library"}}));
    for _ in 0..2 {
        assert_eq!(common::call(&core.app, "POST", "/v1/me/playback/events", Some(event.clone())).await.0, StatusCode::NO_CONTENT);
    }
    let (_, list) = common::call(&core.app, "GET", "/v1/recs/suppressions", None).await;
    let work = list["items"].as_array().unwrap().iter().find(|i| i["scope"] == "work").unwrap();
    let penalty = work["penalty"].as_f64().unwrap();
    assert!((0.45..=0.5).contains(&penalty), "halved once, got {penalty}");
}

#[tokio::test]
async fn cold_start_asks_until_starters_or_taste_exist() {
    let core = common::core();
    assert_eq!(common::call(&core.app, "GET", "/v1/recs/start", None).await, (StatusCode::OK, json!({"needed": true})));
    let tracks: Vec<Value> = (0..3).map(|i| snapshot(&format!("st{i}"), &format!("Star {i}"), "Sol")).collect();
    assert_eq!(common::call(&core.app, "PUT", "/v1/recs/starters", Some(json!({"tracks": tracks}))).await.0, StatusCode::NO_CONTENT);
    assert_eq!(common::call(&core.app, "GET", "/v1/recs/start", None).await.1, json!({"needed": false}));
    let (_, seeds) = common::call(&core.app, "GET", "/v1/recs/seeds", None).await;
    assert_eq!(seeds, json!({"seeds": ["st0", "st1", "st2"]}));
    assert_eq!(common::call(&core.app, "PUT", "/v1/recs/starters", Some(json!({"tracks": []}))).await.0, StatusCode::BAD_REQUEST);
}
