mod common;

use std::collections::VecDeque;
use std::path::Path;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use axum::extract::State;
use axum::http::StatusCode;
use axum::routing::post;
use axum::{Json, Router};
use http_body_util::BodyExt;
use nuvo_crypto::MemoryKeyStore;
use serde_json::{Value, json};
use tower::ServiceExt;

#[derive(Clone)]
struct Mock {
    replies: Arc<Mutex<VecDeque<Value>>>,
    hits: Arc<AtomicUsize>,
    delay: Duration,
}

async fn mock_shazam(replies: Vec<Value>, delay: Duration) -> (String, Arc<AtomicUsize>) {
    let mock = Mock { replies: Arc::new(Mutex::new(replies.into())), hits: Arc::default(), delay };
    let hits = mock.hits.clone();
    let app = Router::new()
        .route(
            "/discovery/v5/{*rest}",
            post(|State(mock): State<Mock>| async move {
                mock.hits.fetch_add(1, Ordering::SeqCst);
                tokio::time::sleep(mock.delay).await;
                let reply = mock.replies.lock().unwrap().pop_front().unwrap_or_else(|| json!({"matches": []}));
                Json(reply)
            }),
        )
        .with_state(mock);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    (format!("http://{addr}"), hits)
}

fn found() -> Value {
    json!({
        "matches": [{"id": "1", "offset": 92.9}],
        "track": {"key": "53982678", "title": "I Will Survive", "subtitle": "Gloria Gaynor", "genres": {"primary": "Pop"},
                  "images": {"coverarthq": "https://is1-ssl.mzstatic.com/x/400x400cc.jpg"}}
    })
}

fn write_wav(path: &Path, seconds: u32) {
    let rate = 16_000u32;
    let frames = rate * seconds;
    let tone = |n: u32, hz: f32| {
        let envelope = if (n / 4000).is_multiple_of(2) { 1.0 } else { 0.1 };
        (envelope * 8000.0 * (n as f32 * hz * std::f32::consts::TAU / rate as f32).sin()) as i16
    };
    let mut bytes = Vec::with_capacity(44 + frames as usize * 4);
    bytes.extend_from_slice(b"RIFF");
    bytes.extend_from_slice(&(36 + frames * 4).to_le_bytes());
    bytes.extend_from_slice(b"WAVEfmt ");
    bytes.extend_from_slice(&16u32.to_le_bytes());
    bytes.extend_from_slice(&1u16.to_le_bytes());
    bytes.extend_from_slice(&2u16.to_le_bytes());
    bytes.extend_from_slice(&rate.to_le_bytes());
    bytes.extend_from_slice(&(rate * 4).to_le_bytes());
    bytes.extend_from_slice(&4u16.to_le_bytes());
    bytes.extend_from_slice(&16u16.to_le_bytes());
    bytes.extend_from_slice(b"data");
    bytes.extend_from_slice(&(frames * 4).to_le_bytes());
    for n in 0..frames {
        bytes.extend_from_slice(&tone(n, 1000.0).to_le_bytes());
        bytes.extend_from_slice(&tone(n, 2500.0).to_le_bytes());
    }
    std::fs::write(path, bytes).unwrap();
}

fn boot_clip(shazam: &str, seconds: u32) -> common::TestCore {
    let dir = tempfile::tempdir().unwrap();
    let wav = dir.path().join("clip.wav");
    write_wav(&wav, seconds);
    common::boot_config(dir, MemoryKeyStore::default(), |config| {
        config.shazam_url = shazam.into();
        config.test.system_clip = Some(wav);
    })
}

fn events(body: &[u8]) -> Vec<Value> {
    String::from_utf8(body.to_vec())
        .unwrap()
        .split("\n\n")
        .filter_map(|raw| raw.lines().find_map(|l| l.strip_prefix("data:")).map(|d| serde_json::from_str(d.trim()).unwrap()))
        .collect()
}

fn kinds(events: &[Value]) -> Vec<String> {
    events
        .iter()
        .map(|e| match e["type"].as_str().unwrap() {
            "stage" => format!("stage:{}", e["name"].as_str().unwrap()),
            other => other.to_string(),
        })
        .collect()
}

async fn recognize(core: &common::TestCore, body: Value) -> (StatusCode, Vec<Value>) {
    let (status, bytes, headers) = common::send(&core.app, common::request("POST", "/v1/recognize", Some(body))).await;
    if status == StatusCode::OK {
        assert_eq!(headers["content-type"], "text/event-stream");
    }
    (status, events(&bytes))
}

