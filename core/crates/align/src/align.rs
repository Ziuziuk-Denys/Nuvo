// Forced alignment: the known words go through the decoder and DTW walks the alignment heads' attention

use std::ops::Range;

use crate::AlignError;
use crate::mel::{SAMPLE_RATE, log_mel};
use crate::model::{Whisper, softmax};
use crate::tokenizer::{EOT, FIRST_LANGUAGE, NO_TIMESTAMPS, SOT, TRANSCRIBE, TRANSLATE};

/// Each audio state covers 20 ms.
const STATE_MS: u32 = 20;
const MAX_WINDOW_MS: u32 = 29_000;
/// Line stamps are often early or late by a fraction of a second.
const LEAD_MS: u32 = 1_000;
const TAIL_MS: u32 = 500;
const MEDIAN_WIDTH: usize = 7;
/// Room for the four prompt tokens and the end token in the 448-token context.
const MAX_TEXT_TOKENS: usize = 400;
/// How far the words of a line may stray outside its stamps.
const BAND_MS: u32 = 1_500;
const LONG_WORD_FACTOR: u32 = 4;
const MIN_LONG_WORD_MS: u32 = 1_200;
const FIRST_WORD_FACTOR: u32 = 2;
const MIN_FIRST_WORD_MS: u32 = 600;

