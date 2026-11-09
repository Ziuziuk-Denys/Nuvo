mod common;

use axum::Router;
use axum::routing::get;
use nuvo_contracts::{Deps, ToolStatus, ToolStatusKind};
use nuvo_crypto::MemoryKeyStore;
use nuvo_fetch::tools::ToolEnv;
use nuvo_server::tool_update::{DAY_MS, due, ffmpeg_wanted, tick, wanted};
use serde_json::json;
use sha2::{Digest, Sha256};

const BUILD: &str = "#!/bin/sh\necho 2026.11.07\n";

fn deps(status: ToolStatusKind) -> Deps {
    Deps { checked_at: String::new(), tools: vec![ToolStatus { name: "yt-dlp", path: None, version: None, status, needed_by: &[] }], download: None }
}

#[test]
fn the_check_runs_once_a_day() {
    assert!(due(1000, None));
    assert!(!due(1000 + DAY_MS - 1, Some(1000)));
    assert!(due(1000 + DAY_MS, Some(1000)));
    assert!(due(1000, Some(5000)));
}

#[test]
fn a_recent_system_copy_is_left_alone() {
    assert!(!wanted(&deps(ToolStatusKind::Ok), false));
    assert!(wanted(&deps(ToolStatusKind::Ok), true));
    for status in [ToolStatusKind::Missing, ToolStatusKind::Broken, ToolStatusKind::Outdated] {
        assert!(wanted(&deps(status), false));
    }
}

#[test]
fn ffmpeg_is_fetched_only_when_the_system_has_no_working_one() {
    let with = |status| Deps { checked_at: String::new(), tools: vec![ToolStatus { name: "ffmpeg", path: None, version: None, status, needed_by: &[] }], download: None };
    assert!(!ffmpeg_wanted(&with(ToolStatusKind::Ok)));
    assert!(!ffmpeg_wanted(&with(ToolStatusKind::Outdated)));
    assert!(ffmpeg_wanted(&with(ToolStatusKind::Missing)));
    assert!(ffmpeg_wanted(&with(ToolStatusKind::Broken)));
    assert!(ffmpeg_wanted(&deps(ToolStatusKind::Ok)));
}

async fn release(binary: &'static str, sum: String) -> String {
    let app = Router::new().route("/SHA2-256SUMS", get(move || async move { format!("{sum}  yt-dlp_linux\n") })).route("/yt-dlp_linux", get(move || async move { binary }));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    url
}

fn sha(text: &str) -> String {
    Sha256::digest(text.as_bytes()).iter().map(|b| format!("{b:02x}")).collect()
}

fn empty_path(config: &mut nuvo_server::Config, managed: std::path::PathBuf) {
    config.env = ToolEnv { path: None, home: None, managed: Some(managed) };
}

#[tokio::test]
async fn first_run_fetches_yt_dlp_and_the_deps_route_sees_it() {
    let dir = tempfile::tempdir().unwrap();
    let tools = dir.path().join("data/tools");
    let managed = tools.clone();
    let core = common::boot_config(dir, MemoryKeyStore::default(), move |config| empty_path(config, managed));
    let url = release(BUILD, sha(BUILD)).await;
    tick(&core.state, &url, "yt-dlp_linux", 5_000_000).await;
    assert!(tools.join("yt-dlp").is_file());
    let (_, body) = common::call(&core.app, "GET", "/v1/system/deps", None).await;
    let row = body["tools"].as_array().unwrap().iter().find(|t| t["name"] == "yt-dlp").unwrap();
    assert_eq!(row["version"], json!("2026.11.07"));
    assert!(body.get("download").is_none());
}

#[tokio::test]
async fn a_failed_update_says_so_quietly_and_runs_again_without_waiting_a_day() {
    let dir = tempfile::tempdir().unwrap();
    let tools = dir.path().join("data/tools");
    let managed = tools.clone();
    let core = common::boot_config(dir, MemoryKeyStore::default(), move |config| empty_path(config, managed));
    let bad = release(BUILD, sha("tampered")).await;
    tick(&core.state, &bad, "yt-dlp_linux", 5_000_000).await;
    assert!(!tools.join("yt-dlp").exists());
    let (_, body) = common::call(&core.app, "GET", "/v1/system/deps", None).await;
    assert_eq!(body["download"]["failed"], json!(true));
    let good = release(BUILD, sha(BUILD)).await;
    tick(&core.state, &good, "yt-dlp_linux", 5_000_100).await;
    assert!(tools.join("yt-dlp").is_file());
}
