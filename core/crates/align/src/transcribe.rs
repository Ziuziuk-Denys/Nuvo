// 30 s windows; the timestamps Whisper writes cut the segments and say where the next window starts

use std::io::Write;

use crate::AlignError;
use crate::align::{Line, TimedLine};
use crate::mel::{SAMPLE_RATE, WINDOW_SAMPLES, log_mel};
use crate::model::{Cache, Cross, Whisper, softmax};
use crate::tokenizer::{EOT, FIRST_LANGUAGE, FIRST_TIMESTAMP, LANGUAGES, NO_SPEECH, SOT, TRANSCRIBE, TRANSLATE};

const TIMESTAMP_MS: u32 = 20;
const MAX_INITIAL_TIMESTAMP: u32 = 50;
const MAX_SAMPLED: usize = 224;
const TEMPERATURES: [f32; 6] = [0.0, 0.2, 0.4, 0.6, 0.8, 1.0];
/// Text that packs better than this is a repetition loop.
const MAX_COMPRESSION: f32 = 2.4;
const MIN_AVG_LOGPROB: f32 = -1.0;
const MIN_NO_SPEECH: f32 = 0.6;
const MIN_KEPT_LOGPROB: f32 = -1.5;
/// A window unreadable at every temperature, often a long intro, is read again from a little later.
const FAILED_STEP_MS: u32 = 10_000;
/// A hint is taken unless the audio clearly speaks another language.
const MIN_HINT_PROBABILITY: f32 = 0.1;
const LINE_PAUSE_MS: u32 = 700;
const MAX_LINE_WORDS: usize = 12;
const COMMA_LINE_WORDS: usize = 5;
const MIN_REST_WORDS: usize = 3;

/// Subtitle credits the model learned, never sung.
const ARTEFACTS: [&str; 12] = [
    "subtitles by",
    "subtitled by",
    "captions by",
    "thanks for watching",
    "thank you for watching",
    "please subscribe",
    "субтитры",
    "редактор субтитров",
    "корректор",
    "продолжение следует",
    "спасибо за просмотр",
    "подписывайтесь на канал",
];

#[derive(Debug, Clone, PartialEq)]
pub struct Segment {
    pub start_ms: u32,
    pub end_ms: u32,
    pub text: String,
    pub avg_logprob: f32,
}

pub struct Transcript {
    pub language: &'static str,
    pub segments: Vec<Segment>,
}

/// Windows at a quarter, half and three quarters of the song, where the singing usually is.
pub fn detect_language(model: &Whisper, audio: &[f32], hint: Option<&str>, stop: &dyn Fn() -> bool) -> Result<u32, AlignError> {
    let starts: Vec<usize> = if audio.len() <= 2 * WINDOW_SAMPLES { vec![0] } else { [1, 2, 3].iter().map(|q| audio.len() * q / 4 - WINDOW_SAMPLES / 2).collect() };
    let mut sums = vec![0.0f32; (TRANSLATE - FIRST_LANGUAGE) as usize];
    for start in starts {
        let cross = window(model, &audio[start..(start + WINDOW_SAMPLES).min(audio.len())], stop)?;
        let mut logits = model.step(&[SOT], &cross, &mut Cache::default());
        let mut languages = logits.drain(FIRST_LANGUAGE as usize..TRANSLATE as usize).collect::<Vec<_>>();
        softmax(&mut languages);
        sums.iter_mut().zip(&languages).for_each(|(sum, p)| *sum += p);
    }
    let total: f32 = sums.iter().sum();
    let best = (0..sums.len()).max_by(|a, b| sums[*a].total_cmp(&sums[*b])).expect("languages");
    let hinted = hint.and_then(|code| LANGUAGES.iter().position(|l| *l == code)).filter(|at| sums[*at] / total >= MIN_HINT_PROBABILITY);
    Ok(FIRST_LANGUAGE + hinted.unwrap_or(best) as u32)
}

pub fn language_code(token: u32) -> &'static str {
    LANGUAGES[(token - FIRST_LANGUAGE) as usize]
}

fn window(model: &Whisper, samples: &[f32], stop: &dyn Fn() -> bool) -> Result<Cross, AlignError> {
    let encoded = model.encode(&log_mel(samples, &model.mel_filters, model.hparams.n_mels), stop)?;
    Ok(model.cross(&encoded))
}

