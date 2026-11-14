// One job per slot at a time: a newer request replaces the running one, which stops at its next check

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use nuvo_contracts::WordTimingJob;
use nuvo_fetch::update::{Pinned, WHISPER_BASE, WHISPER_SMALL};
use nuvo_local::save::{extension_for, input_format};
use nuvo_store::lyrics_words::{self, SYNCED, TRANSCRIBED, Timing};
use nuvo_store::{cache_index, local, lyrics_cache, lyrics_user, now_ms, tracks};
use sha2::{Digest, Sha256};
use tokio::process::Command;

use crate::routes::lyrics::read_sidecar;
use crate::routes::local::open_inside;
use crate::state::{AppState, Unlocked};
use crate::tool_update;

/// Songs longer than this are left alone: the work and the decoded audio grow with the length.
const MAX_AUDIO_SECONDS: u32 = 20 * 60;
const MAX_AUDIO_BYTES: u64 = 256 * 1024 * 1024;
/// A job that runs longer is stopped; base takes seconds and small about a minute on a common CPU.
const TIME_BUDGET: Duration = Duration::from_secs(10 * 60);
const DECODE_TIMEOUT: Duration = Duration::from_secs(120);
/// A streamed track reaches the audio cache a little after it starts playing.
const AUDIO_WAIT: Duration = Duration::from_secs(90);
const AUDIO_POLL: Duration = Duration::from_secs(2);

pub const MODELS: [&Pinned; 2] = [&WHISPER_BASE, &WHISPER_SMALL];

pub fn model_path(state: &AppState, model: &Pinned) -> PathBuf {
    state.paths.tools.join("models").join(format!("{}.bin", model.name))
}

pub fn installed(state: &AppState) -> Vec<&'static str> {
    MODELS.iter().filter(|model| std::fs::metadata(model_path(state, model)).is_ok_and(|m| m.len() == model.bytes)).map(|model| model.name).collect()
}

pub fn source_hash(content: &str) -> String {
    Sha256::digest(content.as_bytes()).iter().map(|b| format!("{b:02x}")).collect()
}

#[derive(Default)]
pub struct Jobs {
    slot: Mutex<Slot>,
}

#[derive(Default)]
struct Slot {
    job: Option<WordTimingJob>,
    stop: Option<Arc<AtomicBool>>,
    generation: u64,
}

impl Jobs {
    pub fn current(&self) -> Option<WordTimingJob> {
        self.slot.lock().expect("word timing slot").job.clone()
    }

    /// Stops the running job; with a track, only when it is that track's.
    pub fn cancel(&self, track_id: Option<&str>) {
        let mut slot = self.slot.lock().expect("word timing slot");
        let matches = track_id.is_none_or(|id| slot.job.as_ref().is_some_and(|job| job.track_id == id));
        if matches && let Some(stop) = slot.stop.take() {
            stop.store(true, Ordering::Relaxed);
            slot.job = None;
        }
    }

    fn update(&self, generation: u64, change: impl FnOnce(&mut WordTimingJob)) {
        let mut slot = self.slot.lock().expect("word timing slot");
        if slot.generation == generation && let Some(job) = slot.job.as_mut() {
            change(job);
        }
    }

    fn finish(&self, generation: u64, code: Option<&'static str>) {
        let mut slot = self.slot.lock().expect("word timing slot");
        if slot.generation == generation {
            slot.stop = None;
            if let Some(job) = slot.job.as_mut() {
                job.state = if code.is_some() { "failed" } else { "done" };
                job.progress = if code.is_some() { job.progress } else { 1.0 };
                job.code = code;
            }
        }
    }
}

/// A job waiting for its model shows how much of the model has downloaded.
pub fn with_download(state: &AppState, job: Option<WordTimingJob>) -> Option<WordTimingJob> {
    let mut job = job?;
    if job.state == "waiting"
        && let Some(download) = state.tool_download.read().expect("tool download lock").as_ref()
        && download.tool == job.model
        && !download.failed
        && let Some(total) = download.total.filter(|total| *total > 0)
    {
        job.progress = (download.received as f32 / total as f32).min(1.0);
    }
    Some(job)
}

/// Synced word timing has its own slot, so timing the next song never stops lyrics the owner asked for.
pub fn jobs<'a>(state: &'a AppState, source: &str) -> &'a Jobs {
    if source == SYNCED { &state.word_timing } else { &state.made_lyrics }
}

