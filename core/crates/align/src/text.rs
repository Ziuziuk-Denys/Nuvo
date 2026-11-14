// Words heard in the transcript anchor the lyric words, and the lyric lines take their times

use crate::align::{Line, words_of};
use crate::transcribe::Segment;

/// A rough sung word length for the words of a line outside its anchors.
const WORD_MS: u32 = 300;
const MIN_SIMILARITY: f32 = 0.6;

pub struct Placed {
    pub lines: Vec<Line>,
    pub matched: f32,
}

struct Heard {
    word: String,
    start_ms: u32,
    end_ms: u32,
}

fn normalize(word: &str) -> String {
    word.chars().filter(|c| c.is_alphanumeric()).flat_map(char::to_lowercase).map(|c| if c == 'ё' { 'е' } else { c }).collect()
}

fn similarity(a: &str, b: &str) -> f32 {
    let (a, b): (Vec<char>, Vec<char>) = (a.chars().collect(), b.chars().collect());
    let longest = a.len().max(b.len());
    if longest == 0 {
        return 0.0;
    }
    let mut row: Vec<usize> = (0..=b.len()).collect();
    for (i, ca) in a.iter().enumerate() {
        let mut diagonal = row[0];
        row[0] = i + 1;
        for (j, cb) in b.iter().enumerate() {
            let next = (diagonal + usize::from(ca != cb)).min(row[j] + 1).min(row[j + 1] + 1);
            diagonal = row[j + 1];
            row[j + 1] = next;
        }
    }
    1.0 - row[b.len()] as f32 / longest as f32
}

/// Each segment's time is spread over its words by letter count.
fn heard(segments: &[Segment]) -> Vec<Heard> {
    let mut out = Vec::new();
    for segment in segments {
        let words: Vec<String> = words_of(&segment.text).into_iter().map(normalize).filter(|w| !w.is_empty()).collect();
        let letters: usize = words.iter().map(|w| w.chars().count()).sum();
        let span = segment.end_ms.saturating_sub(segment.start_ms) as usize;
        let mut done = 0;
        for word in words {
            let length = word.chars().count();
            let start_ms = segment.start_ms + (span * done / letters.max(1)) as u32;
            done += length;
            out.push(Heard { word, start_ms, end_ms: segment.start_ms + (span * done / letters.max(1)) as u32 });
        }
    }
    out
}

/// An edit distance over words that charges near misses less.
fn matches(lyric: &[String], heard: &[Heard]) -> Vec<Option<usize>> {
    let (n, m) = (lyric.len(), heard.len());
    let width = m + 1;
    let mut cost = vec![0.0f32; (n + 1) * width];
    let mut step = vec![0u8; (n + 1) * width];
    for j in 1..=m {
        cost[j] = j as f32;
        step[j] = 2;
    }
    for i in 1..=n {
        cost[i * width] = i as f32;
        step[i * width] = 1;
        for j in 1..=m {
            let pair = cost[(i - 1) * width + j - 1] + 1.0 - similarity(&lyric[i - 1], &heard[j - 1].word);
            let (skip_lyric, skip_heard) = (cost[(i - 1) * width + j] + 1.0, cost[i * width + j - 1] + 1.0);
            let (best, how) = if pair <= skip_lyric && pair <= skip_heard { (pair, 0) } else if skip_lyric <= skip_heard { (skip_lyric, 1) } else { (skip_heard, 2) };
            cost[i * width + j] = best;
            step[i * width + j] = how;
        }
    }
    let mut out = vec![None; n];
    let (mut i, mut j) = (n, m);
    while i > 0 || j > 0 {
        match step[i * width + j] {
            0 => {
                if similarity(&lyric[i - 1], &heard[j - 1].word) >= MIN_SIMILARITY {
                    out[i - 1] = Some(j - 1);
                }
                (i, j) = (i - 1, j - 1);
            }
            1 => i -= 1,
            _ => j -= 1,
        }
    }
    out
}