pub fn transcribe(model: &Whisper, audio: &[f32], hint: Option<&str>, progress: &dyn Fn(f32), stop: &dyn Fn() -> bool) -> Result<Transcript, AlignError> {
    let language = detect_language(model, audio, hint, stop)?;
    let blank = model.tokenizer.encode(" ");
    let mut random = Random(0x9e37_79b9_7f4a_7c15);
    let mut segments = Vec::new();
    let mut seek = 0;
    while seek + SAMPLE_RATE / 2 < audio.len() {
        let samples = &audio[seek..(seek + WINDOW_SAMPLES).min(audio.len())];
        let window_ms = (samples.len() * 1000 / SAMPLE_RATE) as u32;
        let cross = window(model, samples, stop)?;
        let mut cache = Cache::default();
        let mut first = model.step(&[SOT], &cross, &mut cache);
        softmax(&mut first);
        let no_speech = first[NO_SPEECH as usize];
        let after_prompt = model.step(&[language, TRANSCRIBE], &cross, &mut cache);
        let mut attempt = None;
        for temperature in TEMPERATURES {
            if stop() {
                return Err(AlignError::Cancelled);
            }
            let tried = sample(model, &cross, cache.clone(), after_prompt.clone(), temperature, window_ms, &blank, &mut random);
            let settled = tried.compression <= MAX_COMPRESSION && tried.avg_logprob >= MIN_AVG_LOGPROB;
            let silent = no_speech > MIN_NO_SPEECH && tried.avg_logprob < MIN_AVG_LOGPROB;
            attempt = Some(tried);
            if settled || silent {
                break;
            }
        }
        let attempt = attempt.expect("one temperature at least");
        let offset_ms = (seek * 1000 / SAMPLE_RATE) as u32;
        let (found, consumed_ms) = segments_of(&attempt.tokens, window_ms);
        let silent = no_speech > MIN_NO_SPEECH && attempt.avg_logprob < MIN_AVG_LOGPROB;
        let failed = attempt.compression > MAX_COMPRESSION || attempt.avg_logprob < MIN_KEPT_LOGPROB;
        if !failed {
            for (start_ms, end_ms, tokens) in found {
                if let Some(text) = sung(&model.tokenizer.decode(&tokens)) {
                    segments.push(Segment { start_ms: offset_ms + start_ms, end_ms: offset_ms + end_ms, text, avg_logprob: attempt.avg_logprob });
                }
            }
        }
        let consumed_ms = if silent || consumed_ms == 0 {
            window_ms
        } else if failed {
            FAILED_STEP_MS.min(window_ms)
        } else {
            consumed_ms
        };
        seek += consumed_ms as usize * SAMPLE_RATE / 1000;
        progress((seek as f32 / audio.len() as f32).min(1.0));
    }
    Ok(Transcript { language: language_code(language), segments })
}

struct Attempt {
    tokens: Vec<u32>,
    avg_logprob: f32,
    compression: f32,
}

/// xorshift64*, so the fallback temperatures give the same result every run.
struct Random(u64);

impl Random {
    fn next(&mut self) -> f32 {
        self.0 ^= self.0 >> 12;
        self.0 ^= self.0 << 25;
        self.0 ^= self.0 >> 27;
        (self.0.wrapping_mul(0x2545_f491_4f6c_dd1d) >> 40) as f32 / (1u64 << 24) as f32
    }
}

#[allow(clippy::too_many_arguments)]
fn sample(model: &Whisper, cross: &Cross, mut cache: Cache, mut logits: Vec<f32>, temperature: f32, window_ms: u32, blank: &[u32], random: &mut Random) -> Attempt {
    let last_timestamp = FIRST_TIMESTAMP + window_ms / TIMESTAMP_MS;
    let mut tokens = Vec::new();
    let mut sum = 0.0;
    loop {
        timestamp_rules(&mut logits, &tokens, last_timestamp, blank);
        let log_probs = log_softmax(&logits);
        let token = if temperature == 0.0 { argmax(&logits) } else { pick(&logits, temperature, random) };
        sum += log_probs[token as usize];
        if token == EOT || tokens.len() == MAX_SAMPLED {
            break;
        }
        tokens.push(token);
        logits = model.step(&[token], cross, &mut cache);
    }
    let compression = compression_ratio(&model.tokenizer.decode(&tokens));
    Attempt { avg_logprob: sum / (tokens.len() + 1) as f32, tokens, compression }
}

