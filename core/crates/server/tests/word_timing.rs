mod common;

use std::time::Duration;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use nuvo_crypto::MemoryKeyStore;
use nuvo_fetch::tools::ToolEnv;
use nuvo_fetch::update::WHISPER_BASE;
use nuvo_server::word_timing::{model_path, source_hash};
use nuvo_store::lyrics_words::{self, Timing};
use serde_json::{Value, json};

const LRC: &str = "[00:01.30]The river runs along the quiet town";
const TTML: &str = r#"<tt xmlns="http://www.w3.org/ns/ttml"><body><div><p begin="0:01.000" end="0:02.000"><span begin="0:01.000" end="0:02.000">The</span></p></div></body></tt>"#;

fn events(body: &[u8]) -> Vec<Value> {
    String::from_utf8(body.to_vec())
        .unwrap()
        .split("\n\n")
        .filter_map(|raw| raw.lines().find_map(|l| l.strip_prefix("data:")).map(|d| serde_json::from_str(d.trim()).unwrap()))
        .collect()
}

async fn lyrics(core: &common::TestCore, id: &str) -> Vec<Value> {
    let (_, body, _) = common::send(&core.app, common::request("GET", &format!("/v1/tracks/{id}/lyrics"), None)).await;
    events(&body)
}

fn store(core: &common::TestCore, id: &str, lyrics: &str) {
    let timing = Timing { source_hash: source_hash(lyrics), model: "whisper-base".into(), content: TTML.into() };
    let data = core.state.data().unwrap();
    let id = id.to_string();
    futures::executor::block_on(data.db.call(move |c| lyrics_words::put(c, &id, &timing, 1))).unwrap();
}