/// Lines with no anchored word share the time between their neighbours by length.
pub fn place(lines: &[String], segments: &[Segment], audio_ms: u32) -> Placed {
    let heard = heard(segments);
    let words: Vec<Vec<String>> = lines.iter().map(|line| words_of(line).into_iter().map(normalize).collect()).collect();
    let flat: Vec<String> = words.iter().flatten().cloned().collect();
    let anchors = matches(&flat, &heard);
    let mut spans: Vec<Option<(u32, u32)>> = Vec::with_capacity(lines.len());
    let mut first = 0;
    for line in &words {
        let range = first..first + line.len();
        let anchored: Vec<(usize, usize)> = range.clone().filter_map(|i| anchors[i].map(|j| (i, j))).collect();
        spans.push(anchored.first().zip(anchored.last()).map(|(&(i, j), &(k, l))| {
            let before = (i - range.start) as u32 * WORD_MS;
            let after = (range.end - 1 - k) as u32 * WORD_MS;
            (heard[j].start_ms.saturating_sub(before), (heard[l].end_ms + after).min(audio_ms))
        }));
        first = range.end;
    }
    let mut out: Vec<Line> = Vec::with_capacity(lines.len());
    let mut at = 0;
    while at < lines.len() {
        if let Some((start_ms, end_ms)) = spans[at] {
            let start_ms = start_ms.max(out.last().map_or(0, |l| l.start_ms));
            out.push(Line { start_ms, end_ms: end_ms.max(start_ms), text: lines[at].clone() });
            at += 1;
            continue;
        }
        let run_end = (at..lines.len()).find(|i| spans[*i].is_some()).unwrap_or(lines.len());
        let from = out.last().map_or(0, |l| l.end_ms);
        let to = spans.get(run_end).copied().flatten().map_or(audio_ms, |(start_ms, _)| start_ms).max(from);
        let total: usize = words[at..run_end].iter().map(|w| w.len().max(1)).sum();
        let mut done = 0;
        for i in at..run_end {
            let start_ms = from + ((to - from) as usize * done / total) as u32;
            done += words[i].len().max(1);
            out.push(Line { start_ms, end_ms: from + ((to - from) as usize * done / total) as u32, text: lines[i].clone() });
        }
        at = run_end;
    }
    for i in 0..out.len().saturating_sub(1) {
        out[i].end_ms = out[i].end_ms.min(out[i + 1].start_ms).max(out[i].start_ms);
    }
    let matched = anchors.iter().filter(|a| a.is_some()).count() as f32 / flat.len().max(1) as f32;
    Placed { lines: out, matched }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn segment(start_ms: u32, end_ms: u32, text: &str) -> Segment {
        Segment { start_ms, end_ms, text: text.into(), avg_logprob: -0.3 }
    }

    #[test]
    fn words_compare_without_case_punctuation_or_yo() {
        assert_eq!(normalize("Слёзы,"), "слезы");
        assert_eq!(similarity("слезы", "слезы"), 1.0);
        assert!(similarity("running", "runnin") > 0.8);
        assert!(similarity("river", "town") < MIN_SIMILARITY);
    }

    #[test]
    fn heard_words_share_their_segment_by_length() {
        let words = heard(&[segment(1_000, 2_000, "ab, cd!")]);
        let spans: Vec<(&str, u32, u32)> = words.iter().map(|w| (w.word.as_str(), w.start_ms, w.end_ms)).collect();
        assert_eq!(spans, [("ab", 1_000, 1_500), ("cd", 1_500, 2_000)]);
    }

    #[test]
    fn misheard_and_missing_words_still_anchor_the_rest() {
        let lyric: Vec<String> = ["the", "river", "runs", "along", "the", "town"].iter().map(|w| w.to_string()).collect();
        let heard = heard(&[segment(0, 600, "the rivers"), segment(600, 1_000, "um along the town")]);
        assert_eq!(matches(&lyric, &heard), [Some(0), Some(1), None, Some(3), Some(4), Some(5)]);
    }

    #[test]
    fn lines_take_their_anchors_and_the_unheard_ones_fill_the_gap() {
        let lines: Vec<String> = ["Hold the line", "nobody sang this here", "and never let go"].iter().map(|l| l.to_string()).collect();
        let segments = [segment(10_000, 12_000, "hold the line"), segment(20_000, 22_000, "and never let go")];
        let placed = place(&lines, &segments, 60_000);
        let stamps: Vec<(u32, u32)> = placed.lines.iter().map(|l| (l.start_ms, l.end_ms)).collect();
        assert_eq!(stamps, [(10_000, 12_000), (12_000, 20_000), (20_000, 22_000)]);
        assert!((placed.matched - 7.0 / 11.0).abs() < 1e-6);
    }

    #[test]
    fn words_before_the_first_anchor_move_the_line_start_back() {
        let lines = vec!["oh well hold the line".to_string()];
        let placed = place(&lines, &[segment(10_000, 12_000, "hold the line")], 60_000);
        assert_eq!(placed.lines[0].start_ms, 10_000 - 2 * WORD_MS);
    }
}
