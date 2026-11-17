mod common;

use std::process::Command;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use nuvo_crypto::MemoryKeyStore;
use nuvo_fetch::tools::ToolEnv;
use serde_json::{Value, json};

fn clip(video: &str, out: &str) -> Value {
    json!({ "trackId": "t1", "video": video, "out": out, "startMs": 1000, "lenMs": 2000, "fps": 60, "fadeMs": 500 })
}

#[tokio::test]
async fn a_clip_request_with_unsafe_or_odd_input_is_refused() {
    let core = common::core();
    let dir = tempfile::tempdir().unwrap();
    let video = dir.path().join("v.h264");
    std::fs::write(&video, b"x").unwrap();
    let video = video.to_str().unwrap();
    let out = dir.path().join("clip.mp4");
    let out = out.to_str().unwrap();
    let cases = [
        clip("v.h264", out),
        clip(video, "clip.mp4"),
        clip(video, &format!("{}/clip.txt", dir.path().display())),
        clip(&format!("{}/missing.h264", dir.path().display()), out),
        clip(video, "/etc/clip.mp4"),
        json!({ "trackId": "t1", "video": video, "out": out, "startMs": 0, "lenMs": 2000, "fps": 24 }),
        json!({ "trackId": "t1", "video": video, "out": out, "startMs": 0, "lenMs": 0, "fps": 60 }),
        json!({ "trackId": "t1", "video": video, "out": out, "startMs": 0, "lenMs": 1_200_001, "fps": 60 }),
        json!({ "trackId": "", "video": video, "out": out, "startMs": 0, "lenMs": 2000, "fps": 60 }),
        json!({ "trackId": "t1", "video": video, "out": out, "startMs": 0, "lenMs": 2000, "fps": 60, "fadeMs": 5_001 }),
    ];
    for body in cases {
        let (status, answer) = common::call(&core.app, "POST", "/v1/fs/clips", Some(body.clone())).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{body} -> {answer}");
    }
}

#[tokio::test]
async fn a_clip_without_ffmpeg_says_so() {
    let core = common::boot_config(tempfile::tempdir().unwrap(), MemoryKeyStore::default(), |config| config.env = ToolEnv::default());
    let dir = tempfile::tempdir().unwrap();
    let video = dir.path().join("v.h264");
    std::fs::write(&video, b"x").unwrap();
    let (status, answer) = common::call(&core.app, "POST", "/v1/fs/clips", Some(clip(video.to_str().unwrap(), dir.path().join("clip.mp4").to_str().unwrap()))).await;
    assert_eq!(status, StatusCode::CONFLICT, "{answer}");
}

#[cfg(unix)]
#[tokio::test]
async fn a_clip_of_a_track_without_audio_says_so() {
    use std::os::unix::fs::PermissionsExt;
    let tools = tempfile::tempdir().unwrap();
    let ffmpeg = tools.path().join("ffmpeg");
    std::fs::write(&ffmpeg, "#!/bin/sh\nexit 1\n").unwrap();
    std::fs::set_permissions(&ffmpeg, std::fs::Permissions::from_mode(0o755)).unwrap();
    let path = tools.path().as_os_str().to_owned();
    let core = common::boot_config(tempfile::tempdir().unwrap(), MemoryKeyStore::default(), |config| config.env = ToolEnv { path: Some(path), ..ToolEnv::default() });
    let dir = tempfile::tempdir().unwrap();
    let video = dir.path().join("v.h264");
    std::fs::write(&video, b"x").unwrap();
    let body = json!({ "trackId": "local:404", "video": video, "out": dir.path().join("clip.mp4"), "startMs": 0, "lenMs": 2000, "fps": 60 });
    let (status, answer) = common::call(&core.app, "POST", "/v1/fs/clips", Some(body)).await;
    assert_eq!(status, StatusCode::NOT_FOUND, "{answer}");
}

