use crate::align::{Line, TimedLine};

/// A line runs to the next stamp, but not into a long instrumental break.
const MAX_LINE_MS: u32 = 10_000;

fn stamp(text: &str) -> Option<u32> {
    let (minutes, seconds) = text.split_once(':')?;
    let minutes: u32 = minutes.trim().parse().ok()?;
    let seconds: f64 = seconds.trim().parse().ok().filter(|s: &f64| s.is_finite() && *s >= 0.0 && *s < 60.0)?;
    Some(minutes.checked_mul(60_000)? + (seconds * 1000.0).round() as u32)
}

/// Lines of a line-synced LRC with `offset_ms` applied; an empty stamped line ends the one before it.
pub fn parse_lrc(content: &str, offset_ms: i64, audio_ms: u32) -> Vec<Line> {
    let mut stamped: Vec<(u32, String)> = Vec::new();
    for raw in content.lines() {
        let mut rest = raw.trim();
        let mut times = Vec::new();
        while let Some(inner) = rest.strip_prefix('[') {
            let Some((tag, after)) = inner.split_once(']') else { break };
            let Some(ms) = stamp(tag) else { break };
            times.push(ms);
            rest = after;
        }
        let text = strip_word_stamps(rest);
        for ms in times {
            let shifted = (i64::from(ms) + offset_ms).clamp(0, i64::from(u32::MAX)) as u32;
            stamped.push((shifted, text.clone()));
        }
    }
    stamped.sort_by_key(|(ms, _)| *ms);
    let ends: Vec<u32> = stamped.iter().skip(1).map(|(ms, _)| *ms).chain([u32::MAX]).collect();
    stamped
        .into_iter()
        .zip(ends)
        .filter(|((_, text), _)| !text.is_empty())
        .map(|((start_ms, text), next)| Line { start_ms, end_ms: next.min(start_ms + MAX_LINE_MS).min(audio_ms.max(start_ms)), text })
        .collect()
}

fn strip_word_stamps(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(open) = rest.find('<') {
        out.push_str(&rest[..open]);
        match rest[open..].find('>') {
            Some(close) if stamp(&rest[open + 1..open + close]).is_some() => rest = &rest[open + close + 1..],
            _ => {
                out.push('<');
                rest = &rest[open + 1..];
            }
        }
    }
    out.push_str(rest);
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn clock(ms: i64) -> String {
    let ms = ms.max(0);
    format!("{}:{:02}.{:03}", ms / 60_000, ms / 1000 % 60, ms % 1000)
}

fn escape(text: &str) -> String {
    text.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

/// Word-timed TTML with `offset_ms` taken back out, so the player's own offset lands the words on the audio again.
pub fn to_ttml(lines: &[TimedLine], offset_ms: i64) -> String {
    let at = |ms: u32| clock(i64::from(ms) - offset_ms);
    let mut out = String::from(r#"<tt xmlns="http://www.w3.org/ns/ttml" xmlns:itunes="http://music.apple.com/lyric-ttml-internal" itunes:timing="Word"><body><div>"#);
    for line in lines {
        let (Some(first), Some(last)) = (line.words.first(), line.words.last()) else { continue };
        out.push_str(&format!(r#"<p begin="{}" end="{}">"#, at(first.start_ms), at(last.end_ms)));
        let spans: Vec<String> = line.words.iter().map(|w| format!(r#"<span begin="{}" end="{}">{}</span>"#, at(w.start_ms), at(w.end_ms), escape(&w.text))).collect();
        out.push_str(&spans.join(" "));
        out.push_str("</p>");
    }
    out.push_str("</div></body></tt>");
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::align::Word;

    #[test]
    fn lines_end_at_the_next_stamp() {
        let lrc = "[ar:Someone]\n[00:01.50]First line\n[00:04.00]\n[00:06.25][00:20.00]Chorus <00:06.50>here\n";
        let lines = parse_lrc(lrc, 0, 30_000);
        let summary: Vec<(u32, u32, &str)> = lines.iter().map(|l| (l.start_ms, l.end_ms, l.text.as_str())).collect();
        assert_eq!(summary, [(1_500, 4_000, "First line"), (6_250, 16_250, "Chorus here"), (20_000, 30_000, "Chorus here")]);
    }

    #[test]
    fn the_offset_moves_the_lines_and_the_last_line_stops_at_the_audio_end() {
        let lines = parse_lrc("[00:10.00]Only", -500, 12_000);
        assert_eq!((lines[0].start_ms, lines[0].end_ms), (9_500, 12_000));
    }

    #[test]
    fn ttml_carries_each_word_and_escapes_text() {
        let word = |start_ms, end_ms, text: &str| Word { start_ms, end_ms, text: text.into() };
        let line = TimedLine { words: vec![word(61_000, 61_400, "Rock"), word(61_400, 62_000, "&")], confidence: 0.9 };
        let ttml = to_ttml(&[line], 1_000);
        assert!(ttml.contains(r#"<p begin="1:00.000" end="1:01.000"><span begin="1:00.000" end="1:00.400">Rock</span> <span begin="1:00.400" end="1:01.000">&amp;</span></p>"#), "{ttml}");
    }
}
