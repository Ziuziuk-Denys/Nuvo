#![cfg(unix)]
mod common;

use std::os::unix::fs::PermissionsExt;
use std::path::Path;
use std::time::{Duration, Instant};

use axum::http::StatusCode;
use nuvo_contracts::{ms_from_iso, ToolStatusKind};
use nuvo_crypto::MemoryKeyStore;
use nuvo_fetch::tools::{ToolCheck, ToolEnv};
use nuvo_server::deps::{to_wire, ytdlp_release_ms};
use serde_json::Value;

fn script(dir: &Path, name: &str, body: &str) {
    let path = dir.join(name);
    std::fs::write(&path, format!("#!/bin/sh\n{body}\n")).unwrap();
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
}

fn core_with_tools(dir: &Path) -> common::TestCore {
    let env = ToolEnv { path: Some(dir.as_os_str().to_owned()), home: None, managed: None };
    common::boot_config(tempfile::tempdir().unwrap(), MemoryKeyStore::default(), |config| config.env = env)
}

fn status_of(deps: &Value, name: &str) -> String {
    deps["tools"]
        .as_array()
        .unwrap()
        .iter()
        .find(|t| t["name"] == name)
        .unwrap()["status"]
        .as_str()
        .unwrap()
        .to_string()
}

#[test]
fn yt_dlp_versions_are_release_dates_and_old_ones_are_outdated() {
    assert_eq!(ytdlp_release_ms("2026.10.21"), ms_from_iso("2026-10-21T00:00:00Z"));
    assert_eq!(ytdlp_release_ms("2026.1.5.232807"), ms_from_iso("2026-01-05T00:00:00Z"));
    for odd in ["abc", "26.10.21", "2026.13.01", ""] {
        assert_eq!(ytdlp_release_ms(odd), None, "{odd}");
    }

    let check = |version: &str, status: &'static str| ToolCheck { name: "yt-dlp", path: None, version: Some(version.into()), status, needed_by: &[] };
    let at = |iso: &str| ms_from_iso(iso).unwrap();
    assert_eq!(to_wire(vec![check("2026.10.21", "ok")], at("2027-01-19T00:00:00Z")).tools[0].status, ToolStatusKind::Ok, "exactly 90 days");
    assert_eq!(to_wire(vec![check("2026.10.21", "ok")], at("2027-01-20T00:00:00Z")).tools[0].status, ToolStatusKind::Outdated);
    assert_eq!(to_wire(vec![check("nightly", "ok")], at("2030-01-01T00:00:00Z")).tools[0].status, ToolStatusKind::Ok, "an unknown scheme is not judged");
    assert_eq!(to_wire(vec![check("2020.01.01", "broken")], at("2027-01-20T00:00:00Z")).tools[0].status, ToolStatusKind::Broken);
}

#[tokio::test]
async fn the_route_reports_and_check_again_sees_a_new_tool() {
    let tools = tempfile::tempdir().unwrap();
    let core = core_with_tools(tools.path());
    let (status, deps) = common::call(&core.app, "GET", "/v1/system/deps", None).await;
    assert_eq!(status, StatusCode::OK);
    assert!(deps["checkedAt"].is_string());
    assert_eq!(status_of(&deps, "yt-dlp"), "missing");
    assert_eq!(deps["tools"][0]["neededBy"], serde_json::json!(["recognize-links"]));

    script(tools.path(), "yt-dlp", "echo 2099.01.01");
    assert_eq!(status_of(&common::call(&core.app, "GET", "/v1/system/deps", None).await.1, "yt-dlp"), "missing", "cached until a recheck");
    let (status, deps) = common::call(&core.app, "POST", "/v1/system/deps/recheck", None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(status_of(&deps, "yt-dlp"), "ok");
    assert_eq!(deps["tools"][0]["path"], tools.path().join("yt-dlp").to_string_lossy().as_ref());
}

#[tokio::test]
async fn health_never_waits_for_a_slow_tool() {
    let tools = tempfile::tempdir().unwrap();
    script(tools.path(), "ffmpeg", "exec sleep 3");
    let core = core_with_tools(tools.path());
    let state = core.state.clone();
    let check = tokio::spawn(async move { nuvo_server::deps::refresh(&state).await });
    tokio::time::sleep(Duration::from_millis(50)).await;
    let started = Instant::now();
    assert_eq!(common::call(&core.app, "GET", "/health", None).await.0, StatusCode::OK);
    assert!(started.elapsed() < Duration::from_millis(500), "health took {:?}", started.elapsed());
    assert!(!check.is_finished(), "the check is still waiting on ffmpeg");
    check.abort();
}

#[tokio::test]
async fn single_flight_prevents_parallel_tool_checks() {
    let tools = tempfile::tempdir().unwrap();
    script(
        tools.path(),
        "yt-dlp",
        &format!(
            "echo $(($(cat {}/count) + 1)) > {}/count; echo 2026.10.21",
            tools.path().display(),
            tools.path().display()
        ),
    );
    std::fs::write(tools.path().join("count"), "0").unwrap();

    let core = core_with_tools(tools.path());
    let state = core.state.clone();

    let mut handles = vec![];
    for _ in 0..10 {
        let s = state.clone();
        handles.push(tokio::spawn(async move {
            nuvo_server::deps::refresh(&s).await;
        }));
    }

    for h in handles {
        h.await.unwrap();
    }

    let final_count: usize = std::fs::read_to_string(tools.path().join("count"))
        .unwrap()
        .trim()
        .parse()
        .unwrap();
    assert_eq!(final_count, 1, "all 10 concurrent refreshes should spawn at most 1 check");
}
