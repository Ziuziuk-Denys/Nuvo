//! Canonical keys: one work key per song across its uploads, plus the variant an upload is.

use deunicode::deunicode;

/// Variant tags in the order of `VERSION_PATTERNS` in `src/shared/media/matching/versionTags.ts`.
/// Spellings are word sequences matched on the lower-cased title before transliteration, so the
/// Russian forms match too.
const VARIANT_TAGS: &[(&str, &[&str])] = &[
    ("remix", &["remix", "remixed", "ремикс", "rmx"]),
    ("vip", &["vip", "v i p"]),
    ("flip", &["flip", "флип"]),
    ("bootleg", &["bootleg", "бутлег"]),
    ("mashup", &["mashup", "mash up", "мэшап", "мешап"]),
    ("edit", &["edit", "эдит"]),
    ("slowed", &["slowed", "слоу"]),
    ("reverb", &["reverb", "реверб"]),
    ("sped_up", &["sped up", "speed up", "spedup", "speedup", "спид ап", "спидап"]),
    ("nightcore", &["nightcore", "найткор"]),
    ("instrumental", &["instrumental", "инструментал", "inst"]),
    ("acoustic", &["acoustic", "акустика"]),
    ("live", &["live", "лайв", "концерт"]),
    ("cover", &["cover", "кавер"]),
    ("bass_boosted", &["bass boost", "bass boosted", "bassboost", "bassboosted", "басс буст"]),
];

/// Words that start a credit clause; everything from them to the end of the title is dropped.
const CREDIT_WORDS: [&str; 4] = ["feat", "ft", "featuring", "prod"];

#[derive(Debug, Clone, PartialEq)]
pub struct Variant {
    pub kind: &'static str,
    pub by: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Canon {
    pub work_key: String,
    pub artist_key: String,
    pub variant: Option<Variant>,
}

/// Lower-cased words, split on anything that is not a letter or digit (any script).
fn words(text: &str) -> Vec<String> {
    text.to_lowercase()
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| !w.is_empty())
        .map(str::to_string)
        .collect()
}

/// Position of the first occurrence of `phrase` (space-separated words) in `words`.
fn find_phrase(words: &[String], phrase: &str) -> Option<(usize, usize)> {
    let needle: Vec<&str> = phrase.split(' ').collect();
    words
        .windows(needle.len())
        .position(|window| window.iter().zip(&needle).all(|(w, n)| w == n))
        .map(|start| (start, needle.len()))
}

