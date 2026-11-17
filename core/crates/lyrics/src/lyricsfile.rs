// LRCLIB's Lyricsfile YAML, only its `lines` list: anything unexpected falls back to the record's LRC

#[derive(Default)]
struct Timed {
    text: Option<String>,
    start_ms: Option<i64>,
    end_ms: Option<i64>,
}

#[derive(Default)]
struct LineOut {
    line: Timed,
    words: Vec<Timed>,
}

fn scalar(raw: &str) -> Option<String> {
    let raw = raw.trim();
    let text = if let Some(inner) = raw.strip_prefix('\'').and_then(|rest| rest.strip_suffix('\'')) {
        inner.replace("''", "'")
    } else if raw.starts_with('"') {
        serde_json::from_str::<String>(raw).ok()?
    } else if raw.is_empty() || raw.starts_with(['\'', '|', '>', '&', '*', '!', '[', '{', '~']) {
        return None;
    } else {
        raw.to_string()
    };
    (!text.contains(['<', '>', '\n', '\r', '[', ']'])).then_some(text)
}

fn set(target: &mut Timed, key: &str, value: &str) -> Option<()> {
    match key {
        "text" => target.text = Some(scalar(value)?),
        "start_ms" => target.start_ms = Some(value.trim().parse().ok().filter(|ms: &i64| *ms >= 0)?),
        "end_ms" => target.end_ms = Some(value.trim().parse().ok().filter(|ms: &i64| *ms >= 0)?),
        _ => return None,
    }
    Some(())
}

fn parse(yaml: &str) -> Option<Vec<LineOut>> {
    let mut rows = yaml.lines().skip_while(|row| *row != "lines:").skip(1);
    let mut lines: Vec<LineOut> = Vec::new();
    for row in rows.by_ref() {
        if row.trim().is_empty() {
            continue;
        }
        let indent = row.len() - row.trim_start_matches(' ').len();
        let body = &row[indent..];
        if indent == 0 && !body.starts_with("- ") {
            break;
        }
        let (item, body) = match body.strip_prefix("- ") {
            Some(rest) => (true, rest),
            None => (false, body),
        };
        let (key, value) = body.split_once(':')?;
        match (indent, item) {
            (0, true) => {
                lines.push(LineOut::default());
                set(&mut lines.last_mut()?.line, key, value)?;
            }
            (2, false) if key == "words" && value.trim().is_empty() => {}
            (2, false) => set(&mut lines.last_mut()?.line, key, value)?,
            (2, true) => {
                let words = &mut lines.last_mut()?.words;
                words.push(Timed::default());
                set(words.last_mut()?, key, value)?;
            }
            (4, false) => set(lines.last_mut()?.words.last_mut()?, key, value)?,
            _ => return None,
        }
    }
    Some(lines)
}

fn stamp(ms: i64) -> String {
    let centis = (ms + 5) / 10;
    format!("{:02}:{:02}.{:02}", centis / 6000, centis / 100 % 60, centis % 100)
}

/// Enhanced LRC with a stamp before every word, or None when the file holds no word timing.
pub fn word_lrc(yaml: &str) -> Option<String> {
    let lines = parse(yaml)?;
    if !lines.iter().any(|line| !line.words.is_empty()) {
        return None;
    }
    let mut out = String::new();
    for LineOut { line, words } in &lines {
        let start = line.start_ms?;
        out.push_str(&format!("[{}]", stamp(start)));
        if words.is_empty() {
            out.push_str(line.text.as_deref()?);
        } else {
            for word in words {
                out.push_str(&format!("<{}>{}", stamp(word.start_ms?), word.text.as_deref()?));
            }
            if let Some(end) = line.end_ms {
                out.push_str(&format!("<{}>", stamp(end)));
            }
        }
        out.push('\n');
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::word_lrc;

    const FILE: &str = "version: '1.0'
metadata:
  title: Song
  duration_ms: 215000
lines:
- text: I been tryna call
  start_ms: 29470
  end_ms: 32330
  words:
  - text: 'I '
    start_ms: 29470
  - text: 'don''t '
    start_ms: 29843
  - text: \"call \\u00e9\"
    start_ms: 30414
- text: Untimed words
  start_ms: 61005
plain: |
  I been tryna call
";

    #[test]
    fn word_timing_becomes_enhanced_lrc() {
        assert_eq!(word_lrc(FILE).unwrap(), "[00:29.47]<00:29.47>I <00:29.84>don't <00:30.41>call é<00:32.33>\n[01:01.01]Untimed words\n");
    }

    #[test]
    fn a_file_without_words_or_with_an_unknown_shape_gives_nothing() {
        assert_eq!(word_lrc("lines:\n- text: Hi\n  start_ms: 10\n"), None);
        assert_eq!(word_lrc(&FILE.replace("  - text: 'I '", "  - text: |")), None);
        assert_eq!(word_lrc(&FILE.replace("    start_ms: 29470", "    singer: v1")), None);
        assert_eq!(word_lrc(&FILE.replace("'I '", "'<b>'")), None);
        assert_eq!(word_lrc("version: '1.0'\n"), None);
    }
}
