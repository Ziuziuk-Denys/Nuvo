#![cfg(unix)]
use std::ffi::OsString;
use std::os::unix::fs::PermissionsExt;
use std::path::Path;
use std::time::Duration;

use nuvo_fetch::process::run;
use nuvo_fetch::tools::{find, version};
use nuvo_fetch::{FetchError, Tools};
use tokio::process::Command;

fn script(dir: &Path, name: &str, body: &str) -> std::path::PathBuf {
    let path = dir.join(name);
    std::fs::write(&path, format!("#!/bin/sh\n{body}\n")).unwrap();
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
    path
}

#[test]
fn finds_tools_on_path_then_in_local_bin() {
    let root = tempfile::tempdir().unwrap();
    let (first, second, home) = (root.path().join("a"), root.path().join("b"), root.path().join("home"));
    for dir in [&first, &second, &home.join(".local/bin")] {
        std::fs::create_dir_all(dir).unwrap();
    }
    std::fs::write(first.join("yt-dlp"), "not executable").unwrap();
    let in_second = script(&second, "yt-dlp", "true");
    let in_home = script(&home.join(".local/bin"), "ffmpeg", "true");
    let path: OsString = std::env::join_paths([&first, &second]).unwrap();

    assert_eq!(find("yt-dlp", Some(&path), Some(&home)), Some(in_second), "non-executable files are skipped");
    assert_eq!(find("ffmpeg", Some(&path), Some(&home)), Some(in_home));
    assert_eq!(find("ffmpeg", Some(&path), None), None);
    assert_eq!(find("yt-dlp", Some(OsString::from("relative/dir").as_os_str()), None), None, "relative PATH entries are ignored");

    let tools = Tools { yt_dlp: None, ffmpeg: None, js_runtime: None };
    assert_eq!(tools.require_ffmpeg(), Err(FetchError::ToolMissing("ffmpeg")));
    assert_eq!(tools.require_yt_dlp(), Err(FetchError::ToolMissing("yt-dlp")));
}

#[tokio::test]
async fn reads_versions() {
    let dir = tempfile::tempdir().unwrap();
    let yt_dlp = script(dir.path(), "yt-dlp", "echo 2026.10.21");
    let ffmpeg = script(dir.path(), "ffmpeg", "echo 'ffmpeg version 8.1.3 Copyright (c) 2000-2026 the FFmpeg developers'");
    let deno = script(dir.path(), "deno", "echo 'deno 2.9.8 (stable, release, x86_64-unknown-linux-gnu)'");
    let broken = script(dir.path(), "broken", "exit 1");
    assert_eq!(version(&yt_dlp).await.as_deref(), Some("2026.10.21"));
    assert_eq!(version(&ffmpeg).await.as_deref(), Some("8.1.3"));
    assert_eq!(version(&deno).await.as_deref(), Some("2.9.8"));
    assert_eq!(version(&broken).await, None);
    assert_eq!(version(&dir.path().join("missing")).await, None);
}

#[tokio::test]
async fn a_timed_out_child_is_killed() {
    let dir = tempfile::tempdir().unwrap();
    let pid_file = dir.path().join("pid");
    let sleeper = script(dir.path(), "sleeper", &format!("echo $$ > {}\nexec sleep 30", pid_file.display()));
    let result = run(Command::new(&sleeper), Duration::from_millis(300), 64 * 1024, 64 * 1024).await;
    assert!(matches!(result, Err(FetchError::Network(_))));
    let pid = std::fs::read_to_string(&pid_file).unwrap().trim().to_string();
    tokio::time::sleep(Duration::from_millis(200)).await;
    let state = std::fs::read_to_string(format!("/proc/{pid}/stat")).unwrap_or_default();
    // Killed and reaped (gone), or killed and not yet reaped (zombie).
    assert!(state.is_empty() || state.contains(") Z "), "child {pid} still running: {state}");
}

#[tokio::test]
async fn stdout_cap_exceeded_kills_child() {
    let dir = tempfile::tempdir().unwrap();
    let pid_file = dir.path().join("pid");
    let producer = script(
        dir.path(),
        "producer",
        &format!("echo $$ > {}; exec yes | head -100", pid_file.display()),
    );
    let result = run(Command::new(&producer), Duration::from_secs(5), 100, 64 * 1024).await;
    assert!(matches!(result, Err(FetchError::DecodeFailed(_))));
    let pid = std::fs::read_to_string(&pid_file).unwrap().trim().to_string();
    tokio::time::sleep(Duration::from_millis(100)).await;
    let state = std::fs::read_to_string(format!("/proc/{pid}/stat")).unwrap_or_default();
    assert!(state.is_empty() || state.contains(") Z "), "child should be killed");
}

mod checks {
    use std::path::Path;
    use std::time::Duration;

    use nuvo_fetch::tools::{ToolEnv, check_all, has_pulse_input};

    use super::script;