// Needs ffmpeg with an H.264 encoder on PATH to make the test video
#[tokio::test]
#[ignore = "needs ffmpeg"]
async fn cached_audio_is_cut_and_muxed_under_the_rendered_video() {
    let core = common::boot_config(tempfile::tempdir().unwrap(), MemoryKeyStore::default(), |config| config.env = ToolEnv::from_process());
    let upload = Request::put("/v1/cache/audio/t1")
        .header("authorization", format!("Bearer {}", common::TOKEN))
        .header("content-type", "audio/wav")
        .body(Body::from(common::wav_bytes(6)))
        .unwrap();
    assert!(common::send(&core.app, upload).await.0.is_success());
    let dir = tempfile::tempdir().unwrap();
    let video = dir.path().join("v.h264");
    let made = Command::new("ffmpeg")
        .args(["-nostdin", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=s=320x180:r=60", "-t", "2", "-c:v", "libopenh264", "-f", "h264"])
        .arg(&video)
        .status()
        .unwrap();
    assert!(made.success());
    let out = dir.path().join("clip.mp4");

    let (status, answer) = common::call(&core.app, "POST", "/v1/fs/clips", Some(clip(video.to_str().unwrap(), out.to_str().unwrap()))).await;

    assert_eq!(status, StatusCode::OK, "{answer}");
    assert_eq!(answer["path"], out.to_str().unwrap());
    let probe = Command::new("ffprobe").args(["-v", "error", "-show_entries", "stream=codec_name,duration", "-of", "csv=p=0"]).arg(&out).output().unwrap();
    let streams = String::from_utf8(probe.stdout).unwrap();
    assert_eq!(streams.trim(), "h264,2.000000\naac,2.000000", "{streams}");
}

// Needs ffmpeg with an H.264 encoder on PATH to make the test video
#[tokio::test]
#[ignore = "needs ffmpeg"]
async fn a_rendered_sound_from_the_page_is_muxed_as_it_is() {
    let core = common::boot_config(tempfile::tempdir().unwrap(), MemoryKeyStore::default(), |config| config.env = ToolEnv::from_process());
    let dir = tempfile::tempdir().unwrap();
    let video = dir.path().join("v.h264");
    let made = Command::new("ffmpeg")
        .args(["-nostdin", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=s=320x180:r=60", "-t", "2", "-c:v", "libopenh264", "-f", "h264"])
        .arg(&video)
        .status()
        .unwrap();
    assert!(made.success());
    let audio = dir.path().join("sound.wav");
    common::write_wav(&audio, 2);
    let out = dir.path().join("clip.mp4");
    let mut body = clip(video.to_str().unwrap(), out.to_str().unwrap());
    body["trackId"] = json!("not-cached");
    body["audio"] = json!(audio.to_str().unwrap());

    let (status, answer) = common::call(&core.app, "POST", "/v1/fs/clips", Some(body)).await;

    assert_eq!(status, StatusCode::OK, "{answer}");
    let probe = Command::new("ffprobe").args(["-v", "error", "-show_entries", "stream=codec_name,duration", "-of", "csv=p=0"]).arg(&out).output().unwrap();
    let streams = String::from_utf8(probe.stdout).unwrap();
    assert!(streams.starts_with("h264,2.000000\naac,2.0"), "{streams}");
}

#[tokio::test]
async fn a_rendered_sound_must_be_an_absolute_wav_that_exists() {
    let core = common::core();
    let dir = tempfile::tempdir().unwrap();
    let video = dir.path().join("v.h264");
    std::fs::write(&video, b"x").unwrap();
    let out = dir.path().join("clip.mp4");
    for audio in ["sound.wav", "/nowhere/sound.wav"] {
        let mut body = clip(video.to_str().unwrap(), out.to_str().unwrap());
        body["audio"] = json!(audio);
        let (status, answer) = common::call(&core.app, "POST", "/v1/fs/clips", Some(body)).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{audio} -> {answer}");
    }
}
