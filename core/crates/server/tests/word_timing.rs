mod common;

use std::time::Duration;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use nuvo_crypto::MemoryKeyStore;
use nuvo_fetch::tools::ToolEnv;
use nuvo_fetch::update::WHISPER_BASE;
use nuvo_contracts::{ToolDownload, WordTimingJob};
use nuvo_server::word_timing::{model_path, source_hash, with_download};
use nuvo_store::lyrics_words::{self, ALIGNED, SYNCED, TRANSCRIBED, Timing};
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

fn store(core: &common::TestCore, id: &str, source: &'static str, lyrics: &str) {
    let hash = if source == TRANSCRIBED { String::new() } else { source_hash(lyrics) };
    let timing = Timing { source_hash: hash, model: "whisper-base".into(), confidence: Some(0.5), content: TTML.into() };
    let data = core.state.data().unwrap();
    let id = id.to_string();
    futures::executor::block_on(data.db.call(move |c| lyrics_words::put(c, &id, source, &timing, 1))).unwrap();
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
    assert_eq!((job["trackId"].as_str(), job["source"].as_str(), job["model"].as_str(), job["state"].as_str()), (Some("t1"), Some("synced"), Some("whisper-base"), Some("waiting")));
    let job = wait_until_finished(&core).await;
    assert_eq!((job["state"].as_str(), job["code"].as_str()), (Some("failed"), Some("no_synced_lines")));
}

