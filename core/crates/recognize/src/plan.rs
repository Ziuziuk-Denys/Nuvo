//! The listening plan: which 12 s windows are sent, in which order, and when to stop.

use std::future::Future;

use crate::client::{Reply, Shazam, ShazamError};
use crate::signature;
use crate::track::{Song, Via};

/// Shazam returns nothing for windows of 15 s and longer.
pub const WINDOW_MS: u64 = 12_000;
pub const MAX_REQUESTS: usize = 6;
/// The side channel is sent only when its energy is at least this close to the mid energy.
const SIDE_GATE_DB: f64 = -30.0;
const ENVELOPE_POINTS: usize = 48;
/// Interleaved stereo samples per millisecond at 16 kHz.
pub const STEREO_SAMPLES_PER_MS: u64 = 32;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Media {
    /// The clean TikTok sound.
    Clean,
    /// The link, file or recording itself.
    Main,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Candidate {
    pub media: Media,
    pub start_ms: u64,
    pub len_ms: u64,
    pub via: Via,
}

/// Candidate windows in the order they are tried. `main_ms` is the length of the main media
/// (`None` when there is none, as in a TikTok photo post); `mix` is `Via::Mix`, or `Via::System`
/// for a recording. Part 0 is the first run; part 1 is "try another part" and uses new positions.
pub fn candidates(main_ms: Option<u64>, clean_ms: Option<u64>, mix: Via, part: u8) -> Vec<Candidate> {
    let mut out = Vec::new();
    if part == 0
        && let Some(duration_ms) = clean_ms
    {
        out.push(window(Media::Clean, duration_ms, 0.5, Via::Clean));
    }
    let positions: &[f64] = if part == 0 { &[0.5, 0.25, 0.75] } else { &[0.375, 0.625, 0.125, 0.875] };
    if let Some(duration_ms) = main_ms {
        for &position in positions {
            for via in [mix, Via::Side] {
                let candidate = window(Media::Main, duration_ms, position, via);
                // Media no longer than one window yields the same window at every position.
                if !out.contains(&candidate) {
                    out.push(candidate);
                }
            }
        }
    }
    out
}

/// True when a run with `part + 1` would send windows this run did not.
pub fn has_more(main_ms: Option<u64>, part: u8) -> bool {
    part == 0 && main_ms.is_some_and(|ms| ms > WINDOW_MS)
}

fn window(media: Media, duration_ms: u64, position: f64, via: Via) -> Candidate {
    let len_ms = duration_ms.min(WINDOW_MS);
    let start_ms = ((duration_ms - len_ms) as f64 * position) as u64;
    Candidate { media, start_ms, len_ms, via }
}

/// Left plus right, halved.
pub fn mix(stereo: &[i16]) -> Vec<i16> {
    stereo.as_chunks::<2>().0.iter().map(|lr| ((lr[0] as i32 + lr[1] as i32) / 2) as i16).collect()
}

/// Left minus right, halved: a voice-over mixed to the centre cancels out.
pub fn side(stereo: &[i16]) -> Vec<i16> {
    stereo.as_chunks::<2>().0.iter().map(|lr| ((lr[0] as i32 - lr[1] as i32) / 2) as i16).collect()
}

/// Side energy at least -30 dB relative to mid energy. Identical channels (mono) give none.
pub fn side_is_audible(stereo: &[i16]) -> bool {
    let (mut mid, mut side) = (0f64, 0f64);
    for lr in stereo.as_chunks::<2>().0 {
        let (l, r) = (lr[0] as f64, lr[1] as f64);
        mid += (l + r) * (l + r);
        side += (l - r) * (l - r);
    }
    if side == 0.0 {
        return false;
    }
    mid == 0.0 || 10.0 * (side / mid).log10() >= SIDE_GATE_DB
}

/// 48 peak levels (0-1, three decimals) of a mono window, for the listening animation.
pub fn envelope(mono: &[i16]) -> Vec<f32> {
    if mono.is_empty() {
        return vec![0.0; ENVELOPE_POINTS];
    }
    (0..ENVELOPE_POINTS)
        .map(|i| {
            let from = i * mono.len() / ENVELOPE_POINTS;
            let to = ((i + 1) * mono.len() / ENVELOPE_POINTS).max(from + 1).min(mono.len());
            let peak = mono[from..to].iter().map(|s| s.unsigned_abs()).max().unwrap_or(0);
            (peak as f32 / 32_768.0 * 1000.0).round() / 1000.0
        })
        .collect()
}

/// Audio for the plan, decoded on demand.
pub trait WindowSource: Send {
    type Error: Send;

    /// Interleaved 16 kHz stereo samples of `media` from `start_ms`, `len_ms` long (shorter at the end).
    fn window(&mut self, media: Media, start_ms: u64, len_ms: u64) -> impl Future<Output = Result<Vec<i16>, Self::Error>> + Send;
}

#[derive(Debug, Clone, PartialEq)]
pub enum Stage {
    Listening { attempt: usize, of: usize, via: Via, envelope: Vec<f32> },
    Waiting { seconds: u64 },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Outcome {
    Found { song: Box<Song>, via: Via },
    NotFound,
}

#[derive(Debug)]
pub enum ListenError<E> {
    /// A fourth HTTP 429 in one job.
    Busy,
    Shazam(ShazamError),
    Audio(E),
}

/// Sends candidates in order until one matches, at most `MAX_REQUESTS` windows. Silent windows
/// and inaudible side channels are skipped without a request. A 429 waits per `shazam.pace.backoff`
/// and retries the same window.
pub async fn listen<S: WindowSource>(
    shazam: &Shazam,
    source: &mut S,
    candidates: &[Candidate],
    mut report: impl FnMut(Stage) + Send,
) -> Result<Outcome, ListenError<S::Error>> {
    let mut loaded: Option<((Media, u64), Vec<i16>)> = None;
    let (mut sent, mut skipped, mut limited) = (0, 0, 0);
    for candidate in candidates {
        if sent == MAX_REQUESTS {
            break;
        }
        let key = (candidate.media, candidate.start_ms);
        let stereo = match &loaded {
            Some((loaded_key, samples)) if *loaded_key == key => samples,
            _ => {
                let samples = source.window(candidate.media, candidate.start_ms, candidate.len_ms).await.map_err(ListenError::Audio)?;
                &loaded.insert((key, samples)).1
            }
        };
        let mono = match candidate.via {
            Via::Side if !side_is_audible(stereo) => None,
            Via::Side => Some(side(stereo)),
            _ => Some(mix(stereo)),
        };
        let signature = mono.as_ref().map(|samples| signature::generate(samples)).filter(|s| !s.is_silent());
        let (Some(mono), Some(signature)) = (mono, signature) else {
            skipped += 1;
            continue;
        };
        sent += 1;
        let of = (candidates.len() - skipped).min(MAX_REQUESTS);
        report(Stage::Listening { attempt: sent, of, via: candidate.via, envelope: envelope(&mono) });
        loop {
            match shazam.send(&signature).await.map_err(ListenError::Shazam)? {
                Reply::Found(song) => return Ok(Outcome::Found { song, via: candidate.via }),
                Reply::NotFound => break,
                Reply::RateLimited => {
                    let Some(&wait) = shazam.pace.backoff.get(limited) else {
                        return Err(ListenError::Busy);
                    };
                    limited += 1;
                    report(Stage::Waiting { seconds: wait.as_secs_f64().ceil() as u64 });
                    shazam.defer(wait).await;
                }
            }
        }
    }
    Ok(Outcome::NotFound)
}