#[tokio::test]
async fn the_body_names_exactly_one_input() {
    let core = common::core();
    for body in [json!({}), json!({"url": "https://x.com/a", "system": true}), json!({"path": "relative/clip.mp4"}), json!({"path": "/etc/hostname"}), json!({"system": true, "path": "/etc/hostname"}), json!({"system": true, "part": 2}), json!({"system": true, "extra": 1}), json!({"system": true, "microphone": true}), json!({"file": "x", "microphone": true})] {
        let (status, _) = recognize(&core, body.clone()).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
    }
}

#[tokio::test]
async fn a_granted_file_is_recognized_and_named_in_history() {
    let (url, _) = mock_shazam(vec![found()], Duration::ZERO).await;
    let core = boot_clip(&url, 12);
    let dir = tempfile::tempdir().unwrap();
    let wav = dir.path().join("Morning walk.wav");
    write_wav(&wav, 12);

    let (status, grant) = common::call(&core.app, "POST", "/v1/fs/recognize/file", Some(json!({"path": wav}))).await;
    assert_eq!(status, StatusCode::OK);
    let (_, events) = recognize(&core, json!({"file": grant["id"]})).await;
    assert_eq!(kinds(&events), ["stage:fetching", "stage:listening", "result"]);
    let track = &events.last().unwrap()["track"];
    assert_eq!(track["input"], json!({"kind": "file", "label": "Morning walk.wav"}));
    assert_eq!(track["via"], "mix");
}

