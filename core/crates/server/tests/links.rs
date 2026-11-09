mod common;

use std::os::unix::fs::PermissionsExt;
use std::path::Path;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

use axum::extract::{Path as UrlPath, State};
use axum::http::{StatusCode, header};
use axum::response::IntoResponse;
use axum::routing::get;
use axum::Router;
use nuvo_crypto::MemoryKeyStore;
use nuvo_fetch::tools::ToolEnv;
use nuvo_server::routes::links::is_short_link;
use serde_json::{Value, json};

const LICENSED: &str = include_str!("../../fetch/tests/fixtures/tiktok-licensed.html");
const ORIGINAL: &str = include_str!("../../fetch/tests/fixtures/tiktok-post.html");
const LICENSED_ID: &str = "7000000000000000011";
const ORIGINAL_ID: &str = "6718335390845095173";

/// Local TikTok: serves the two saved posts and counts page requests.
async fn mock_tiktok() -> (String, Arc<AtomicUsize>) {
    let hits = Arc::new(AtomicUsize::new(0));
    let app = Router::new()
        .route(
            "/{user}/video/{id}",
            get(|State(hits): State<Arc<AtomicUsize>>, UrlPath((_user, id)): UrlPath<(String, String)>| async move {
                hits.fetch_add(1, Ordering::SeqCst);
                let page = match id.as_str() {
                    LICENSED_ID => LICENSED,
                    ORIGINAL_ID => ORIGINAL,
                    _ => return StatusCode::NOT_FOUND.into_response(),
                };
                ([(header::CONTENT_TYPE, "text/html")], page).into_response()
            }),
        )
        .with_state(hits.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    (format!("http://{addr}"), hits)
}

/// A fake yt-dlp that prints `json` and logs each run's arguments as one line of `runs.txt` next to itself.
fn fake_yt_dlp(dir: &Path, json: &str) {
    let script = dir.join("yt-dlp");
    std::fs::write(dir.join("out.json"), json).unwrap();
    std::fs::write(&script, format!("#!/bin/sh\necho \"$*\" >> '{0}/runs.txt'\ncat '{0}/out.json'\n", dir.display())).unwrap();
    std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
}

fn runs(dir: &Path) -> usize {
    std::fs::read_to_string(dir.join("runs.txt")).map(|s| s.lines().count()).unwrap_or(0)
}

async fn inspect(core: &common::TestCore, url: &str) -> Value {
    let (status, body) = common::call(&core.app, "POST", "/v1/links/inspect", Some(json!({ "url": url }))).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    body
}

fn events(body: &[u8]) -> Vec<Value> {
    String::from_utf8_lossy(body).lines().filter_map(|line| line.strip_prefix("data: ")).map(|data| serde_json::from_str(data).unwrap()).collect()
}

#[tokio::test]
async fn a_licensed_tiktok_sound_is_read_once_and_shared_with_recognize() {
    let (base, hits) = mock_tiktok().await;
    // recognize looks for ffmpeg before it judges the address, so the test brings a stub instead of relying on the machine having one
    let tools = tempfile::tempdir().unwrap();
    let ffmpeg = tools.path().join("ffmpeg");
    std::fs::write(&ffmpeg, "#!/bin/sh\nexit 1\n").unwrap();
    std::fs::set_permissions(&ffmpeg, std::fs::Permissions::from_mode(0o755)).unwrap();
    let path = tools.path().as_os_str().to_owned();
    let core = common::boot_config(tempfile::tempdir().unwrap(), MemoryKeyStore::default(), |config| {
        config.test.tiktok_url = Some(base);
        config.env = ToolEnv { path: Some(path), home: None, managed: None };
    });
    let pasted = format!("https://www.tiktok.com/@someone/video/{LICENSED_ID}?is_from_webapp=1");
    let canonical = format!("https://www.tiktok.com/@i/video/{LICENSED_ID}");
    let answer = inspect(&core, &pasted).await;
    assert_eq!(
        answer,
        json!({
            "kind": "tiktok",
            "canonicalUrl": canonical,
            "sound": {"title": "I Will Survive", "author": "Gloria Gaynor", "original": false, "album": "Love Tracks", "clipMs": 60000}
        })
    );
    assert_eq!(inspect(&core, &canonical).await, answer);
    assert_eq!(hits.load(Ordering::SeqCst), 1, "the second inspect is answered from memory");

    // recognize reads the same memory; the saved post's media live on a refused address
    let (status, body, _) = common::send(&core.app, common::request("POST", "/v1/recognize", Some(json!({ "url": canonical })))).await;
    assert_eq!(status, StatusCode::OK);
    let last = events(&body).pop().unwrap();
    assert_eq!(last, json!({"type": "error", "code": "invalid_link"}));
    assert_eq!(hits.load(Ordering::SeqCst), 1, "recognize did not fetch the post again");
}

#[tokio::test]
async fn an_original_sound_says_so() {
    let (base, _) = mock_tiktok().await;
    let core = common::boot_config(tempfile::tempdir().unwrap(), MemoryKeyStore::default(), |config| config.test.tiktok_url = Some(base));
    let answer = inspect(&core, &format!("https://www.tiktok.com/@scout2015/video/{ORIGINAL_ID}")).await;
    assert_eq!(answer["sound"], json!({"title": "original sound", "author": "tiff", "original": true, "clipMs": 10000}));
    let gone = inspect(&core, "https://www.tiktok.com/@a/video/7000000000000000099").await;
    assert_eq!(gone, json!({"error": "unavailable"}));
}

#[tokio::test]
async fn other_links_use_yt_dlp_tags_once_per_minute() {
    let tools = tempfile::tempdir().unwrap();
    fake_yt_dlp(tools.path(), include_str!("../../fetch/tests/fixtures/ytdlp-tagged.json"));
    let path = tools.path().as_os_str().to_owned();
    let core = common::boot_config(tempfile::tempdir().unwrap(), MemoryKeyStore::default(), |config| config.env = ToolEnv { path: Some(path), home: None, managed: None });
    // a public address literal: the public-address check needs no DNS
    let url = "https://93.184.215.14/watch?v=1";
    let answer = inspect(&core, url).await;
    assert_eq!(
        answer,
        json!({
            "kind": "media",
            "canonicalUrl": url,
            "media": {
                "title": "Rick Astley - Never Gonna Give You Up (Official Video)", "uploader": "Rick Astley",
                "track": "Never Gonna Give You Up", "artist": "Rick Astley", "album": "Whenever You Need Somebody",
                "durationMs": 213000, "isLive": false
            }
        })
    );
    inspect(&core, url).await;
    assert_eq!(runs(tools.path()), 1);
    let argv = std::fs::read_to_string(tools.path().join("runs.txt")).unwrap();
    assert!(argv.contains("--use-extractors default,-generic"), "the generic extractor would fetch any page: {argv}");
}

#[tokio::test]
async fn a_name_that_resolves_to_a_private_address_never_reaches_yt_dlp() {
    let tools = tempfile::tempdir().unwrap();
    fake_yt_dlp(tools.path(), include_str!("../../fetch/tests/fixtures/ytdlp-tagged.json"));
    let path = tools.path().as_os_str().to_owned();
    let core = common::boot_config(tempfile::tempdir().unwrap(), MemoryKeyStore::default(), |config| config.env = ToolEnv { path: Some(path), home: None, managed: None });
    // `localhost` comes from the hosts file, so no network is needed
    for url in ["http://localhost/admin", "https://localhost/watch?v=1"] {
        assert_eq!(inspect(&core, url).await, json!({"error": "invalid_link"}), "{url}");
    }
    assert_eq!(runs(tools.path()), 0);
}

#[tokio::test]
async fn refused_links_and_missing_tools_answer_with_codes() {
    let core = common::core();
    for url in ["file:///etc/passwd", "http://127.0.0.1/x", "https://user:pw@example.com/", "not a link"] {
        assert_eq!(inspect(&core, url).await, json!({"error": "invalid_link"}), "{url}");
    }
    assert_eq!(inspect(&core, "https://93.184.215.14/watch?v=1").await, json!({"error": "tool_missing"}));
    let (status, body) = common::call(&core.app, "POST", "/v1/links/inspect", Some(json!({}))).await;
    assert_eq!((status, body["code"].as_str()), (StatusCode::BAD_REQUEST, Some("INVALID_INPUT")));
}

#[test]
fn only_known_short_link_hosts_are_followed() {
    for host in ["deezer.page.link", "link.deezer.com", "spotify.link", "on.soundcloud.com"] {
        assert!(is_short_link(host), "{host}");
    }
    for host in ["bit.ly", "deezer.com", "evil.deezer.page.link.example"] {
        assert!(!is_short_link(host), "{host}");
    }
}

/// Run by hand: `NUVO_LIVE_TIKTOK_URL=<a post with a licensed song> cargo test -p nuvo-server --test links -- --ignored`.
#[tokio::test]
#[ignore]
async fn live_tiktok_post_is_inspected() {
    let Ok(url) = std::env::var("NUVO_LIVE_TIKTOK_URL") else { return };
    let answer = inspect(&common::core(), &url).await;
    assert_eq!(answer["kind"], "tiktok", "{answer}");
    assert!(answer["sound"]["title"].is_string(), "{answer}");
}

#[tokio::test]
async fn inspect_needs_the_bearer_token() {
    let core = common::core();
    let request = axum::http::Request::builder()
        .method("POST")
        .uri("/v1/links/inspect")
        .header("content-type", "application/json")
        .body(axum::body::Body::from(json!({ "url": "https://example.com/a" }).to_string()))
        .unwrap();
    assert_eq!(common::send(&core.app, request).await.0, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn inspect_answers_423_while_locked_without_fetching() {
    let (base, hits) = mock_tiktok().await;
    let first = common::core();
    let locked = common::boot(first.dir, MemoryKeyStore::default(), "http://127.0.0.1:9");
    let url = format!("{base}/@a/video/{LICENSED_ID}");
    let (status, error) = common::call(&locked.app, "POST", "/v1/links/inspect", Some(json!({ "url": url }))).await;
    assert_eq!((status, error["code"].as_str()), (StatusCode::LOCKED, Some("LOCKED")));
    assert_eq!(hits.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn inspect_answers_503_while_the_core_starts() {
    let (_dir, app) = common::starting();
    let (status, error) = common::call(&app, "POST", "/v1/links/inspect", Some(json!({ "url": "https://example.com/a" }))).await;
    assert_eq!((status, error["code"].as_str()), (StatusCode::SERVICE_UNAVAILABLE, Some("CORE_STARTING")));
}
