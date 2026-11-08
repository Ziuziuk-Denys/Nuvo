//! Closing the SSE stream must leave no yt-dlp or ffmpeg child behind. Own test binary: it replaces
//! `PATH` with fake tools that record their pid and sleep.

#![cfg(unix)]
mod common;

use std::os::unix::fs::PermissionsExt;
use std::path::Path;
use std::time::Duration;

use http_body_util::BodyExt;
use serde_json::json;
use tower::ServiceExt;

fn fake_tool(dir: &Path, name: &str) {
    let path = dir.join(name);
    std::fs::write(&path, format!("#!/bin/sh\necho $$ > \"{}/{name}.pid\"\nexec /usr/bin/sleep 600\n", dir.display())).unwrap();
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
}

async fn pid_of(dir: &Path, name: &str) -> String {
    let file = dir.join(format!("{name}.pid"));
    for _ in 0..200 {
        if let Ok(text) = std::fs::read_to_string(&file)
            && !text.trim().is_empty()
        {
            return text.trim().to_string();
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    panic!("{name} never started");
}

/// Gone, or a zombie waiting to be reaped.
fn is_dead(pid: &str) -> bool {
    match std::fs::read_to_string(format!("/proc/{pid}/stat")) {
        Ok(stat) => stat.rsplit(')').next().is_some_and(|rest| rest.trim_start().starts_with('Z')),
        Err(_) => true,
    }
}

async fn assert_killed_after_drop(core: &common::TestCore, tools: &Path, tool: &str, body: serde_json::Value) {
    let response = core.app.clone().oneshot(common::request("POST", "/v1/recognize", Some(body))).await.unwrap();
    let mut stream = response.into_body();
    let pid = pid_of(tools, tool).await;
    assert!(!is_dead(&pid), "{tool} should be running while the stream is open");
    // One frame is read first so the job is known to be live, then the client goes away.
    let _ = tokio::time::timeout(Duration::from_secs(5), stream.frame()).await;
    drop(stream);
    for _ in 0..100 {
        if is_dead(&pid) {
            return;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    panic!("{tool} (pid {pid}) survived the closed stream");
}

#[tokio::test]
async fn closing_the_stream_kills_yt_dlp_and_ffmpeg() {
    let tools = tempfile::tempdir().unwrap();
    fake_tool(tools.path(), "yt-dlp");
    fake_tool(tools.path(), "ffmpeg");
    // Single test in this binary, so nothing else reads the environment meanwhile.
    unsafe { std::env::set_var("PATH", tools.path()) };

    let dir = tempfile::tempdir().unwrap();
    let wav = dir.path().join("clip.wav");
    std::fs::write(&wav, b"x").unwrap();
    let core = common::boot_config(dir, nuvo_crypto::MemoryKeyStore::default(), |config| config.test.system_clip = Some(wav));
    // A literal public address needs no DNS, so the link passes ensure_public and reaches yt-dlp.
    assert_killed_after_drop(&core, tools.path(), "yt-dlp", json!({"url": "https://1.1.1.1/clip"})).await;

    assert_killed_after_drop(&core, tools.path(), "ffmpeg", json!({"system": true})).await;
}
