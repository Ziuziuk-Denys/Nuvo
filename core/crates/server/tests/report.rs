mod common;

use axum::http::StatusCode;
use nuvo_crypto::MemoryKeyStore;
use nuvo_fetch::tools::ToolEnv;
use nuvo_server::report::{LOG_TAIL_BYTES, log_tail, redact};

const TOKEN: &str = "0123456789abcdef0123456789abcdef";

#[test]
fn every_redaction_rule() {
    let home = Some("/home/denys");
    let cases = [
        ("opened /home/denys/.local/share/nuvo/library.db", "opened ~/.local/share/nuvo/library.db"),
        ("token=0123456789abcdef0123456789abcdef", "token=<token>"),
        ("Authorization: Bearer abc.def", "Authorization: <redacted>"),
        ("cookie: SID=1; HSID=2", "cookie: <redacted>"),
        ("sent Bearer abc.def to x", "sent Bearer <redacted> to x"),
        ("GET https://rr3.googlevideo.com/videoplayback?ip=81.2.3.4&sig=XYZ#t=1 failed", "GET https://rr3.googlevideo.com/videoplayback failed"),
        ("proxy socks5h://user:secret@10.0.0.2:1080 set", "proxy socks5h://***@10.0.0.2:1080 set"),
        ("peer 81.2.3.4:443 reset", "peer <ip>:443 reset"),
        ("peer [2606:4700:4700::1111]:443", "peer [<ip>]:443"),
        ("mail denys@example.com now", "mail <email> now"),
        ("lan 192.168.1.5 and ::1 stay", "lan 192.168.1.5 and ::1 stay"),
    ];
    for (input, expected) in cases {
        assert_eq!(redact(input, home, TOKEN), expected, "{input}");
    }
    let untouched = "2026-10-27T10:00:00.123Z  INFO nuvo-core ready locked=false version 0.1.0\n";
    assert_eq!(redact(untouched, home, TOKEN), untouched);
    assert_eq!(redact("a\nb https://x/y?z\n", home, TOKEN), "a\nb https://x/y\n", "line endings survive");
}

#[test]
fn redaction_holds_on_adversarial_inputs() {
    let home = Some("/home/denys");
    let cases = [
        ("to 2606:4700::1111: timed out", "to <ip>: timed out"),
        ("peer:2606:4700::1111", "peer:<ip>"),
        ("addr=2606:4700::1111,", "addr=<ip>,"),
        ("email=a@b.com", "email=<email>"),
        ("mailto:a@b.com", "mailto:<email>"),
        ("to:a@b.com;", "to:<email>;"),
        ("<a@b.com>", "<<email>>"),
        ("bearer x", "bearer <redacted>"),
        ("BEARER x", "BEARER <redacted>"),
        ("Bearer a then Bearer b", "Bearer <redacted> then Bearer <redacted>"),
        ("Bearer a, ok", "Bearer <redacted>, ok"),
        ("/home/denys2/x", "/home/denys2/x"),
        ("/home/denys", "~"),
        ("/home/denys/x", "~/x"),
        ("file:///home/denys/My%20Music/a.mp3", "file://~/My%20Music/a.mp3"),
        ("file:///home/denys2/a.mp3", "file:///home/denys2/a.mp3"),
        ("81.2.3.4. next", "<ip>. next"),
        ("::ffff:8.8.8.8", "::ffff:<ip>"),
        ("081.002.003.004", "<ip>"),
        ("peer 081.002.003.004:443", "peer <ip>:443"),
        ("peer 010.000.000.001", "peer 010.000.000.001"),
    ];
    for (input, expected) in cases {
        assert_eq!(redact(input, home, TOKEN), expected, "{input}");
    }
    assert_eq!(redact("file:///home/de%20nys/My%20Music/a.mp3 and /home/de nys/x", Some("/home/de nys"), TOKEN), "file://~/My%20Music/a.mp3 and ~/x");
}

#[test]
fn the_log_tail_is_whole_lines_and_whole_characters() {
    let dir = tempfile::tempdir().unwrap();
    let log = dir.path().join("core.log");
    let line = format!("{}\n", "y".repeat(99));
    std::fs::write(&log, line.repeat(LOG_TAIL_BYTES / 100 + 5)).unwrap();
    let tail = log_tail(&log);
    assert_eq!(tail.len() % 100, 0);
    assert_eq!(tail.len(), LOG_TAIL_BYTES);
    std::fs::write(&log, "\u{e9}".repeat(LOG_TAIL_BYTES)).unwrap();
    let tail = log_tail(&log);
    assert!(!tail.contains('\u{fffd}') && tail.chars().all(|c| c == '\u{e9}'));
    assert!(tail.len() <= LOG_TAIL_BYTES);
}

