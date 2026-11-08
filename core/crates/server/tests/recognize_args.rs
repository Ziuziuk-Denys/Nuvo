//! Every ffmpeg decode of a short or unknown-length input must carry `-t`, or a live stream
//! reads until the timeout. Own test binary: fake ffmpeg on PATH.

mod common;

use std::os::unix::fs::PermissionsExt;

use serde_json::json;

#[tokio::test]
async fn every_decode_is_bounded_by_t() {
    let tools = tempfile::tempdir().unwrap();
    let log = tools.path().join("decodes.log");
    let script = tools.path().join("ffmpeg");
    // Probe calls (no s16le output) print a banner; decodes log their arguments and emit PCM.
    let body = format!(
        "#!/bin/sh\ncase \"$*\" in\n*s16le*) echo \"$*\" >> \"{log}\"; /usr/bin/head -c 640000 /dev/zero ;;\n*) echo \"$BANNER\" >&2; exit 1 ;;\nesac\n",
        log = log.display()
    );
    std::fs::write(&script, body).unwrap();
    std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
    // Single test in this binary, so nothing else reads the environment meanwhile.
    unsafe { std::env::set_var("PATH", tools.path()) };

    let dir = tempfile::tempdir().unwrap();
    let clip = dir.path().join("clip.wav");
    std::fs::write(&clip, b"x").unwrap();
    let core = common::boot_config(dir, nuvo_crypto::MemoryKeyStore::default(), |config| config.test.system_clip = Some(clip));
    for banner in ["  Duration: 00:00:20.00, start: 0.0\n  Stream #0:0: Audio: pcm_s16le", "  Duration: N/A\n  Stream #0:0: Audio: pcm_s16le"] {
        unsafe { std::env::set_var("BANNER", banner) };
        let (status, _, _) = common::send(&core.app, common::request("POST", "/v1/recognize", Some(json!({"system": true})))).await;
        assert_eq!(status, axum::http::StatusCode::OK);
    }
    let lines = std::fs::read_to_string(&log).unwrap();
    let decodes: Vec<&str> = lines.lines().collect();
    assert!(decodes.len() >= 2, "{lines}");
    for line in decodes {
        assert!(line.contains(" -t "), "decode without -t: {line}");
    }
}
