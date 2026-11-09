use serde_json::Value;

use crate::text::{artist_and_title, base_title, clean_title, compare_form, markers, same_artist, similarity_of_forms, title_parts, translit};

pub const MAX_TEXT_CHARS: usize = crate::text::MAX_TEXT_CHARS;
const DISQUALIFY_MS: i64 = 15_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Reason {
    LowConfidence,
    Ambiguous,
    DurationMismatch,
    NoCandidates,
    LookupFailed,
}

impl Reason {
    /// The persisted import review codes; byte-compatible with stored reviews.
    pub fn as_str(self) -> &'static str {
        match self {
            Reason::LowConfidence => "low_confidence_match",
            Reason::Ambiguous => "ambiguous_match",
            Reason::DurationMismatch => "duration_mismatch",
            Reason::NoCandidates => "no_catalog_candidates",
            Reason::LookupFailed => "catalog_lookup_failed",
        }
    }

    pub fn parse(code: &str) -> Option<Self> {
        [Reason::LowConfidence, Reason::Ambiguous, Reason::DurationMismatch, Reason::NoCandidates, Reason::LookupFailed].into_iter().find(|r| r.as_str() == code)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct Source {
    pub title: String,
    pub artists: Vec<String>,
    /// `None` or 0 means unknown.
    pub duration_ms: Option<i64>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Candidate {
    pub id: String,
    pub title: String,
    pub artists: Vec<String>,
    pub duration_ms: Option<i64>,
    pub raw: Value,
}

impl Candidate {
    pub fn from_track(track: &Value) -> Option<Self> {
        let id = track.get("id")?.as_str().filter(|s| !s.is_empty())?.to_string();
        let title = track.get("title")?.as_str().filter(|s| !s.trim().is_empty())?.to_string();
        let artists = track.get("artists").and_then(Value::as_array).map(|list| list.iter().filter_map(|a| a.get("name")?.as_str().map(str::to_string)).collect()).unwrap_or_default();
        let duration_ms = track.get("durationMs").and_then(Value::as_f64).map(|ms| ms.round() as i64);
        Some(Self { id, title, artists, duration_ms, raw: track.clone() })
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum Decision {
    Approved { index: usize, score: i64 },
    Pending { reason: Reason, score: Option<i64>, proposal: Option<usize> },
}

impl Decision {
    pub fn is_approved(&self) -> bool {
        matches!(self, Decision::Approved { .. })
    }
}

fn cut(text: &str) -> String {
    text.chars().take(MAX_TEXT_CHARS).collect()
}

fn known(ms: Option<i64>) -> Option<i64> {
    ms.filter(|ms| *ms > 0)
}

struct Form {
    plain: String,
    latin: String,
}

impl Form {
    fn new(plain: String) -> Self {
        let latin = translit(&plain);
        Self { plain, latin }
    }
}

fn forms(list: Vec<String>) -> Vec<Form> {
    let mut seen: Vec<String> = Vec::new();
    for form in list {
        if !form.is_empty() && !seen.contains(&form) {
            seen.push(form);
        }
    }
    seen.into_iter().map(Form::new).collect()
}

struct View {
    titles: Vec<Form>,
    whole: Form,
    base: String,
    artists: Vec<String>,
    markers: Vec<&'static str>,
    parts: Vec<String>,
    duration_ms: Option<i64>,
    /// The audio of a music video: often with an intro, a skit or an outro the record has not.
    video: bool,
}

const VIDEO_WORDS: [&str; 4] = ["official video", "music video", "official music video", "клип"];

/// A video stands in for a record only at the record's length.
const VIDEO_TOLERANCE_MS: i64 = 3_000;

impl View {
    fn new(title: &str, artists: &[String], duration_ms: Option<i64>) -> Self {
        let title = cut(title);
        let cleaned = clean_title(&title);
        let (parsed_artist, parsed_title) = artist_and_title(&title);
        let base = base_title(&parsed_title);
        let mut all_artists: Vec<String> = artists.iter().map(|a| cut(a.trim())).filter(|a| !a.is_empty()).collect();
        all_artists.extend(parsed_artist);
        View {
            titles: forms(vec![base.clone(), base_title(&title), compare_form(&parsed_title), compare_form(&cleaned)]),
            whole: Form::new(compare_form(&cleaned)),
            base,
            artists: all_artists,
            markers: markers(&title),
            parts: title_parts(&cleaned),
            duration_ms: known(duration_ms),
            video: {
                let padded = format!(" {} ", compare_form(&title));
                VIDEO_WORDS.iter().any(|words| padded.contains(&format!(" {words} ")))
            },
        }
    }
}

fn pair_similarity(a: &Form, b: &Form) -> f64 {
    let mut best = similarity_of_forms(&a.plain, &b.plain).max(similarity_of_forms(&a.latin, &b.latin));
    for (x, y) in [(&a.plain, &b.plain), (&a.latin, &b.latin)] {
        let (short, long) = if x.chars().count() <= y.chars().count() { (x, y) } else { (y, x) };
        let (s, l) = (short.chars().count(), long.chars().count());
        if s >= 4 && format!(" {long} ").contains(&format!(" {short} ")) && s as f64 >= 0.7 * l as f64 {
            best = best.max(92.0);
        }
    }
    best
}

fn artist_similarity(a: &str, b: &str) -> f64 {
    pair_similarity(&Form::new(compare_form(a)), &Form::new(compare_form(b)))
}

fn without_artist(title: &str, artist: &str) -> Option<String> {
    if artist.chars().count() < 3 {
        return None;
    }
    let padded = format!(" {title} ");
    let needle = format!(" {artist} ");
    padded.contains(&needle).then(|| padded.replacen(&needle, " ", 1).trim().to_string())
}

struct Scored {
    index: usize,
    score: i64,
    title: f64,
    artist_matched: bool,
    artist_similarity: f64,
    diff_ms: Option<i64>,
    disqualified: bool,
    agree: bool,
}

fn score(source: &View, candidate: &View, index: usize) -> Scored {
    let mut extra: Vec<Form> = Vec::new();
    let mut artist_matched = source.artists.iter().any(|s| candidate.artists.iter().any(|c| same_artist(s, c)));
    for artist in &candidate.artists {
        let artist = Form::new(compare_form(artist));
        let inside = without_artist(&source.whole.plain, &artist.plain).or_else(|| without_artist(&source.whole.latin, &artist.latin));
        if let Some(rest) = inside {
            artist_matched = true;
            extra.push(Form::new(rest));
        }
    }
    if let [first, second] = &source.parts[..] {
        let first = Form::new(compare_form(first));
        let reverse = candidate.titles.iter().any(|t| pair_similarity(&first, t) >= 85.0) && candidate.artists.iter().any(|a| artist_similarity(second, a) >= 85.0);
        if reverse {
            artist_matched = true;
            extra.push(first);
        }
    }
    let title = source.titles.iter().chain(&extra).flat_map(|s| candidate.titles.iter().map(move |c| pair_similarity(s, c))).fold(0.0, f64::max);
    let artist_similarity = source.artists.iter().flat_map(|s| candidate.artists.iter().map(move |c| artist_similarity(s, c))).fold(0.0, f64::max);
    artist_matched |= artist_similarity >= 85.0;
    let diff_ms = source.duration_ms.zip(candidate.duration_ms).map(|(a, b)| (a - b).abs());
    let disqualified = diff_ms.is_some_and(|d| d > DISQUALIFY_MS);
    let cut_differs = candidate.video && !source.video && !diff_ms.is_some_and(|d| d <= VIDEO_TOLERANCE_MS);
    let agree = !cut_differs
        && match (source.markers.is_empty(), candidate.markers.is_empty()) {
            (true, true) => true,
            (false, false) => source.markers.iter().any(|m| candidate.markers.contains(m)),
            _ => false,
        };
    let duration_points = match diff_ms {
        None => 8.0,
        Some(d) if d <= 2_000 => 15.0,
        Some(d) if d <= 4_000 => 12.0,
        Some(d) if d <= 8_000 => 8.0,
        Some(d) if d <= 12_000 => 4.0,
        Some(_) => -10.0,
    } - if disqualified { 30.0 } else { 0.0 };
    let version_points = match (agree, source.markers.is_empty()) {
        (true, true) => 3.0,
        (true, false) => 6.0,
        (false, _) => -40.0,
    };
    let artist_points = if artist_matched { 25.0 } else { artist_similarity * 0.25 };
    let total = title * 0.6 + artist_points + duration_points + version_points;
    Scored { index, score: total.round().clamp(0.0, 100.0) as i64, title, artist_matched, artist_similarity, diff_ms, disqualified, agree }
}

fn within(diff: Option<i64>, ms: i64) -> bool {
    diff.is_none_or(|d| d <= ms)
}

pub fn same_liked_track(a_title: &str, a_artists: &[String], a_ms: Option<i64>, b_title: &str, b_artists: &[String], b_ms: Option<i64>) -> bool {
    let (a, b) = (View::new(a_title, a_artists, a_ms), View::new(b_title, b_artists, b_ms));
    let mut markers = (a.markers.clone(), b.markers.clone());
    markers.0.sort_unstable();
    markers.1.sort_unstable();
    a.duration_ms.is_some() && markers.0 == markers.1 && same_recording(&a, &b)
}

fn same_recording(a: &View, b: &View) -> bool {
    let durations = match (a.duration_ms, b.duration_ms) {
        (Some(x), Some(y)) => (x - y).abs() <= 3_000,
        (None, None) => true,
        _ => false,
    };
    let artists = (a.artists.is_empty() && b.artists.is_empty()) || a.artists.iter().any(|x| b.artists.iter().any(|y| same_artist(x, y)));
    !a.base.is_empty() && a.base == b.base && artists && durations
}

fn score_all(source: &Source, candidates: &[Candidate]) -> (View, Vec<View>, Vec<Scored>) {
    let src = View::new(&source.title, &source.artists, source.duration_ms);
    let views: Vec<View> = candidates.iter().map(|c| View::new(&c.title, &c.artists, c.duration_ms)).collect();
    let mut ranked: Vec<Scored> = views.iter().enumerate().map(|(i, v)| score(&src, v, i)).collect();
    ranked.sort_by_key(|s| std::cmp::Reverse(s.score));
    (src, views, ranked)
}

// Best first; ties keep the given order
pub fn rank(source: &Source, candidates: &[Candidate]) -> Vec<(usize, i64)> {
    score_all(source, candidates).2.iter().map(|s| (s.index, s.score)).collect()
}

pub fn evaluate(source: &Source, candidates: &[Candidate]) -> Decision {
    if candidates.is_empty() {
        return Decision::Pending { reason: Reason::LowConfidence, score: None, proposal: None };
    }
    let (src, views, ranked) = score_all(source, candidates);
    let best = &ranked[0];
    let pending = |reason| Decision::Pending { reason, score: Some(best.score), proposal: Some(best.index) };
    if best.disqualified {
        return pending(Reason::DurationMismatch);
    }
    let clear_winner = best.score >= 75 && best.agree && best.artist_matched && best.diff_ms.is_some_and(|d| d <= 4_000);
    if let Some(runner) = ranked.get(1)
        && best.score - runner.score <= 10
        && !runner.disqualified
        && !same_recording(&views[best.index], &views[runner.index])
        && !clear_winner
        && (best.title < 90.0 || !best.agree)
    {
        return pending(Reason::Ambiguous);
    }
    if best.agree {
        let floor = if best.title >= 85.0 && best.artist_matched && within(best.diff_ms, 10_000) {
            Some(95)
        } else if best.title >= 88.0 && src.base.chars().count() >= 4 && best.diff_ms.is_some_and(|d| d <= 3_000) {
            Some(88)
        } else if best.artist_matched && within(best.diff_ms, 4_000) && best.title >= 70.0 {
            Some(85)
        } else if best.score >= 75 && best.title >= 75.0 && (best.artist_matched || best.artist_similarity >= 70.0) && within(best.diff_ms, 8_000) {
            Some(0)
        } else {
            None
        };
        if let Some(floor) = floor {
            return Decision::Approved { index: best.index, score: best.score.max(floor) };
        }
    }
    pending(Reason::LowConfidence)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn source(title: &str, ms: i64) -> Source {
        Source { title: title.into(), artists: vec!["Nova".into()], duration_ms: Some(ms) }
    }

    fn candidate(title: &str, ms: i64) -> Candidate {
        Candidate { id: "x".into(), title: title.into(), artists: vec!["Nova".into()], duration_ms: Some(ms), raw: serde_json::Value::Null }
    }

    #[test]
    fn a_music_video_stands_in_only_at_the_records_length() {
        assert!(!evaluate(&source("Skyline", 200_000), &[candidate("Skyline (Official Music Video)", 208_000)]).is_approved());
        assert!(evaluate(&source("Skyline", 200_000), &[candidate("Skyline (Official Music Video)", 201_000)]).is_approved());
        assert!(evaluate(&source("Skyline (Official Video)", 208_000), &[candidate("Skyline (Official Video)", 208_000)]).is_approved());
    }

    #[test]
    fn live_and_cover_never_replace_the_record() {
        for title in ["Skyline (Live)", "Skyline (Cover)", "Skyline - Live at Wembley"] {
            assert!(!evaluate(&source("Skyline", 200_000), &[candidate(title, 200_000)]).is_approved(), "{title}");
        }
    }

    #[test]
    fn a_single_and_its_album_copy_are_one_liked_track_a_live_cut_is_not() {
        let artists = vec!["Nova".to_string()];
        assert!(same_liked_track("Skyline", &artists, Some(200_000), "Skyline (Album Version)", &artists, Some(201_500)));
        assert!(!same_liked_track("Skyline", &artists, Some(200_000), "Skyline (Live)", &artists, Some(200_000)));
        assert!(!same_liked_track("Skyline", &artists, Some(200_000), "Skyline", &artists, Some(260_000)));
        assert!(!same_liked_track("Skyline", &artists, None, "Skyline", &artists, None));
    }

    #[test]
    fn empty_base_titles_are_never_the_same_recording() {
        let artists = ["A".to_string()];
        let live = View::new("Live", &artists, Some(200_000));
        let remix = View::new("Remix", &artists, Some(200_000));
        assert!(live.base.is_empty() && remix.base.is_empty());
        assert!(!same_recording(&live, &remix));
        assert!(!same_recording(&live, &live));
        let song = View::new("Song (Live)", &artists, Some(200_000));
        assert!(same_recording(&song, &View::new("Song", &artists, Some(201_000))));
    }
}