/// Timestamps open and close each segment in pairs and never go back.
fn timestamp_rules(logits: &mut [f32], sampled: &[u32], last_timestamp: u32, blank: &[u32]) {
    let ban = |logits: &mut [f32], range: std::ops::Range<usize>| logits[range].fill(f32::NEG_INFINITY);
    let (first, vocab) = (FIRST_TIMESTAMP as usize, logits.len());
    ban(logits, EOT as usize + 1..first);
    ban(logits, (last_timestamp as usize + 1).min(vocab)..vocab);
    let is_timestamp = |token: &u32| *token >= FIRST_TIMESTAMP;
    if sampled.is_empty() {
        blank.iter().for_each(|token| logits[*token as usize] = f32::NEG_INFINITY);
        ban(logits, 0..first);
        ban(logits, (first + MAX_INITIAL_TIMESTAMP as usize + 1).min(vocab)..vocab);
    }
    let last_was_timestamp = sampled.last().is_some_and(is_timestamp);
    let penultimate_was_timestamp = sampled.len() < 2 || is_timestamp(&sampled[sampled.len() - 2]);
    if last_was_timestamp {
        if penultimate_was_timestamp {
            ban(logits, first..vocab);
        } else {
            ban(logits, 0..EOT as usize);
        }
    }
    if let Some(last) = sampled.iter().rev().find(|t| is_timestamp(t)) {
        let floor = if last_was_timestamp && !penultimate_was_timestamp { *last } else { last + 1 };
        ban(logits, first..(floor as usize).min(vocab));
    }
    let log_probs = log_softmax(logits);
    let top = log_probs[first..].iter().copied().fold(f32::NEG_INFINITY, f32::max);
    if top == f32::NEG_INFINITY {
        return;
    }
    let timestamps = top + log_probs[first..].iter().map(|p| (p - top).exp()).sum::<f32>().ln();
    if timestamps > log_probs[..first].iter().copied().fold(f32::NEG_INFINITY, f32::max) {
        ban(logits, 0..first);
    }
}

fn log_softmax(logits: &[f32]) -> Vec<f32> {
    let top = logits.iter().copied().fold(f32::NEG_INFINITY, f32::max);
    let log_sum = logits.iter().map(|v| (v - top).exp()).sum::<f32>().ln() + top;
    logits.iter().map(|v| v - log_sum).collect()
}

fn argmax(values: &[f32]) -> u32 {
    (0..values.len()).max_by(|a, b| values[*a].total_cmp(&values[*b])).expect("a vocabulary") as u32
}

fn pick(logits: &[f32], temperature: f32, random: &mut Random) -> u32 {
    let mut weights: Vec<f32> = logits.iter().map(|v| v / temperature).collect();
    softmax(&mut weights);
    let mut left = random.next();
    for (token, weight) in weights.iter().enumerate() {
        left -= weight;
        if left <= 0.0 {
            return token as u32;
        }
    }
    argmax(logits)
}

fn compression_ratio(text: &str) -> f32 {
    if text.is_empty() {
        return 0.0;
    }
    let mut encoder = flate2::write::ZlibEncoder::new(Vec::new(), flate2::Compression::default());
    encoder.write_all(text.as_bytes()).expect("writing to memory");
    text.len() as f32 / encoder.finish().expect("writing to memory").len() as f32
}

/// Times in ms from the window start, and how much of the window the segments used.
fn segments_of(tokens: &[u32], window_ms: u32) -> (Vec<(u32, u32, Vec<u32>)>, u32) {
    let is_timestamp = |token: u32| token >= FIRST_TIMESTAMP;
    let ms = |token: u32| (token - FIRST_TIMESTAMP) * TIMESTAMP_MS;
    let n = tokens.len();
    let single_ending = n >= 2 && !is_timestamp(tokens[n - 2]) && is_timestamp(tokens[n - 1]);
    let mut cuts: Vec<usize> = (1..n).filter(|i| is_timestamp(tokens[*i]) && is_timestamp(tokens[i - 1])).collect();
    if cuts.is_empty() {
        let start = tokens.first().copied().filter(|t| is_timestamp(*t)).map_or(0, ms);
        let end = tokens.iter().rev().copied().find(|t| is_timestamp(*t)).map_or(window_ms, ms).max(start);
        let text = tokens.iter().copied().filter(|t| !is_timestamp(*t)).collect();
        return (vec![(start, if end > start { end } else { window_ms }, text)], window_ms);
    }
    if single_ending {
        cuts.push(n);
    }
    let mut out = Vec::new();
    let mut last = 0;
    for cut in cuts {
        let slice = &tokens[last..cut];
        out.push((ms(slice[0]), ms(slice[slice.len() - 1]), slice.iter().copied().filter(|t| !is_timestamp(*t)).collect()));
        last = cut;
    }
    (out, if single_ending { window_ms } else { ms(tokens[last - 1]) })
}