#[derive(Debug, Clone, PartialEq)]
pub struct Line {
    pub start_ms: u32,
    pub end_ms: u32,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Word {
    pub start_ms: u32,
    pub end_ms: u32,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct TimedLine {
    pub words: Vec<Word>,
    /// Mean probability the model gave the line's tokens; near zero when the words are not sung there.
    pub confidence: f32,
}

#[derive(Debug, PartialEq)]
pub struct Chunk {
    pub lines: Range<usize>,
    pub from_ms: u32,
    pub to_ms: u32,
}

/// Groups neighbouring lines into windows of at most 29 s that the encoder reads at once.
pub fn plan(lines: &[Line], token_counts: &[usize], audio_ms: u32) -> Vec<Chunk> {
    let mut chunks = Vec::new();
    let mut at = 0;
    while at < lines.len() {
        let from_ms = lines[at].start_ms.saturating_sub(LEAD_MS);
        let limit = (from_ms + MAX_WINDOW_MS).min(audio_ms);
        let mut end = at + 1;
        let mut tokens = token_counts[at];
        while end < lines.len() && lines[end].end_ms + TAIL_MS <= limit && tokens + token_counts[end] <= MAX_TEXT_TOKENS {
            tokens += token_counts[end];
            end += 1;
        }
        let to_ms = (lines[end - 1].end_ms + TAIL_MS).clamp(from_ms.min(limit), limit);
        chunks.push(Chunk { lines: at..end, from_ms, to_ms });
        at = end;
    }
    chunks
}

/// Splits a line into words the way they are shown; each keeps its own punctuation.
pub fn words_of(text: &str) -> Vec<&str> {
    text.split_whitespace().collect()
}

pub fn align(model: &Whisper, audio: &[f32], lines: &[Line], progress: &dyn Fn(f32), stop: &dyn Fn() -> bool) -> Result<Vec<TimedLine>, AlignError> {
    let audio_ms = (audio.len() as u64 * 1000 / SAMPLE_RATE as u64) as u32;
    let tokenized: Vec<Vec<Vec<u32>>> = lines
        .iter()
        .map(|line| words_of(&line.text).iter().enumerate().map(|(i, word)| model.tokenizer.encode(&if i == 0 { (*word).to_string() } else { format!(" {word}") })).collect())
        .collect();
    let counts: Vec<usize> = tokenized.iter().map(|words| words.iter().map(Vec::len).sum()).collect();
    if counts.iter().any(|count| *count > MAX_TEXT_TOKENS) {
        return Err(AlignError::TooLong);
    }
    let chunks = plan(lines, &counts, audio_ms);
    let mut out = Vec::with_capacity(lines.len());
    for (done, chunk) in chunks.iter().enumerate() {
        if stop() {
            return Err(AlignError::Cancelled);
        }
        let from = chunk.from_ms as usize * SAMPLE_RATE / 1000;
        let to = (chunk.to_ms as usize * SAMPLE_RATE / 1000).min(audio.len());
        let frame = |ms: u32| (ms.saturating_sub(chunk.from_ms) / STATE_MS) as usize;
        let mut pieces = Vec::new();
        for i in chunk.lines.clone() {
            let next = if i + 1 < chunk.lines.end { lines[i + 1].start_ms + BAND_MS } else { u32::MAX };
            let band = frame(lines[i].start_ms.saturating_sub(BAND_MS))..frame(next);
            pieces.extend(words_of(&lines[i].text).into_iter().zip(&tokenized[i]).enumerate().map(|(at, (text, tokens))| Piece { text, tokens, band: band.clone(), opens_line: at == 0 }));
        }
        let mut timed = align_window(model, &audio[from.min(to)..to], &pieces, stop)?.into_iter();
        for i in chunk.lines.clone() {
            let line_words: Vec<(Word, f32)> = timed.by_ref().take(tokenized[i].len()).collect();
            let confidence = if line_words.is_empty() { 0.0 } else { line_words.iter().map(|(_, p)| p).sum::<f32>() / line_words.len() as f32 };
            let words = line_words
                .into_iter()
                .map(|(word, _)| Word { start_ms: word.start_ms + chunk.from_ms, end_ms: word.end_ms + chunk.from_ms, text: word.text })
                .collect();
            out.push(TimedLine { words, confidence });
        }
        progress((done + 1) as f32 / chunks.len() as f32);
    }
    Ok(out)
}

/// A word to place, with the audio states its line may cover.
struct Piece<'a> {
    text: &'a str,
    tokens: &'a [u32],
    band: Range<usize>,
    opens_line: bool,
}

/// Word times inside one window, with the mean probability of each word's tokens.
fn align_window(model: &Whisper, samples: &[f32], pieces: &[Piece], stop: &dyn Fn() -> bool) -> Result<Vec<(Word, f32)>, AlignError> {
    let mel = log_mel(samples, &model.mel_filters, model.hparams.n_mels);
    let encoded = model.encode(&mel, stop)?;
    let cross = model.cross(&encoded);
    let frames = (samples.len() * 1000 / SAMPLE_RATE).div_ceil(STATE_MS as usize).clamp(1, model.hparams.n_audio_ctx);
    let language = {
        let decoded = model.decode(&[SOT], &cross, frames);
        let log_probs = model.log_probs(&decoded, 0);
        (FIRST_LANGUAGE..TRANSLATE).max_by(|a, b| log_probs[*a as usize].total_cmp(&log_probs[*b as usize])).expect("languages")
    };
    let prompt = [SOT, language, TRANSCRIBE, NO_TIMESTAMPS];
    let text: Vec<u32> = pieces.iter().flat_map(|piece| piece.tokens.iter().copied()).collect();
    let tokens: Vec<u32> = prompt.iter().copied().chain(text.iter().copied()).chain([EOT]).collect();
    let decoded = model.decode(&tokens, &cross, frames);
    let probabilities: Vec<f32> = (0..text.len()).map(|i| model.log_probs(&decoded, prompt.len() - 1 + i)[text[i] as usize].exp()).collect();
    let matrix = attention_matrix(&decoded.scores, model.alignment_heads.len(), tokens.len(), frames, prompt.len() - 1..tokens.len() - 1);
    // the row of a token is the one that predicts it; the last row predicts the end
    let mut bands: Vec<Range<usize>> = pieces.iter().flat_map(|piece| std::iter::repeat_n(piece.band.start.min(frames)..piece.band.end.min(frames), piece.tokens.len())).collect();
    bands.push(bands.last().map_or(0, |band| band.start)..frames);
    let (rows, columns) = dtw(&matrix, text.len() + 1, frames, &bands).unwrap_or_else(|| dtw(&matrix, text.len() + 1, frames, &vec![0..frames; text.len() + 1]).expect("an open band always has a path"));
    let jumps: Vec<u32> = rows
        .iter()
        .enumerate()
        .filter(|(i, row)| *i == 0 || rows[i - 1] != **row)
        .map(|(i, _)| columns[i] as u32 * STATE_MS)
        .collect();
    let mut out = Vec::with_capacity(pieces.len());
    let mut boundary = 0;
    for piece in pieces {
        let next = boundary + piece.tokens.len();
        let start_ms = (jumps[boundary] + jumps[boundary + 1]) / 2;
        let end_ms = jumps.get(next).zip(jumps.get(next + 1)).map(|(a, b)| (a + b) / 2).unwrap_or(frames as u32 * STATE_MS).max(start_ms);
        let probability = probabilities[boundary..next].iter().sum::<f32>() / piece.tokens.len().max(1) as f32;
        out.push((Word { start_ms, end_ms, text: piece.text.to_string() }, probability));
        boundary = next;
    }
    let opens: Vec<bool> = pieces.iter().map(|piece| piece.opens_line).collect();
    cap_long_words(&mut out, &opens);
    Ok(out)
}

/// A word far longer than its neighbours swallowed a pause: the first word of a line the one before it, any other the one after.
fn cap_long_words(words: &mut [(Word, f32)], opens_line: &[bool]) {
    let mut durations: Vec<u32> = words.iter().map(|(w, _)| w.end_ms - w.start_ms).collect();
    durations.sort_unstable();
    let Some(median) = durations.get(durations.len() / 2).copied() else { return };
    for ((word, _), opens) in words.iter_mut().zip(opens_line) {
        if *opens {
            word.start_ms = word.start_ms.max(word.end_ms.saturating_sub((median * FIRST_WORD_FACTOR).max(MIN_FIRST_WORD_MS)));
        } else {
            word.end_ms = word.end_ms.min(word.start_ms + (median * LONG_WORD_FACTOR).max(MIN_LONG_WORD_MS));
        }
    }
}

/// Softmax over the audio, z-score over the tokens, a median filter over time, then the mean of the heads.
fn attention_matrix(scores: &[f32], heads: usize, tokens: usize, frames: usize, keep: Range<usize>) -> Vec<f32> {
    let mut weights = scores.to_vec();
    weights.chunks_exact_mut(frames).for_each(softmax);
    for head in weights.chunks_exact_mut(tokens * frames) {
        for frame in 0..frames {
            let column = || (0..tokens).map(|t| t * frames + frame);
            let mean = column().map(|i| head[i]).sum::<f32>() / tokens as f32;
            let deviation = (column().map(|i| (head[i] - mean).powi(2)).sum::<f32>() / tokens as f32).sqrt().max(1e-10);
            column().for_each(|i| head[i] = (head[i] - mean) / deviation);
        }
        head.chunks_exact_mut(frames).for_each(|row| median_filter(row, MEDIAN_WIDTH));
    }
    let rows = keep.len();
    let mut matrix = vec![0.0; rows * frames];
    for head in weights.chunks_exact(tokens * frames) {
        for (out, value) in matrix.iter_mut().zip(&head[keep.start * frames..keep.end * frames]) {
            *out += value / heads as f32;
        }
    }
    matrix
}

fn median_filter(row: &mut [f32], width: usize) {
    let half = width / 2;
    if row.len() <= half {
        return;
    }
    let source = row.to_vec();
    let last = source.len() as isize - 1;
    let mut window = Vec::with_capacity(width);
    for (at, out) in row.iter_mut().enumerate() {
        window.clear();
        for offset in -(half as isize)..=half as isize {
            let i = at as isize + offset;
            let reflected = if i < 0 { -i } else if i > last { 2 * last - i } else { i };
            window.push(source[reflected.clamp(0, last) as usize]);
        }
        window.sort_by(f32::total_cmp);
        *out = window[half];
    }
}

/// The cheapest monotonic path through `-matrix` with each row kept to its band; it may start at any column.
/// Returns the token row and audio column of each step, or None when the bands leave no path.
fn dtw(matrix: &[f32], rows: usize, columns: usize, bands: &[Range<usize>]) -> Option<(Vec<usize>, Vec<usize>)> {
    let width = columns + 1;
    let mut cost = vec![f32::INFINITY; (rows + 1) * width];
    let mut trace = vec![0u8; (rows + 1) * width];
    cost[..width].fill(0.0);
    for j in 1..=columns {
        for i in 1..=rows {
            if !bands[i - 1].contains(&(j - 1)) {
                continue;
            }
            let (diagonal, up, left) = (cost[(i - 1) * width + j - 1], cost[(i - 1) * width + j], cost[i * width + j - 1]);
            let (best, step) = if diagonal <= up && diagonal <= left {
                (diagonal, 0)
            } else if up <= left {
                (up, 1)
            } else {
                (left, 2)
            };
            cost[i * width + j] = -matrix[(i - 1) * columns + j - 1] + best;
            trace[i * width + j] = step;
        }
    }
    if !cost[rows * width + columns].is_finite() {
        return None;
    }
    let (mut i, mut j) = (rows, columns);
    let (mut path_rows, mut path_columns) = (Vec::new(), Vec::new());
    while i > 0 && j > 0 {
        path_rows.push(i - 1);
        path_columns.push(j - 1);
        match trace[i * width + j] {
            0 => (i, j) = (i - 1, j - 1),
            1 => i -= 1,
            _ => j -= 1,
        }
    }
    path_rows.reverse();
    path_columns.reverse();
    Some((path_rows, path_columns))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn line(start_ms: u32, end_ms: u32) -> Line {
        Line { start_ms, end_ms, text: "la la".into() }
    }

    #[test]
    fn windows_hold_whole_lines_under_29_seconds() {
        let lines = [line(5_000, 9_000), line(9_000, 20_000), line(20_000, 33_000), line(33_000, 36_000)];
        let chunks = plan(&lines, &[2, 2, 2, 2], 60_000);
        assert_eq!(chunks, [Chunk { lines: 0..2, from_ms: 4_000, to_ms: 20_500 }, Chunk { lines: 2..4, from_ms: 19_000, to_ms: 36_500 }]);
    }

    #[test]
    fn a_long_line_is_cut_to_the_window() {
        let chunks = plan(&[line(1_000, 80_000)], &[2], 90_000);
        assert_eq!(chunks, [Chunk { lines: 0..1, from_ms: 0, to_ms: 29_000 }]);
    }

    #[test]
    fn windows_stop_at_the_end_of_the_audio() {
        let chunks = plan(&[line(10_000, 15_000)], &[2], 12_000);
        assert_eq!(chunks, [Chunk { lines: 0..1, from_ms: 9_000, to_ms: 12_000 }]);
    }

    #[test]
    fn dtw_follows_the_bright_cells() {
        // token 0 lights frames 0 to 1, token 1 frames 2 to 4
        let matrix = [1.0, 0.9, 0.1, 0.0, 0.0, 0.0, -1.0, 0.8, 1.0, 0.9];
        let (rows, columns) = dtw(&matrix, 2, 5, &[0..5, 0..5]).unwrap();
        let first = |row| columns[rows.iter().position(|r| *r == row).unwrap()];
        assert_eq!((first(0), first(1)), (0, 2));
        assert_eq!(columns.last(), Some(&4));
    }

    #[test]
    fn dtw_may_start_late_and_keeps_rows_in_their_bands() {
        let matrix = [-1.0, -1.0, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0, 1.0];
        let (rows, columns) = dtw(&matrix, 2, 5, &[0..5, 0..5]).unwrap();
        assert_eq!((rows[0], columns[0]), (0, 2), "the dull start is skipped");
        let (rows, columns) = dtw(&matrix, 2, 5, &[0..5, 4..5]).unwrap();
        assert_eq!(columns[rows.iter().position(|r| *r == 1).unwrap()], 4);
        assert!(dtw(&matrix, 2, 5, &[0..2, 3..5]).is_none(), "a gap between bands has no path");
    }

    #[test]
    fn long_words_lose_the_pause_on_the_right_side() {
        let word = |start_ms, end_ms| (Word { start_ms, end_ms, text: String::new() }, 1.0);
        let mut words: Vec<_> = std::iter::once(word(0, 3_000)).chain((0..6).map(|i| word(3_000 + i * 300, 3_300 + i * 300))).chain([word(4_800, 10_200)]).collect();
        let opens: Vec<bool> = (0..words.len()).map(|i| i == 0).collect();
        cap_long_words(&mut words, &opens);
        assert_eq!((words[0].0.start_ms, words[0].0.end_ms), (2_400, 3_000));
        assert_eq!((words[1].0.start_ms, words[1].0.end_ms), (3_000, 3_300));
        assert_eq!((words[7].0.start_ms, words[7].0.end_ms), (4_800, 6_000));
    }

    #[test]
    fn the_median_filter_removes_spikes() {
        let mut row = [0.0, 0.0, 0.0, 9.0, 0.0, 0.0, 0.0, 0.0];
        median_filter(&mut row, 7);
        assert_eq!(row, [0.0; 8]);
    }
}