#[tokio::test]
async fn nothing_runs_until_the_owner_turns_it_on() {
    let core = common::core();
    let (status, view) = common::call(&core.app, "GET", "/v1/lyrics/word-timing", None).await;
    assert_eq!((status, view), (StatusCode::OK, json!({"enabled": false, "models": []})));
    let (status, _) = common::call(&core.app, "POST", "/v1/tracks/t1/lyrics/word-timing", None).await;
    assert_eq!(status, StatusCode::CONFLICT);
    let (status, view) = common::call(&core.app, "PUT", "/v1/lyrics/word-timing", Some(json!({"enabled": true}))).await;
    assert_eq!((status, view["enabled"].clone()), (StatusCode::OK, json!(true)));
    let (status, _) = common::call(&core.app, "PUT", "/v1/lyrics/word-timing", Some(json!({"enabled": "yes"}))).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn a_track_without_synced_lines_fails_with_a_reason() {
    let core = common::core();
    common::call(&core.app, "PUT", "/v1/lyrics/word-timing", Some(json!({"enabled": true}))).await;
    let (status, job) = common::call(&core.app, "POST", "/v1/tracks/t1/lyrics/word-timing", Some(json!({}))).await;
    assert_eq!(status, StatusCode::ACCEPTED);
    assert_eq!((job["trackId"].as_str(), job["model"].as_str(), job["state"].as_str()), (Some("t1"), Some("whisper-base"), Some("waiting")));
    let job = wait_until_finished(&core).await;
    assert_eq!((job["state"].as_str(), job["code"].as_str()), (Some("failed"), Some("no_synced_lines")));
}

#[tokio::test]
async fn stored_timing_is_offered_only_for_the_lyrics_it_was_made_from() {
    let core = common::core();
    common::call(&core.app, "PUT", "/v1/tracks/t1/lyrics/user", Some(json!({"format": "lrc", "content": LRC}))).await;
    store(&core, "t1", LRC);
    let events = lyrics(&core, "t1").await;
    let aligned: Vec<&Value> = events.iter().filter(|e| e["provider"] == "aligned").collect();
    assert_eq!(aligned.len(), 1, "{events:?}");
    let candidate = &aligned[0]["candidate"];
    assert_eq!((candidate["syncLevel"].as_str(), candidate["lyrics"]["format"].as_str(), candidate["topPriority"].as_bool()), (Some("word_level"), Some("ttml"), Some(true)));
    assert_eq!(candidate["lyrics"]["content"], TTML);

    common::call(&core.app, "PUT", "/v1/tracks/t1/lyrics/user", Some(json!({"format": "lrc", "content": "[00:01.00]Other words"}))).await;
    assert!(lyrics(&core, "t1").await.iter().all(|e| e["provider"] != "aligned"), "edited lyrics drop the old timing");
}

#[tokio::test]
async fn a_cancelled_job_is_forgotten() {
    let core = common::core();
    common::call(&core.app, "PUT", "/v1/lyrics/word-timing", Some(json!({"enabled": true}))).await;
    common::call(&core.app, "PUT", "/v1/tracks/t1/lyrics/user", Some(json!({"format": "lrc", "content": LRC}))).await;
    common::call(&core.app, "POST", "/v1/tracks/t1/lyrics/word-timing", None).await;
    let (status, _) = common::call(&core.app, "DELETE", "/v1/tracks/t1/lyrics/word-timing", None).await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let (_, view) = common::call(&core.app, "GET", "/v1/lyrics/word-timing", None).await;
    assert!(view.get("job").is_none(), "{view}");
}

async fn wait_until_finished(core: &common::TestCore) -> Value {
    for _ in 0..1200 {
        let (_, view) = common::call(&core.app, "GET", "/v1/lyrics/word-timing", None).await;
        let job = view["job"].clone();
        if matches!(job["state"].as_str(), Some("done" | "failed")) {
            return job;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    panic!("the job did not finish");
}

fn spoken_song() -> (Vec<u8>, String) {
    let fixtures = concat!(env!("CARGO_MANIFEST_DIR"), "/../align/tests/fixtures");
    let samples = std::fs::read(format!("{fixtures}/en.s16")).unwrap();
    let mut wav = Vec::new();
    wav.extend_from_slice(b"RIFF");
    wav.extend_from_slice(&(36 + samples.len() as u32).to_le_bytes());
    wav.extend_from_slice(b"WAVEfmt ");
    wav.extend_from_slice(&16u32.to_le_bytes());
    wav.extend_from_slice(&[1, 0, 1, 0]);
    wav.extend_from_slice(&16_000u32.to_le_bytes());
    wav.extend_from_slice(&32_000u32.to_le_bytes());
    wav.extend_from_slice(&[2, 0, 16, 0]);
    wav.extend_from_slice(b"data");
    wav.extend_from_slice(&(samples.len() as u32).to_le_bytes());
    wav.extend_from_slice(&samples);
    (wav, std::fs::read_to_string(format!("{fixtures}/en.lrc")).unwrap())
}

// Needs ffmpeg on PATH and NUVO_ALIGN_MODEL pointing at ggml-base-q8_0.bin
#[tokio::test]
#[ignore = "needs NUVO_ALIGN_MODEL and ffmpeg"]
async fn cached_audio_gets_word_timing_that_the_lyrics_then_carry() {
    let model = std::env::var("NUVO_ALIGN_MODEL").expect("NUVO_ALIGN_MODEL");
    let core = common::boot_config(tempfile::tempdir().unwrap(), MemoryKeyStore::default(), |config| config.env = ToolEnv::from_process());
    let path = model_path(&core.state, &WHISPER_BASE);
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::copy(model, &path).unwrap();
    let (wav, lrc) = spoken_song();
    let upload = Request::put("/v1/cache/audio/t1").header("authorization", format!("Bearer {}", common::TOKEN)).header("content-type", "audio/wav").body(Body::from(wav)).unwrap();
    assert!(common::send(&core.app, upload).await.0.is_success());
    common::call(&core.app, "PUT", "/v1/tracks/t1/lyrics/user", Some(json!({"format": "lrc", "content": lrc}))).await;
    common::call(&core.app, "PUT", "/v1/lyrics/word-timing", Some(json!({"enabled": true}))).await;

    common::call(&core.app, "POST", "/v1/tracks/t1/lyrics/word-timing", None).await;
    let job = wait_until_finished(&core).await;
    assert_eq!((job["state"].as_str(), job["progress"].as_f64()), (Some("done"), Some(1.0)), "{job}");
    let events = lyrics(&core, "t1").await;
    let aligned = events.iter().find(|e| e["provider"] == "aligned").expect("the timing is offered");
    let ttml = aligned["candidate"]["lyrics"]["content"].as_str().unwrap();
    assert_eq!(ttml.matches("<span ").count(), 21, "{ttml}");
    assert_eq!(aligned["candidate"]["topPriority"], true, "timing of the owner's lyrics comes first");
}