pub fn sung(text: &str) -> Option<String> {
    let text = text.replace(['♪', '♫', '♬', '♩'], " ").split_whitespace().collect::<Vec<_>>().join(" ");
    let lower = text.to_lowercase();
    let cue = [('[', ']'), ('(', ')'), ('*', '*')].iter().any(|(open, close)| lower.starts_with(*open) && lower.ends_with(*close));
    let has_letters = lower.chars().any(char::is_alphabetic);
    (has_letters && !cue && !ARTEFACTS.iter().any(|phrase| lower.contains(phrase))).then_some(text)
}

pub fn lines_of(segments: &[Segment]) -> Vec<Line> {
    segments
        .iter()
        .enumerate()
        .map(|(i, segment)| {
            let next = segments.get(i + 1).map_or(u32::MAX, |s| s.start_ms.max(segment.start_ms));
            Line { start_ms: segment.start_ms, end_ms: segment.end_ms.min(next).max(segment.start_ms), text: segment.text.clone() }
        })
        .collect()
}

/// A comma or a long run splits a line only when enough words are left for another.
pub fn split_lines(lines: Vec<TimedLine>) -> Vec<TimedLine> {
    let mut out = Vec::new();
    for line in lines {
        let mut current: Vec<crate::Word> = Vec::new();
        let count = line.words.len();
        for (at, word) in line.words.into_iter().enumerate() {
            if let Some(previous) = current.last() {
                let pause = word.start_ms.saturating_sub(previous.end_ms) >= LINE_PAUSE_MS;
                let sentence = previous.text.ends_with(['.', '!', '?', '…']);
                let room = count - at >= MIN_REST_WORDS;
                let comma = room && previous.text.ends_with([',', ';', ':']) && current.len() >= COMMA_LINE_WORDS;
                if pause || sentence || comma || (room && current.len() >= MAX_LINE_WORDS) {
                    out.push(TimedLine { words: std::mem::take(&mut current), confidence: line.confidence });
                }
            }
            current.push(word);
        }
        if !current.is_empty() {
            out.push(TimedLine { words: current, confidence: line.confidence });
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Word;

    const T0: u32 = FIRST_TIMESTAMP;

    #[test]
    fn pairs_of_timestamps_cut_segments_and_a_cut_off_one_sets_the_next_window() {
        let tokens = [T0, 10, 11, T0 + 100, T0 + 100, 12, T0 + 250, T0 + 260, 13];
        let (segments, consumed) = segments_of(&tokens, 30_000);
        assert_eq!(segments, [(0, 2_000, vec![10, 11]), (2_000, 5_000, vec![12])]);
        assert_eq!(consumed, 5_000, "the unfinished segment is read again in the next window");
        let (segments, consumed) = segments_of(&[T0 + 5, 10, T0 + 50, T0 + 60, 11, T0 + 90], 30_000);
        assert_eq!(segments, [(100, 1_000, vec![10]), (1_200, 1_800, vec![11])]);
        assert_eq!(consumed, 30_000, "a closed last segment uses the whole window");
        assert_eq!(segments_of(&[10, 11], 12_000), (vec![(0, 12_000, vec![10, 11])], 12_000));
    }

    fn open_logits() -> Vec<f32> {
        vec![0.0; FIRST_TIMESTAMP as usize + 1501]
    }

    #[test]
    fn a_window_opens_with_an_early_timestamp() {
        let mut logits = open_logits();
        timestamp_rules(&mut logits, &[], T0 + 1500, &[220]);
        let allowed: Vec<usize> = (0..logits.len()).filter(|i| logits[*i].is_finite()).collect();
        assert_eq!(allowed, (T0 as usize..=T0 as usize + 50).collect::<Vec<_>>());
    }

    #[test]
    fn timestamps_come_in_pairs_and_never_go_back() {
        let mut logits = open_logits();
        timestamp_rules(&mut logits, &[T0 + 10, 400, T0 + 80], T0 + 1500, &[220]);
        assert!(logits[400] == f32::NEG_INFINITY, "a closing timestamp is followed by another or the end");
        assert!(logits[T0 as usize + 80].is_finite() && logits[T0 as usize + 79] == f32::NEG_INFINITY);
        let mut logits = open_logits();
        timestamp_rules(&mut logits, &[T0 + 10, 400, T0 + 80, T0 + 80], T0 + 1500, &[220]);
        assert!(logits[400].is_finite() && logits[T0 as usize + 90] == f32::NEG_INFINITY, "a pair opens text");
        let mut logits = open_logits();
        timestamp_rules(&mut logits, &[T0 + 10, 400], T0 + 600, &[220]);
        assert!(logits[T0 as usize + 601] == f32::NEG_INFINITY && logits[SOT as usize] == f32::NEG_INFINITY);
    }

    #[test]
    fn likely_timestamps_push_text_aside() {
        let mut logits = open_logits();
        logits[T0 as usize + 20..T0 as usize + 400].fill(2.0);
        timestamp_rules(&mut logits, &[T0 + 10, 400], T0 + 1500, &[220]);
        assert!(logits[400] == f32::NEG_INFINITY && logits[T0 as usize + 30].is_finite());
    }

    #[test]
    fn music_marks_cues_and_credits_are_not_sung() {
        assert_eq!(sung(" ♪ Hold the line ♪"), Some("Hold the line".into()));
        assert_eq!(sung(" ♪♪"), None);
        assert_eq!(sung("[Music]"), None);
        assert_eq!(sung("(музыка)"), None);
        assert_eq!(sung("Субтитры сделала Анна"), None);
        assert_eq!(sung("Thanks for watching!"), None);
        assert_eq!(sung("..."), None);
    }

    #[test]
    fn loops_pack_well_and_lyrics_do_not() {
        assert!(compression_ratio(&"I'm so sorry ".repeat(20)) > MAX_COMPRESSION);
        assert!(compression_ratio("Солнце встаёт над тихой рекой, мы поём до самого утра") < MAX_COMPRESSION);
    }

    fn split(words: &[(u32, &str)]) -> Vec<Vec<String>> {
        let words = words.iter().map(|(start_ms, text)| Word { start_ms: *start_ms, end_ms: start_ms + 300, text: text.to_string() }).collect();
        split_lines(vec![TimedLine { words, confidence: 0.5 }]).iter().map(|l| l.words.iter().map(|w| w.text.clone()).collect()).collect()
    }

    #[test]
    fn segments_split_at_pauses_sentences_and_long_comma_runs() {
        let texts = split(&[(0, "one"), (300, "two."), (600, "three"), (900, "four"), (2_000, "five"), (2_300, "a,"), (2_600, "b"), (2_900, "c"), (3_200, "d"), (3_500, "e,"), (3_800, "f"), (4_100, "g"), (4_400, "h")]);
        assert_eq!(texts, [vec!["one", "two."], vec!["three", "four"], vec!["five", "a,", "b", "c", "d", "e,"], vec!["f", "g", "h"]]);
    }

    #[test]
    fn a_comma_or_a_long_run_never_leaves_a_word_or_two_alone() {
        let texts = split(&[(0, "you're"), (300, "blind,"), (600, "you're"), (900, "blind,"), (1_200, "you're"), (1_500, "blind,"), (1_800, "you're"), (2_100, "blind")]);
        assert_eq!(texts.len(), 1, "{texts:?}");
        let long: Vec<(u32, String)> = (0..14).map(|i| (i * 300, format!("w{i}"))).collect();
        let long: Vec<(u32, &str)> = long.iter().map(|(at, text)| (*at, text.as_str())).collect();
        assert_eq!(split(&long).iter().map(Vec::len).collect::<Vec<_>>(), [14]);
        let longer: Vec<(u32, String)> = (0..16).map(|i| (i * 300, format!("w{i}"))).collect();
        let longer: Vec<(u32, &str)> = longer.iter().map(|(at, text)| (*at, text.as_str())).collect();
        assert_eq!(split(&longer).iter().map(Vec::len).collect::<Vec<_>>(), [12, 4]);
    }

    #[test]
    fn segment_lines_never_overlap() {
        let segment = |start_ms, end_ms| Segment { start_ms, end_ms, text: "la".into(), avg_logprob: -0.2 };
        let lines = lines_of(&[segment(0, 5_000), segment(4_000, 6_000)]);
        assert_eq!((lines[0].end_ms, lines[1].start_ms), (4_000, 4_000));
    }

    #[test]
    fn sampling_follows_the_weights() {
        let mut random = Random(7);
        let logits = [0.0, 3.0, f32::NEG_INFINITY];
        let picks: Vec<u32> = (0..200).map(|_| pick(&logits, 1.0, &mut random)).collect();
        let ones = picks.iter().filter(|t| **t == 1).count();
        assert!(ones > 170 && !picks.contains(&2), "{ones}");
    }
}
