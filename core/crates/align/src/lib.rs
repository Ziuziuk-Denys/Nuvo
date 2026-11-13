// Word timing for line-synced lyrics with a local Whisper model, on the CPU only

mod align;
mod ggml;
mod lyrics;
mod mel;
mod model;
mod tokenizer;

use std::path::Path;

pub use align::{Line, TimedLine, Word, align};
pub use lyrics::{parse_lrc, to_ttml};
pub use mel::SAMPLE_RATE;
pub use model::Whisper;

/// Matching lyrics give lines a median token probability near 0.6; lyrics of another song stay under 0.1.
const MIN_MEDIAN_CONFIDENCE: f32 = 0.2;

/// The largest model file accepted, with room above multilingual small at 8 bits.
pub const MAX_MODEL_BYTES: u64 = 400 * 1024 * 1024;

#[derive(Debug, thiserror::Error)]
pub enum AlignError {
    #[error("the model file is not usable: {0}")]
    BadModel(&'static str),
    #[error("the lyrics have no timed lines")]
    NoLines,
    #[error("a line is too long to align")]
    TooLong,
    #[error("the lyrics do not match the audio")]
    Mismatch,
    #[error("cancelled")]
    Cancelled,
    #[error(transparent)]
    Io(#[from] std::io::Error),
}

pub fn load(path: &Path) -> Result<Whisper, AlignError> {
    if std::fs::metadata(path)?.len() > MAX_MODEL_BYTES {
        return Err(AlignError::BadModel("the file is larger than any supported model"));
    }
    Whisper::from_file(ggml::parse(&std::fs::read(path)?)?)
}

pub struct Aligned {
    pub ttml: String,
    pub lines: Vec<TimedLine>,
}

/// Aligns line-synced LRC to 16 kHz mono audio; the result keeps the player's `offset_ms` in mind.
pub fn align_lrc(model: &Whisper, audio: &[f32], lrc: &str, offset_ms: i64, progress: &dyn Fn(f32), stop: &dyn Fn() -> bool) -> Result<Aligned, AlignError> {
    let audio_ms = (audio.len() as u64 * 1000 / SAMPLE_RATE as u64).min(u64::from(u32::MAX)) as u32;
    let lines = parse_lrc(lrc, offset_ms, audio_ms);
    if lines.is_empty() {
        return Err(AlignError::NoLines);
    }
    let lines = align(model, audio, &lines, progress, stop)?;
    let mut confidences: Vec<f32> = lines.iter().map(|line| line.confidence).collect();
    confidences.sort_by(f32::total_cmp);
    if confidences[confidences.len() / 2] < MIN_MEDIAN_CONFIDENCE {
        return Err(AlignError::Mismatch);
    }
    Ok(Aligned { ttml: to_ttml(&lines, offset_ms), lines })
}

/// Half the cores, at most four, so playback and the interface keep theirs.
pub fn worker_threads() -> usize {
    std::thread::available_parallelism().map_or(1, |n| (n.get() / 2).clamp(1, 4))
}

/// Runs `work` on a fresh pool of low-priority threads that the matrix products share.
pub fn with_low_priority<R: Send>(work: impl FnOnce() -> R + Send) -> Result<R, AlignError> {
    let pool = rayon::ThreadPoolBuilder::new()
        .num_threads(worker_threads())
        .thread_name(|i| format!("nuvo-align-{i}"))
        .start_handler(|_| lower_thread_priority())
        .build()
        .map_err(|err| AlignError::Io(std::io::Error::other(err)))?;
    Ok(pool.install(work))
}

// Linux keeps a nice value per thread, so `who = 0` lowers only the calling one
#[cfg(any(target_os = "linux", target_os = "android"))]
fn lower_thread_priority() {
    // SAFETY: plain syscall on the calling thread; a failure leaves the priority as it was
    unsafe {
        libc::setpriority(libc::PRIO_PROCESS, 0, 19);
    }
}

#[cfg(target_vendor = "apple")]
fn lower_thread_priority() {
    // SAFETY: plain syscall on the calling thread; a failure leaves the priority as it was
    unsafe {
        libc::setpriority(libc::PRIO_DARWIN_THREAD, 0, libc::PRIO_DARWIN_BG);
    }
}

#[cfg(windows)]
fn lower_thread_priority() {
    use windows_sys::Win32::System::Threading::{GetCurrentThread, SetThreadPriority, THREAD_PRIORITY_LOWEST};
    // SAFETY: the pseudo handle of the calling thread is always valid
    unsafe {
        SetThreadPriority(GetCurrentThread(), THREAD_PRIORITY_LOWEST);
    }
}

#[cfg(not(any(target_os = "linux", target_os = "android", target_vendor = "apple", windows)))]
fn lower_thread_priority() {}