#[test]
fn the_log_tail_spans_the_rotation_and_starts_on_a_line() {
    let dir = tempfile::tempdir().unwrap();
    let log = dir.path().join("core.log");
    assert_eq!(log_tail(&log), "", "no log yet");
    std::fs::write(dir.path().join("core.log.1"), "old line\n").unwrap();
    std::fs::write(&log, "new line\n").unwrap();
    assert_eq!(log_tail(&log), "old line\nnew line\n");

    let long_line = format!("{}\n", "x".repeat(99));
    std::fs::write(dir.path().join("core.log.1"), long_line.repeat(3000)).unwrap();
    let tail = log_tail(&log);
    assert!(tail.len() <= LOG_TAIL_BYTES);
    assert!(tail.starts_with('x') && tail.ends_with("new line\n"));
    assert!(tail.split('\n').filter(|l| !l.is_empty()).all(|l| l.len() == 99 || l == "new line"), "only whole lines");
}

#[tokio::test]
async fn the_report_says_what_runs_and_hides_paths_and_tokens() {
    let home = tempfile::tempdir().unwrap();
    let home_text = home.path().to_string_lossy().into_owned();
    let env = ToolEnv { path: None, home: Some(home.path().to_path_buf()), managed: None };
    let core = common::boot_config(tempfile::tempdir().unwrap(), MemoryKeyStore::default(), |config| config.env = env);
    let log_dir = core.dir.path().join("state");
    std::fs::create_dir_all(&log_dir).unwrap();
    let line = format!("opened {home_text}/x token {} url https://cdn.sndcdn.com/a.mp3?Policy=abc\n", common::TOKEN);
    std::fs::write(log_dir.join("core.log"), line).unwrap();
    nuvo_server::deps::refresh(&core.state).await;

    let (status, report) = common::call(&core.app, "GET", "/v1/system/report", None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(report["version"], env!("CARGO_PKG_VERSION"));
    assert_eq!((report["phase"].as_str(), report["locked"].as_bool()), (Some("ok"), Some(false)));
    assert!(report["schemaVersion"].as_i64().unwrap() >= 1);
    assert!(report["dbBytes"].as_u64().unwrap() > 0);
    assert_eq!(report["cache"]["entries"], 0);
    assert_eq!(report["deps"]["tools"].as_array().unwrap().len(), 4);
    assert!(report.get("networkCheck").is_none(), "no check ran, and the report never runs one");
    assert_eq!(report["log"], "opened ~/x token <token> url https://cdn.sndcdn.com/a.mp3\n");
    let text = report.to_string();
    assert!(!text.contains(&home_text) && !text.contains(common::TOKEN));
}

#[test]
fn no_log_line_carries_phrase_material() {
    let src = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
    let mut files = vec![src.clone()];
    let mut offenders = Vec::new();
    while let Some(path) = files.pop() {
        if path.is_dir() {
            files.extend(std::fs::read_dir(&path).unwrap().map(|e| e.unwrap().path()));
            continue;
        }
        let text = std::fs::read_to_string(&path).unwrap();
        for line in text.lines().filter(|l| ["tracing::", "info!(", "warn!(", "error!(", "debug!("].iter().any(|m| l.contains(m))) {
            if ["%phrase", "?phrase", "phrase =", "{phrase", "words", "mnemonic"].iter().any(|m| line.contains(m)) {
                offenders.push(format!("{}: {line}", path.display()));
            }
        }
    }
    assert!(offenders.is_empty(), "{offenders:#?}");
}

#[tokio::test]
async fn the_network_check_in_the_report_is_redacted() {
    let core = common::boot_config(tempfile::tempdir().unwrap(), MemoryKeyStore::default(), |_| {});
    let row = nuvo_contracts::NetCheckRow {
        check: "https",
        host: Some("proxy.example.com 81.2.3.4".into()),
        service: None,
        ok: false,
        code: Some("blocked"),
        ms: 1,
        detail: Some("failed via https://u:p@81.2.3.4:8080/x?k=1 for a@b.com".into()),
    };
    let check = nuvo_contracts::NetCheck { checked_at: "2026-10-27T10:00:00.000Z".into(), rows: vec![row], summary: "peer 81.2.3.4".into(), code: None, service: None };
    *core.state.last_network_check.write().unwrap() = Some(check);
    let (_, report) = common::call(&core.app, "GET", "/v1/system/report", None).await;
    let text = report["networkCheck"].to_string();
    for leak in ["81.2.3.4", "u:p", "a@b.com", "k=1"] {
        assert!(!text.contains(leak), "{leak} in {text}");
    }
}
