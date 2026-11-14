// Timed lyrics with a local Whisper model, on the CPU only: word timing for synced lines, plain text and the song alone

mod align;
mod ggml;
mod lyrics;
mod mel;
mod model;
mod text;
mod tokenizer;
mod transcribe;

use std::path::Path;
use std::sync::OnceLock;

pub use align::{Line, TimedLine, Word, align};
pub use lyrics::{parse_lrc, to_ttml};
pub use mel::SAMPLE_RATE;
pub use model::Whisper;
pub use transcribe::{Segment, Transcript, transcribe};

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
    #[error("no singing was heard")]
    NoVocals,
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
    /// The median probability the model gave a line's words.
    pub confidence: f32,
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
    let confidence = confidences[confidences.len() / 2];
    if confidence < MIN_MEDIAN_CONFIDENCE {
        return Err(AlignError::Mismatch);
    }
    Ok(Aligned { ttml: to_ttml(&lines, offset_ms), lines, confidence })
}

pub struct Made {
    pub lines: Vec<TimedLine>,
    pub confidence: f32,
    pub language: &'static str,
}

/// `hint` is a language code the title suggests; the confidence is the mean probability of the transcript tokens.
pub fn transcribe_song(model: &Whisper, audio: &[f32], hint: Option<&str>, progress: &dyn Fn(f32), stop: &dyn Fn() -> bool) -> Result<Made, AlignError> {
    let transcript = transcribe(model, audio, hint, &|done| progress(done * TRANSCRIPT_SHARE), stop)?;
    if transcript.segments.is_empty() {
        return Err(AlignError::NoVocals);
    }
    let letters: Vec<f32> = transcript.segments.iter().map(|s| s.text.chars().count() as f32).collect();
    let confidence = transcript.segments.iter().zip(&letters).map(|(s, n)| s.avg_logprob.exp() * n).sum::<f32>() / letters.iter().sum::<f32>();
    let timed = align(model, audio, &transcribe::lines_of(&transcript.segments), &|done| progress(TRANSCRIPT_SHARE + done * (1.0 - TRANSCRIPT_SHARE)), stop)?;
    let lines = transcribe::split_lines(timed);
    Ok(Made { lines, confidence, language: transcript.language })
}

/// The confidence is the share of the lyric words heard in the song.
pub fn align_text(model: &Whisper, audio: &[f32], text: &str, hint: Option<&str>, progress: &dyn Fn(f32), stop: &dyn Fn() -> bool) -> Result<Made, AlignError> {
    let lines: Vec<String> = text.lines().filter_map(transcribe::sung).collect();
    if lines.is_empty() {
        return Err(AlignError::NoLines);
    }
    let transcript = transcribe(model, audio, hint, &|done| progress(done * TEXT_SHARES[0]), stop)?;
    if transcript.segments.is_empty() {
        return Err(AlignError::NoVocals);
    }
    let heard = align(model, audio, &transcribe::lines_of(&transcript.segments), &|done| progress(TEXT_SHARES[0] + done * TEXT_SHARES[1]), stop)?;
    let words: Vec<Segment> = heard.iter().flat_map(|line| &line.words).map(|w| Segment { start_ms: w.start_ms, end_ms: w.end_ms, text: w.text.clone(), avg_logprob: 0.0 }).collect();
    let audio_ms = (audio.len() as u64 * 1000 / SAMPLE_RATE as u64).min(u64::from(u32::MAX)) as u32;
    let placed = text::place(&lines, &words, audio_ms);
    if placed.matched < MIN_MATCHED_WORDS {
        return Err(AlignError::Mismatch);
    }
    let lines = align(model, audio, &placed.lines, &|done| progress(TEXT_SHARES[0] + TEXT_SHARES[1] + done * TEXT_SHARES[2]), stop)?;
    Ok(Made { lines, confidence: placed.matched, language: transcript.language })
}

const TRANSCRIPT_SHARE: f32 = 0.75;
const TEXT_SHARES: [f32; 3] = [0.6, 0.2, 0.2];
/// Below this the text belongs to another song or version.
const MIN_MATCHED_WORDS: f32 = 0.3;

/// Half the cores, at most four, so playback and the interface keep theirs.
pub fn worker_threads() -> usize {
    std::thread::available_parallelism().map_or(1, |n| (n.get() / 2).clamp(1, 4))
}

/// One pool for every job, so two jobs never take more cores than one.
pub fn with_low_priority<R: Send>(work: impl FnOnce() -> R + Send) -> Result<R, AlignError> {
    static POOL: OnceLock<Result<rayon::ThreadPool, String>> = OnceLock::new();
    let pool = POOL.get_or_init(|| {
        rayon::ThreadPoolBuilder::new()
            .num_threads(worker_threads())
            .thread_name(|i| format!("nuvo-align-{i}"))
            .start_handler(|_| lower_thread_priority())
            .build()
            .map_err(|err| err.to_string())
    });
    let pool = pool.as_ref().map_err(|err| AlignError::Io(std::io::Error::other(err.clone())))?;
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
