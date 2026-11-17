// Main-only: the page renders the video, main writes it to a temp file and picks where the clip goes

use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;
use std::time::Duration;

use axum::extract::State;
use axum::routing::post;
use axum::{Json, Router};
use nuvo_contracts::MAX_TRACK_ID_LEN;
use serde::Deserialize;
use serde_json::{Value, json};
use tokio::process::Command;

use crate::error::ApiError;
use crate::extract::JsonBody;
use crate::routes::local::{canonical_or_same, refused_target};
use crate::state::AppState;
use crate::word_timing::{Audio, audio_source};

const MAX_LEN_MS: u64 = 20 * 60 * 1000;
const MAX_FADE_MS: u64 = 5_000;
const MUX_TIMEOUT: Duration = Duration::from_secs(300);

pub fn routes() -> Router<AppState> {
    Router::new().route("/v1/fs/clips", post(make))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClipRequest {
    track_id: String,
    video: String,
    out: String,
    start_ms: u64,
    len_ms: u64,
    fps: u32,
    #[serde(default)]
    fade_ms: u64,
    /// The finished sound the page rendered with the player's effects; without it the cached song is cut here.
    #[serde(default)]
    audio: Option<String>,
}

fn seconds(ms: u64) -> String {
    format!("{}.{:03}", ms / 1000, ms % 1000)
}

async fn checked(state: &AppState, body: &ClipRequest) -> Result<(PathBuf, PathBuf, Option<PathBuf>), ApiError> {
    if body.track_id.is_empty() || body.track_id.len() > MAX_TRACK_ID_LEN {
        return Err(ApiError::Invalid(format!("track id must be 1 to {MAX_TRACK_ID_LEN} bytes")));
    }
    if !matches!(body.fps, 30 | 60) {
        return Err(ApiError::Invalid("fps must be 30 or 60".into()));
    }
    if body.len_ms == 0 || body.len_ms > MAX_LEN_MS {
        return Err(ApiError::Invalid("a clip is 1 ms to 20 minutes long".into()));
    }
    if body.fade_ms > MAX_FADE_MS {
        return Err(ApiError::Invalid("a fade is at most 5 seconds".into()));
    }
    let (video, out) = (PathBuf::from(&body.video), PathBuf::from(&body.out));
    if !video.is_absolute() || !out.is_absolute() {
        return Err(ApiError::Invalid("paths must be absolute".into()));
    }
    if out.extension().and_then(|e| e.to_str()) != Some("mp4") {
        return Err(ApiError::Invalid("a clip is saved as .mp4".into()));
    }
    if !tokio::fs::metadata(&video).await.is_ok_and(|m| m.is_file()) {
        return Err(ApiError::Invalid("the rendered video is gone".into()));
    }
    let audio = match &body.audio {
        None => None,
        Some(raw) => {
            let audio = PathBuf::from(raw);
            if !audio.is_absolute() || audio.extension().and_then(|e| e.to_str()) != Some("wav") || !tokio::fs::metadata(&audio).await.is_ok_and(|m| m.is_file()) {
                return Err(ApiError::Invalid("the rendered sound must be an absolute .wav that exists".into()));
            }
            Some(audio)
        }
    };
    let name = out.file_name().ok_or_else(|| ApiError::Invalid("the clip needs a file name".into()))?.to_owned();
    let parent = tokio::fs::canonicalize(out.parent().unwrap_or(Path::new("/"))).await.map_err(|_| ApiError::Invalid("the folder is gone".into()))?;
    let data_dir = canonical_or_same(state.paths.db.parent()).await;
    let cache_dir = canonical_or_same(state.paths.audio.parent()).await;
    if let Some(why) = refused_target(&parent, &[&data_dir, &cache_dir]) {
        return Err(ApiError::Invalid(why.into()));
    }
    Ok((video, parent.join(name), audio))
}

/// The video is raw H.264 at a constant rate; the audio is cut by a filter because a piped input cannot seek.
fn mux_args(command: &mut Command, video: &Path, audio: &Audio, body: &ClipRequest, out: &Path) {
    command.args(["-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-r", &body.fps.to_string(), "-f", "h264", "-protocol_whitelist", "file", "-i"]);
    command.arg(format!("file:{}", video.display()));
    match audio {
        Audio::File(path) => {
            command.args(["-protocol_whitelist", "file", "-i"]).arg(format!("file:{}", path.display()));
        }
        Audio::Bytes { format, .. } => {
            if let Some(format) = format {
                command.args(["-f", format]);
            }
            command.args(["-protocol_whitelist", "pipe", "-i", "pipe:0"]);
        }
    }
    // the sound fades with the picture: in from silence and out to silence, never longer than half the clip
    let fade = body.fade_ms.min(body.len_ms / 2);
    let fades = if fade > 0 {
        format!(",afade=t=in:st=0:d={},afade=t=out:st={}:d={}", seconds(fade), seconds(body.len_ms - fade), seconds(fade))
    } else {
        String::new()
    };
    let trim = format!("[1:a:0]atrim=start={}:duration={},asetpts=PTS-STARTPTS{fades}[a]", seconds(body.start_ms), seconds(body.len_ms));
    command.args(["-filter_complex", &trim, "-map", "0:v:0", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart"]);
    command.arg(format!("file:{}", out.display()));
}

/// The page's own sound already has the cut, the speed, the effects and the fades: it is only encoded.
fn rendered_args(command: &mut Command, video: &Path, audio: &Path, fps: u32, out: &Path) {
    command.args(["-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-r", &fps.to_string(), "-f", "h264", "-protocol_whitelist", "file", "-i"]);
    command.arg(format!("file:{}", video.display()));
    command.args(["-protocol_whitelist", "file", "-i"]).arg(format!("file:{}", audio.display()));
    command.args(["-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart"]);
    command.arg(format!("file:{}", out.display()));
}

async fn make(State(state): State<AppState>, JsonBody(body): JsonBody<ClipRequest>) -> Result<Json<Value>, ApiError> {
    let (video, out, rendered) = checked(&state, &body).await?;
    let ffmpeg = state.env.find("ffmpeg").ok_or_else(|| ApiError::Conflict("ffmpeg is not installed".into()))?;
    if let Some(audio) = rendered {
        let mut command = Command::new(ffmpeg);
        rendered_args(&mut command, &video, &audio, body.fps, &out);
        return finish(command, None, &out).await;
    }
    let data = state.data()?;
    // stop is set so a track that is not cached yet fails at once instead of waiting for playback
    let audio = audio_source(&data, &body.track_id, &AtomicBool::new(true)).await.map_err(|why| {
        let why = if why == "cancelled" { "not cached yet" } else { why };
        ApiError::NotFound(format!("the track audio is not available: {why}"))
    })?;
    let mut command = Command::new(ffmpeg);
    mux_args(&mut command, &video, &audio, &body, &out);
    let input = match audio {
        Audio::Bytes { bytes, .. } => Some(bytes),
        Audio::File(_) => None,
    };
    finish(command, input, &out).await
}

async fn finish(command: Command, input: Option<Vec<u8>>, out: &Path) -> Result<Json<Value>, ApiError> {
    let output = nuvo_fetch::process::run_with_input(command, input, MUX_TIMEOUT, 64 * 1024, 64 * 1024).await.map_err(|_| ApiError::Conflict("ffmpeg did not finish".into()))?;
    if !output.status.success() {
        let why = String::from_utf8_lossy(&output.stderr).lines().next().unwrap_or("ffmpeg failed").to_string();
        return Err(ApiError::Conflict(format!("the clip could not be made: {why}")));
    }
    let path = out.to_str().ok_or_else(|| ApiError::Invalid("the clip path is not valid UTF-8".into()))?;
    Ok(Json(json!({ "path": path })))
}