/// Starts making `source` lyrics for `track_id`, unless that very job is already running.
pub fn start(state: &AppState, data: Unlocked, track_id: String, source: &'static str, model: &'static Pinned) -> WordTimingJob {
    let mut slot = jobs(state, source).slot.lock().expect("word timing slot");
    if let Some(job) = slot.job.as_ref().filter(|job| slot.stop.is_some() && job.track_id == track_id && job.source == source && job.model == model.name) {
        return job.clone();
    }
    if let Some(stop) = slot.stop.take() {
        stop.store(true, Ordering::Relaxed);
    }
    let stop = Arc::new(AtomicBool::new(false));
    slot.generation += 1;
    let job = WordTimingJob { track_id: track_id.clone(), source, model: model.name, state: "waiting", progress: 0.0, code: None };
    slot.job = Some(job.clone());
    slot.stop = Some(stop.clone());
    let generation = slot.generation;
    let state = state.clone();
    tokio::spawn(async move {
        let result = run(&state, &data, &track_id, source, model, generation, stop).await;
        if let Err(code) = result {
            tracing::info!(code, source, "timed lyrics stopped");
        }
        jobs(&state, source).finish(generation, result.err());
    });
    job
}

pub async fn shown_lyrics(data: &Unlocked, track_id: &str, source: &str) -> Option<String> {
    let fits = |format: &str, content: &str| match source {
        SYNCED => format == "lrc" && nuvo_lyrics::lrc_sync_level(content) == "line_level",
        _ => format == "plain",
    };
    let id = track_id.to_string();
    if let Ok(Some((format, content))) = data.db.call(move |c| lyrics_user::user_lyrics(c, &id)).await {
        return fits(&format, &content).then_some(content);
    }
    if track_id.starts_with("local:") {
        let id = track_id.to_string();
        if let Ok(Some(file)) = data.db.call(move |c| local::file_for(c, &id)).await
            && let Some(text) = read_sidecar(&file).await
        {
            let candidate = crate::routes::lyrics::sidecar_candidate(text);
            return fits(&candidate.lyrics.format, &candidate.lyrics.content).then_some(candidate.lyrics.content);
        }
    }
    let id = track_id.to_string();
    let candidate = data.db.call(move |c| lyrics_cache::get(c, &id)).await.ok()??.candidate?;
    fits(&candidate.lyrics.format, &candidate.lyrics.content).then_some(candidate.lyrics.content)
}

/// Russian when the title or the artist is written in Cyrillic; otherwise Whisper decides from the audio.
async fn language_hint(data: &Unlocked, track_id: &str) -> Option<&'static str> {
    let id = track_id.to_string();
    let snapshot = data.db.call(move |c| tracks::snapshot(c, &id)).await.ok()??;
    let names = [snapshot["title"].as_str(), snapshot.pointer("/artists/0/name").and_then(|v| v.as_str())];
    names.into_iter().flatten().flat_map(str::chars).any(|c| matches!(c, 'а'..='я' | 'А'..='Я' | 'ё' | 'Ё')).then_some("ru")
}

async fn run(state: &AppState, data: &Unlocked, track_id: &str, source: &'static str, model: &'static Pinned, generation: u64, stop: Arc<AtomicBool>) -> Result<(), &'static str> {
    let lyrics = match source {
        TRANSCRIBED => String::new(),
        SYNCED => shown_lyrics(data, track_id, source).await.ok_or("no_synced_lines")?,
        _ => shown_lyrics(data, track_id, source).await.ok_or("no_plain_lyrics")?,
    };
    let hash = if source == TRANSCRIBED { String::new() } else { source_hash(&lyrics) };
    let id = track_id.to_string();
    let stored = data.db.call(move |c| lyrics_words::get(c, &id, source)).await.ok().flatten();
    if stored.is_some_and(|timing| timing.source_hash == hash && (timing.model == model.name || timing.model == WHISPER_SMALL.name)) {
        return Ok(());
    }
    let Some(ffmpeg) = state.env.find("ffmpeg") else {
        tool_update::request(state, None);
        return Err("no_ffmpeg");
    };
    let path = model_path(state, model);
    tool_update::ensure_pinned(state, model, &path).await.map_err(|_| "download_failed")?;
    let audio = decode(&ffmpeg, audio_source(data, track_id, &stop).await?).await?;
    if stop.load(Ordering::Relaxed) {
        return Err("cancelled");
    }
    jobs(state, source).update(generation, |job| job.state = "running");
    let id = track_id.to_string();
    let offset_ms = data.db.call(move |c| lyrics_user::offset(c, &id)).await.unwrap_or(0);
    let hint = language_hint(data, track_id).await;
    let deadline = Instant::now() + TIME_BUDGET;
    let (worker, halt_flag) = (state.clone(), stop.clone());
    let made = tokio::task::spawn_blocking(move || {
        let model = nuvo_align::load(&path)?;
        let progress = |done: f32| jobs(&worker, source).update(generation, |job| job.progress = done);
        let halt = || halt_flag.load(Ordering::Relaxed) || Instant::now() > deadline;
        nuvo_align::with_low_priority(|| match source {
            SYNCED => nuvo_align::align_lrc(&model, &audio, &lyrics, offset_ms, &progress, &halt).map(|aligned| (aligned.ttml, aligned.confidence)),
            TRANSCRIBED => nuvo_align::transcribe_song(&model, &audio, hint, &progress, &halt).map(|made| (nuvo_align::to_ttml(&made.lines, offset_ms), made.confidence)),
            _ => nuvo_align::align_text(&model, &audio, &lyrics, hint, &progress, &halt).map(|made| (nuvo_align::to_ttml(&made.lines, offset_ms), made.confidence)),
        })?
    })
    .await
    .map_err(|_| "failed")?
    .inspect_err(|err| {
        if matches!(err, nuvo_align::AlignError::BadModel(_)) {
            let _ = std::fs::remove_file(model_path(state, model));
        }
    })
    .map_err(|err| match err {
        nuvo_align::AlignError::Cancelled if stop.load(Ordering::Relaxed) => "cancelled",
        nuvo_align::AlignError::Cancelled => "too_slow",
        nuvo_align::AlignError::Mismatch => "lyrics_mismatch",
        nuvo_align::AlignError::NoVocals => "no_vocals",
        nuvo_align::AlignError::TooLong => "too_long",
        nuvo_align::AlignError::NoLines if source == SYNCED => "no_synced_lines",
        nuvo_align::AlignError::NoLines => "no_plain_lyrics",
        nuvo_align::AlignError::BadModel(_) | nuvo_align::AlignError::Io(_) => "model_failed",
    })?;
    let (content, confidence) = made;
    let timing = Timing { source_hash: hash, model: model.name.to_string(), confidence: Some(f64::from(confidence)), content };
    let id = track_id.to_string();
    data.db.call(move |c| lyrics_words::put(c, &id, source, &timing, now_ms())).await.map_err(|_| "failed")
}