    const DEVICES: &str = "Devices:\n D. = Demuxing supported\n .E = Muxing supported\n ---\n DE alsa            ALSA audio output\n DE pulse           Pulse audio output\n  E sdl,sdl2        SDL2 output device\n";

    fn env(dir: &Path) -> ToolEnv {
        ToolEnv { path: Some(dir.as_os_str().to_owned()), home: None, managed: None }
    }

    fn row<'a>(rows: &'a [nuvo_fetch::tools::ToolCheck], name: &str) -> &'a nuvo_fetch::tools::ToolCheck {
        rows.iter().find(|r| r.name == name).unwrap()
    }

    #[test]
    fn the_pulse_input_is_read_from_the_device_list() {
        assert!(has_pulse_input(DEVICES));
        assert!(!has_pulse_input(" DE alsa ALSA audio output\n  E pulse Pulse audio output\n"), "output-only pulse cannot record");
        assert!(!has_pulse_input(""));
    }

    #[tokio::test]
    async fn every_tool_present_and_working() {
        let dir = tempfile::tempdir().unwrap();
        script(dir.path(), "yt-dlp", "echo 2026.10.21");
        script(dir.path(), "node", "echo v22.11.0");
        let devices = DEVICES.replace('\n', "\\n");
        script(dir.path(), "ffmpeg", &format!("case \"$*\" in\n  *-devices*) printf '{devices}';;\n  *) echo 'ffmpeg version 8.1.3 Copyright (c) 2000-2026';;\nesac"));
        let rows = check_all(&env(dir.path()), Duration::from_secs(5)).await;
        assert_eq!(rows.iter().map(|r| (r.name, r.status)).collect::<Vec<_>>(), [("yt-dlp", "ok"), ("js-runtime", "ok"), ("ffmpeg", "ok"), ("ffmpeg-pulse", "ok")]);
        assert_eq!(row(&rows, "yt-dlp").version.as_deref(), Some("2026.10.21"));
        assert_eq!(row(&rows, "ffmpeg").version.as_deref(), Some("8.1.3"));
        assert_eq!(row(&rows, "js-runtime").version.as_deref(), Some("node v22.11.0"));
        assert_eq!(row(&rows, "ffmpeg").path, Some(dir.path().join("ffmpeg")));
    }

    #[tokio::test]
    async fn nuvo_s_own_deno_counts_as_the_js_runtime() {
        let (path, managed) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        let deno = script(managed.path(), "deno", "echo 'deno 2.9.8 (stable, release, x86_64-unknown-linux-gnu)'");
        let env = ToolEnv { path: Some(path.path().as_os_str().to_owned()), home: None, managed: Some(managed.path().to_path_buf()) };
        assert_eq!(env.js_runtime(), Some(deno));
        let rows = check_all(&env, Duration::from_secs(5)).await;
        assert_eq!((row(&rows, "js-runtime").status, row(&rows, "js-runtime").version.as_deref()), ("ok", Some("deno 2.9.8")));
    }

    #[tokio::test]
    async fn missing_broken_and_hanging_tools_are_statuses() {
        let empty = tempfile::tempdir().unwrap();
        let rows = check_all(&env(empty.path()), Duration::from_secs(5)).await;
        assert!(rows.iter().all(|r| r.status == "missing" && r.path.is_none()), "{rows:?}");

        let dir = tempfile::tempdir().unwrap();
        script(dir.path(), "yt-dlp", "exit 1");
        script(dir.path(), "ffmpeg", "exec sleep 5");
        let started = std::time::Instant::now();
        let rows = check_all(&env(dir.path()), Duration::from_millis(300)).await;
        assert!(started.elapsed() < Duration::from_secs(2), "the checks run in parallel and time out");
        assert_eq!(row(&rows, "yt-dlp").status, "broken");
        assert_eq!(row(&rows, "ffmpeg").status, "broken");
        assert_eq!(row(&rows, "ffmpeg-pulse").status, "missing");
    }

    #[tokio::test]
    async fn yt_dlp_version_must_be_non_empty_and_at_most_64_chars() {
        let dir = tempfile::tempdir().unwrap();
        script(dir.path(), "yt-dlp", "printf ''");
        let rows = check_all(&env(dir.path()), Duration::from_secs(5)).await;
        assert_eq!(row(&rows, "yt-dlp").status, "broken", "empty version is broken");

        let dir = tempfile::tempdir().unwrap();
        script(dir.path(), "yt-dlp", &format!("printf '{}'", "x".repeat(65)));
        let rows = check_all(&env(dir.path()), Duration::from_secs(5)).await;
        assert_eq!(row(&rows, "yt-dlp").status, "broken", "version > 64 chars is broken");

        let dir = tempfile::tempdir().unwrap();
        script(dir.path(), "yt-dlp", &format!("printf '{}'", "x".repeat(64)));
        let rows = check_all(&env(dir.path()), Duration::from_secs(5)).await;
        assert_eq!(row(&rows, "yt-dlp").status, "ok");
        assert_eq!(row(&rows, "yt-dlp").version.as_deref().map(|s| s.len()), Some(64));
    }
}