#[tokio::test]
async fn stored_timing_is_offered_only_for_the_lyrics_it_was_made_from() {
    let core = common::core();
    common::call(&core.app, "PUT", "/v1/tracks/t1/lyrics/user", Some(json!({"format": "lrc", "content": LRC}))).await;
    store(&core, "t1", SYNCED, LRC);
    assert!(lyrics(&core, "t1").await.iter().all(|e| e["provider"] != "whisper-base"), "nothing while word timing is off");
    common::call(&core.app, "PUT", "/v1/lyrics/word-timing", Some(json!({"enabled": true}))).await;
    let events = lyrics(&core, "t1").await;
    let aligned: Vec<&Value> = events.iter().filter(|e| e["provider"] == "whisper-base").collect();
    assert_eq!(aligned.len(), 1, "{events:?}");
    let candidate = &aligned[0]["candidate"];
    assert_eq!((candidate["syncLevel"].as_str(), candidate["lyrics"]["format"].as_str(), candidate["topPriority"].as_bool()), (Some("word_level"), Some("ttml"), Some(true)));
    assert_eq!(candidate["lyrics"]["content"], TTML);
    assert_eq!(candidate["made"], json!({"source": "synced", "confidence": 0.5}));

    common::call(&core.app, "PUT", "/v1/tracks/t1/lyrics/user", Some(json!({"format": "lrc", "content": "[00:01.00]Other words"}))).await;
    assert!(lyrics(&core, "t1").await.iter().all(|e| e["provider"] != "whisper-base"), "edited lyrics drop the old timing");
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

#[tokio::test]
async fn made_lyrics_need_no_switch_and_say_what_they_lack() {
    let core = common::core();
    let (status, view) = common::call(&core.app, "GET", "/v1/lyrics/made", None).await;
    assert_eq!((status, view), (StatusCode::OK, json!({"models": []})));
    let (status, _) = common::call(&core.app, "POST", "/v1/tracks/t1/lyrics/made", Some(json!({"source": "synced"}))).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let (status, job) = common::call(&core.app, "POST", "/v1/tracks/t1/lyrics/made", Some(json!({"source": "aligned"}))).await;
    assert_eq!((status, job["source"].as_str(), job["model"].as_str(), job["state"].as_str()), (StatusCode::ACCEPTED, Some("aligned"), Some("whisper-base"), Some("waiting")));
    let job = wait_for(&core, "/v1/lyrics/made").await;
    assert_eq!((job["state"].as_str(), job["code"].as_str()), (Some("failed"), Some("no_plain_lyrics")));
    let (_, job) = common::call(&core.app, "POST", "/v1/tracks/t1/lyrics/made", Some(json!({"source": "transcribed"}))).await;
    assert_eq!(job["model"], "whisper-small", "transcription hears more with the small model");
    common::call(&core.app, "DELETE", "/v1/tracks/t1/lyrics/made/job", None).await;
    let (_, view) = common::call(&core.app, "GET", "/v1/lyrics/word-timing", None).await;
    assert!(view.get("job").is_none(), "word timing keeps its own slot: {view}");
}

#[tokio::test]
async fn transcribed_lyrics_are_offered_and_marked_until_forgotten() {
    let core = common::core();
    store(&core, "t1", TRANSCRIBED, "");
    let events = lyrics(&core, "t1").await;
    let made = events.iter().find(|e| e["provider"] == "whisper-base").expect("offered without the switch");
    assert_eq!(made["candidate"]["made"], json!({"source": "transcribed", "confidence": 0.5}));
    assert_eq!(made["candidate"].get("topPriority"), None);
    let done = events.last().unwrap();
    assert_eq!((done["type"].as_str(), done["best"]["provider"].as_str()), (Some("done"), Some("whisper-base")), "{done}");

    let (status, _) = common::call(&core.app, "DELETE", "/v1/tracks/t1/lyrics/made", None).await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let events = lyrics(&core, "t1").await;
    assert!(events.iter().all(|e| e["provider"] != "whisper-base"), "{events:?}");
    assert_eq!(events.last().unwrap()["status"], "not_found");
}

#[tokio::test]
async fn aligned_lyrics_follow_the_plain_text_they_were_made_from() {
    let core = common::core();
    let plain = "The river runs along the quiet town";
    common::call(&core.app, "PUT", "/v1/tracks/t1/lyrics/user", Some(json!({"format": "plain", "content": plain}))).await;
    store(&core, "t1", ALIGNED, plain);
    let events = lyrics(&core, "t1").await;
    let made = events.iter().find(|e| e["provider"] == "whisper-base").expect("offered");
    assert_eq!((made["candidate"]["made"]["source"].as_str(), made["candidate"]["topPriority"].as_bool()), (Some("aligned"), Some(true)));

    common::call(&core.app, "PUT", "/v1/tracks/t1/lyrics/user", Some(json!({"format": "plain", "content": "Other words"}))).await;
    assert!(lyrics(&core, "t1").await.iter().all(|e| e["provider"] != "whisper-base"), "edited lyrics drop the old timing");
}

async fn wait_until_finished(core: &common::TestCore) -> Value {
    wait_for(core, "/v1/lyrics/word-timing").await
}

async fn wait_for(core: &common::TestCore, path: &str) -> Value {
    for _ in 0..1200 {
        let (_, view) = common::call(&core.app, "GET", path, None).await;
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
    let aligned = events.iter().find(|e| e["provider"] == "whisper-base").expect("the timing is offered");
    let ttml = aligned["candidate"]["lyrics"]["content"].as_str().unwrap();
    assert_eq!(ttml.matches("<span ").count(), 21, "{ttml}");
    assert_eq!(aligned["candidate"]["topPriority"], true, "timing of the owner's lyrics comes first");
}

// Needs ffmpeg on PATH and NUVO_ALIGN_MODEL pointing at ggml-base-q8_0.bin
#[tokio::test]
#[ignore = "needs NUVO_ALIGN_MODEL and ffmpeg"]
async fn cached_audio_gets_transcribed_and_its_plain_lyrics_timed() {
    let model = std::env::var("NUVO_ALIGN_MODEL").expect("NUVO_ALIGN_MODEL");
    let core = common::boot_config(tempfile::tempdir().unwrap(), MemoryKeyStore::default(), |config| config.env = ToolEnv::from_process());
    let path = model_path(&core.state, &WHISPER_BASE);
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::copy(model, &path).unwrap();
    let (wav, lrc) = spoken_song();
    let upload = Request::put("/v1/cache/audio/t1").header("authorization", format!("Bearer {}", common::TOKEN)).header("content-type", "audio/wav").body(Body::from(wav)).unwrap();
    assert!(common::send(&core.app, upload).await.0.is_success());

    common::call(&core.app, "POST", "/v1/tracks/t1/lyrics/made", Some(json!({"source": "transcribed", "best": false}))).await;
    let job = wait_for(&core, "/v1/lyrics/made").await;
    assert_eq!((job["state"].as_str(), job["progress"].as_f64()), (Some("done"), Some(1.0)), "{job}");
    let events = lyrics(&core, "t1").await;
    let heard = events.iter().find(|e| e["candidate"]["made"]["source"] == "transcribed").expect("the transcript is offered");
    let ttml = heard["candidate"]["lyrics"]["content"].as_str().unwrap().to_lowercase();
    assert!(ttml.contains(">river</span>") && ttml.contains(">morning</span>"), "{ttml}");
    assert!(heard["candidate"]["made"]["confidence"].as_f64().unwrap() > 0.3);

    let plain: String = lrc.lines().map(|line| line.split_once(']').unwrap().1).collect::<Vec<_>>().join("\n");
    common::call(&core.app, "PUT", "/v1/tracks/t1/lyrics/user", Some(json!({"format": "plain", "content": plain}))).await;
    common::call(&core.app, "POST", "/v1/tracks/t1/lyrics/made", Some(json!({"source": "aligned"}))).await;
    let job = wait_for(&core, "/v1/lyrics/made").await;
    assert_eq!((job["source"].as_str(), job["state"].as_str()), (Some("aligned"), Some("done")), "{job}");
    let events = lyrics(&core, "t1").await;
    let timed = events.iter().find(|e| e["candidate"]["made"]["source"] == "aligned").expect("the timed text is offered");
    let ttml = timed["candidate"]["lyrics"]["content"].as_str().unwrap();
    assert_eq!(ttml.matches("<p ").count(), 3, "{ttml}");
    assert_eq!(ttml.matches("<span ").count(), 21, "{ttml}");
}

#[test]
fn a_job_waiting_for_its_model_shows_the_download() {
    let core = common::core();
    let job = |state: &'static str| WordTimingJob { track_id: "t1".into(), source: TRANSCRIBED, model: "whisper-small", state, progress: 0.0, code: None };
    let download = |tool: &'static str, failed: bool| Some(ToolDownload { tool, received: 66, total: Some(264), failed });
    *core.state.tool_download.write().unwrap() = download("whisper-small", false);
    assert_eq!(with_download(&core.state, Some(job("waiting"))).unwrap().progress, 0.25);
    assert_eq!(with_download(&core.state, Some(job("running"))).unwrap().progress, 0.0, "a running job keeps its own progress");
    *core.state.tool_download.write().unwrap() = download("ffmpeg", false);
    assert_eq!(with_download(&core.state, Some(job("waiting"))).unwrap().progress, 0.0, "another tool's download is not the model's");
    *core.state.tool_download.write().unwrap() = download("whisper-small", true);
    assert_eq!(with_download(&core.state, Some(job("waiting"))).unwrap().progress, 0.0);
    assert!(with_download(&core.state, None).is_none());
}