/// ASCII transliteration, lower case, words joined by single spaces.
pub fn normalize(text: &str) -> String {
    deunicode(text)
        .to_ascii_lowercase()
        .split(|c: char| !c.is_ascii_alphanumeric())
        .filter(|w| !w.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

/// Every variant tag found anywhere in `title`, in list order. Mirrors `getVersionTags`.
pub fn version_tags(title: &str) -> Vec<&'static str> {
    let words = words(title);
    VARIANT_TAGS
        .iter()
        .filter(|(_, spellings)| spellings.iter().any(|s| find_phrase(&words, s).is_some()))
        .map(|(tag, _)| *tag)
        .collect()
}

/// The first tag in `segment` and who made it: the words before the tag, or after "by".
fn variant_of(segment: &str) -> Option<Variant> {
    let words = words(segment);
    let (kind, start, len) = VARIANT_TAGS.iter().find_map(|(tag, spellings)| {
        spellings.iter().find_map(|s| find_phrase(&words, s)).map(|(start, len)| (*tag, start, len))
    })?;
    let before = &words[..start];
    let after = &words[start + len..];
    let by_words = match after.iter().position(|w| w == "by") {
        Some(i) if before.is_empty() => &after[i + 1..],
        _ => before,
    };
    let by = normalize(&by_words.join(" "));
    Some(Variant { kind, by: (!by.is_empty()).then_some(by) })
}

/// The channel or primary artist without " - Topic" and a trailing "VEVO".
pub fn artist_key(artist: &str) -> String {
    let trimmed = artist.trim();
    let cut = trimmed.len().saturating_sub(8);
    let base = if trimmed.is_char_boundary(cut) && trimmed[cut..].eq_ignore_ascii_case(" - topic") { &trimmed[..cut] } else { trimmed };
    let key = normalize(base);
    match key.strip_suffix("vevo") {
        Some(stripped) if !stripped.trim().is_empty() => stripped.trim().to_string(),
        _ => key,
    }
}

/// Numbers of an untagged bracket segment that tell works apart: "Part 2", "Vol. 3". Years
/// ("2019 Remaster"), "4K" and credit clauses ("feat. 2 Chainz") are not part of the work.
fn work_numbers(segment: &str, numbers: &mut Vec<String>) {
    let text = normalize(segment);
    let words: Vec<&str> = text.split(' ').collect();
    if words.first().is_some_and(|w| CREDIT_WORDS.contains(w)) {
        return;
    }
    for word in words {
        let year = word.len() == 4 && matches!(word.parse::<u32>(), Ok(1900..=2099));
        if !word.is_empty() && word.bytes().all(|b| b.is_ascii_digit()) && !year {
            numbers.push(word.to_string());
        }
    }
}

pub fn canon(title: &str, artist: &str) -> Canon {
    let channel = artist_key(artist);
    let mut variant = None;
    let mut numbers = Vec::new();
    let mut rest = String::new();
    let mut segment = String::new();
    let mut depth = 0usize;
    // Bracketed segments are dropped; the first one carrying a tag names the variant, and
    // untagged ones keep their numbers.
    for ch in title.chars() {
        match ch {
            '(' | '[' | '{' | '【' => {
                if depth > 0 {
                    segment.push(' ');
                }
                depth += 1;
            }
            ')' | ']' | '}' | '】' if depth > 0 => {
                depth -= 1;
                if depth == 0 {
                    match variant_of(&segment) {
                        Some(found) => _ = variant.get_or_insert(found),
                        None => work_numbers(&segment, &mut numbers),
                    }
                    segment.clear();
                    rest.push(' ');
                }
            }
            _ if depth > 0 => segment.push(ch),
            _ => rest.push(ch),
        }
    }
    if depth > 0 {
        match variant_of(&segment) {
            Some(found) => _ = variant.get_or_insert(found),
            None => work_numbers(&segment, &mut numbers),
        }
    }
    let rest = rest.replace(['–', '—'], "-");
    let mut parts: Vec<&str> = rest.split(" - ").map(str::trim).filter(|p| !p.is_empty()).collect();
    if parts.len() > 1 && artist_key(parts[0]) == channel {
        parts.remove(0);
    }
    if parts.len() > 1
        && let Some(found) = variant_of(parts[parts.len() - 1])
    {
        variant.get_or_insert(found);
        parts.pop();
    }
    let main = normalize(&parts.join(" "));
    let kept: Vec<&str> = main.split(' ').take_while(|w| !CREDIT_WORDS.contains(w)).collect();
    let mut work_key = kept.join(" ");
    if work_key.is_empty() {
        work_key = normalize(title);
    } else if !numbers.is_empty() {
        work_key = format!("{work_key} {}", numbers.join(" "));
    }
    Canon { work_key, artist_key: channel, variant }
}

/// How strongly two uploads are the same song: 1.0 same work, 0.5 a cover (same title, other
/// artist), 0.0 different. Short titles (4 characters or fewer) must match exactly; a fuzzy
/// title match needs the same artist, the same numbers ("Part 1" is not "Part 2") and, when both
/// durations are known, lengths within 3 %.
pub fn same_work(a: (&str, &str, i64), b: (&str, &str, i64)) -> f64 {
    let (a_work, a_artist, a_ms) = a;
    let (b_work, b_artist, b_ms) = b;
    if a_work == b_work {
        return if a_artist == b_artist { 1.0 } else { 0.5 };
    }
    // Digit runs as a list: "part 1 2" is not "part 12".
    let digits = |s: &str| s.split(|c: char| !c.is_ascii_digit()).filter(|run| !run.is_empty()).map(str::to_string).collect::<Vec<_>>();
    if a_work.len() <= 4 || b_work.len() <= 4 || a_artist != b_artist || digits(a_work) != digits(b_work) {
        return 0.0;
    }
    let close_title = strsim::jaro_winkler(a_work, b_work) >= 0.92 || strsim::normalized_levenshtein(a_work, b_work) >= 0.88;
    let close_length = a_ms <= 0 || b_ms <= 0 || (a_ms - b_ms).abs() as f64 <= 0.03 * a_ms.max(b_ms) as f64;
    if close_title && close_length { 1.0 } else { 0.0 }
}