#[tokio::test]
async fn an_unknown_grant_is_unavailable_and_a_relative_path_is_refused() {
    let core = common::core();
    let (status, events) = recognize(&core, json!({"file": "/etc/hostname"})).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(events.last().unwrap()["code"], "unavailable");
    let (status, _) = common::call(&core.app, "POST", "/v1/fs/recognize/file", Some(json!({"path": "clip.wav"}))).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn the_microphone_keeps_its_own_kind_in_history() {
    let (url, _) = mock_shazam(vec![found()], Duration::ZERO).await;
    let core = boot_clip(&url, 12);
    let (_, events) = recognize(&core, json!({"microphone": true})).await;
    assert_eq!(events.last().unwrap()["type"], "result");
    let (_, history) = common::call(&core.app, "GET", "/v1/recognize/history", None).await;
    assert_eq!(history["items"][0]["track"]["input"], json!({"kind": "microphone", "label": "Microphone"}));
}

#[tokio::test]
async fn refused_links_end_with_invalid_link() {
    let core = common::core();
    for url in ["file:///etc/passwd", "https://user:pw@example.com/v", "http://192.168.1.1/admin", "http://localhost/x"] {
        let (status, events) = recognize(&core, json!({"url": url})).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(kinds(&events), ["stage:resolving", "error"], "{url}");
        assert_eq!(events[1]["code"], "invalid_link", "{url}");
    }
}

#[tokio::test]
async fn a_clip_is_recognized_and_kept_in_history() {
    let (shazam, hits) = mock_shazam(vec![json!({"matches": []}), found()], Duration::ZERO).await;
    let core = boot_clip(&shazam, 20);

    let (_, events) = recognize(&core, json!({"system": true})).await;
    assert_eq!(kinds(&events), ["stage:fetching", "stage:listening", "stage:listening", "result"]);
        assert_eq!((events[1]["attempt"].as_u64(), events[1]["via"].as_str()), (Some(1), Some("system")));
    assert_eq!(events[2]["via"], "side");
    assert_eq!(events[2]["envelope"].as_array().unwrap().len(), 48);
    let track = &events[3]["track"];
    assert_eq!(track["title"], "I Will Survive");
    assert_eq!(track["coverUrl"], "https://is1-ssl.mzstatic.com/x/600x600cc.jpg");
    assert_eq!(track["offsetMs"], 92_900);
    assert_eq!(track["via"], "side");
    assert_eq!(track["input"], json!({"kind": "system", "label": "System audio"}));
    assert_eq!(hits.load(Ordering::SeqCst), 2);

    let (status, history) = common::call(&core.app, "GET", "/v1/recognize/history?limit=10", None).await;
    assert_eq!(status, StatusCode::OK);
    let items = history["items"].as_array().unwrap();
    assert_eq!(items.len(), 1);
    assert_eq!(items[0]["id"], events[3]["id"]);
    assert_eq!(&items[0]["track"], track);
    assert!(items[0]["createdAt"].as_str().unwrap().ends_with('Z'));

    let path = format!("/v1/recognize/history/{}", items[0]["id"].as_str().unwrap());
    assert_eq!(common::call(&core.app, "DELETE", &path, None).await.0, StatusCode::NO_CONTENT);
    assert_eq!(common::call(&core.app, "DELETE", &path, None).await.0, StatusCode::NOT_FOUND);
    assert_eq!(common::call(&core.app, "GET", "/v1/recognize/history", None).await.1["items"], json!([]));
}

#[tokio::test]
async fn nothing_found_says_whether_another_part_exists() {
    let (shazam, hits) = mock_shazam(vec![], Duration::ZERO).await;
    let core = boot_clip(&shazam, 30);

    let (_, events) = recognize(&core, json!({"system": true})).await;
    assert_eq!(events.iter().filter(|e| e["name"] == "listening").count(), 6);
    assert_eq!(events.last().unwrap(), &json!({"type": "notFound", "more": true}));
    assert_eq!(hits.load(Ordering::SeqCst), 6);

    let (_, events) = recognize(&core, json!({"system": true, "part": 1})).await;
    assert_eq!(events.last().unwrap(), &json!({"type": "notFound", "more": false}));
    let first = events.iter().find(|e| e["name"] == "listening").unwrap();
    assert_eq!(first["of"], 6);
    assert_eq!(common::call(&core.app, "GET", "/v1/recognize/history", None).await.1["items"], json!([]));
}

#[tokio::test]
async fn closing_the_stream_cancels_the_job() {
    let (shazam, hits) = mock_shazam(vec![], Duration::from_millis(400)).await;
    let core = boot_clip(&shazam, 90);

    let response = core.app.clone().oneshot(common::request("POST", "/v1/recognize", Some(json!({"system": true})))).await.unwrap();
    let mut body = response.into_body();
    let mut seen = String::new();
    while !seen.contains("\"listening\"") {
        let frame = tokio::time::timeout(Duration::from_secs(20), body.frame()).await.unwrap().unwrap().unwrap();
        if let Ok(data) = frame.into_data() {
            seen.push_str(std::str::from_utf8(&data).unwrap());
        }
    }
    drop(body);
    tokio::time::sleep(Duration::from_millis(1500)).await;
    assert!(hits.load(Ordering::SeqCst) <= 1, "the job kept sending after the stream closed");
}

#[tokio::test]
async fn locked_library_refuses_recognition_and_history() {
    let first = common::core();
    let locked = common::boot(first.dir, MemoryKeyStore::default(), "http://127.0.0.1:9");
    assert!(locked.state.is_locked());
    assert_eq!(recognize(&locked, json!({"system": true})).await.0, StatusCode::LOCKED);
    assert_eq!(common::call(&locked.app, "GET", "/v1/recognize/history", None).await.0, StatusCode::LOCKED);
}

#[tokio::test]
async fn tools_route_reports_versions_or_null() {
    let core = common::core();
    let (status, tools) = common::call(&core.app, "GET", "/v1/recognize/tools", None).await;
    assert_eq!(status, StatusCode::OK);
    assert!(tools["ffmpeg"].as_str().is_some_and(|v| !v.is_empty()), "ffmpeg is installed on this machine: {tools}");
    assert!(tools["ytDlp"].is_string() || tools["ytDlp"].is_null());
}

// Run by hand: cargo test -p nuvo-server --test recognize -- --ignored --nocapture
#[tokio::test]
#[ignore = "needs the network, yt-dlp and Shazam"]
async fn live_youtube_link_is_recognized() {
    let dir = tempfile::tempdir().unwrap();
    let config = nuvo_server::Config {
        tools_url: None,
        paths: nuvo_server::paths::Paths::under(dir.path()),
        token: common::TOKEN.into(),
        lrclib_url: "http://127.0.0.1:9".into(), amll_url: String::new(),
        shazam_url: nuvo_recognize::SHAZAM_URL.into(),
        lastfm_url: "http://127.0.0.1:9/2.0/".into(),
        pace: nuvo_recognize::Pace::SHAZAM,
        exit_on_stdin_eof: false,
        net_rewrite: None,
        env: Default::default(),
        test: Default::default(),
    };
    let state = nuvo_server::AppState::boot(config, Box::new(MemoryKeyStore::default())).unwrap();
    let app = nuvo_server::router(state);
    let (status, body, _) = common::send(&app, common::request("POST", "/v1/recognize", Some(json!({"url": "https://www.youtube.com/watch?v=6dYWe1c3OyU"})))).await;
    assert_eq!(status, StatusCode::OK);
    let events = events(&body);
    println!("{events:#?}");
    let result = events.iter().find(|e| e["type"] == "result").expect("a result event");
    assert_eq!(result["track"]["artist"], "Gloria Gaynor");
    assert!(result["track"]["title"].as_str().unwrap().contains("I Will Survive"));
}