enum Audio {
    File(PathBuf),
    Bytes { bytes: Vec<u8>, format: Option<&'static str> },
}

async fn audio_source(data: &Unlocked, track_id: &str, stop: &AtomicBool) -> Result<Audio, &'static str> {
    if track_id.starts_with("local:") {
        let id = track_id.to_string();
        let file = data.db.call(move |c| local::file_for(c, &id)).await.ok().flatten().ok_or("no_audio")?;
        let opened = open_inside(&file.row.path, &file.root_path).await.map_err(|_| "no_audio")?;
        return Ok(Audio::File(opened.path));
    }
    let started = Instant::now();
    loop {
        if let Ok(Some(size)) = data.cache.size(track_id).await
            && size > 0
        {
            if size > MAX_AUDIO_BYTES {
                return Err("too_long");
            }
            let id = track_id.to_string();
            let entry = data.db.call(move |c| cache_index::get(c, &id)).await.ok().flatten().ok_or("no_audio")?;
            let bytes = data.cache.read_range(track_id, 0, size - 1).await.map_err(|_| "no_audio")?;
            return Ok(Audio::Bytes { bytes, format: input_format(extension_for(&entry.mime, entry.codec.as_deref())) });
        }
        if stop.load(Ordering::Relaxed) {
            return Err("cancelled");
        }
        if started.elapsed() > AUDIO_WAIT {
            return Err("no_audio");
        }
        tokio::time::sleep(AUDIO_POLL).await;
    }
}

/// 16 kHz mono floats, the model's input, cut at the length budget.
async fn decode(ffmpeg: &Path, audio: Audio) -> Result<Vec<f32>, &'static str> {
    let mut command = Command::new(ffmpeg);
    command.args(["-nostdin", "-hide_banner", "-loglevel", "error"]);
    let input = match audio {
        Audio::File(path) => {
            command.args(["-protocol_whitelist", "file", "-i"]).arg(format!("file:{}", path.display()));
            None
        }
        Audio::Bytes { bytes, format } => {
            if let Some(format) = format {
                command.args(["-f", format]);
            }
            command.args(["-protocol_whitelist", "pipe", "-i", "pipe:0"]);
            Some(bytes)
        }
    };
    command.args(["-vn", "-ac", "1", "-ar", "16000", "-t", &MAX_AUDIO_SECONDS.to_string(), "-f", "f32le", "-"]);
    let limit = MAX_AUDIO_SECONDS as usize * nuvo_align::SAMPLE_RATE * 4 + 4096;
    let output = nuvo_fetch::process::run_with_input(command, input, DECODE_TIMEOUT, limit, 64 * 1024).await.map_err(|_| "decode_failed")?;
    if !output.status.success() || output.stdout.len() < 4 {
        return Err("decode_failed");
    }
    Ok(output.stdout.as_chunks::<4>().0.iter().map(|b| f32::from_le_bytes(*b)).collect())
}
