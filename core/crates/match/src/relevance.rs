use serde_json::Value;
use unicode_normalization::UnicodeNormalization;

use crate::text::{compare_form, markers, translit};

const LYRIC_VIDEO: [&[&str]; 4] = [&["lyrics"], &["lyric", "video"], &["letra"], &["текст"]];
const LATIN_KEYS: &str = "qwertyuiop[]asdfghjkl;'zxcvbnm,.`";
const CYRILLIC_KEYS: &str = "йцукенгшщзхъфывапролджэячсмитьбюё";
const SAME_SONG_MS: i64 = 4_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Origin {
    YouTube,
    SoundCloud,
    Local,
}

impl Origin {
    pub fn as_str(self) -> &'static str {
        match self {
            Origin::YouTube => "youtube",
            Origin::SoundCloud => "soundcloud",
            Origin::Local => "local",
        }
    }
}

/// A song as a catalog answers it: the words plus what it says about its copy.
#[derive(Debug, Clone, PartialEq)]
pub struct Song {
    pub id: String,
    pub title: String,
    pub artists: Vec<String>,
    pub duration_ms: Option<i64>,
    pub album: bool,
    pub preview: bool,
    pub plays: Option<u64>,
    pub verified: bool,
}

impl Song {
    pub fn from_track(track: &Value) -> Option<Self> {
        let id = track.get("id")?.as_str().filter(|s| !s.is_empty())?.to_string();
        let title = track.get("title")?.as_str().filter(|s| !s.trim().is_empty())?.to_string();
        let artists = track.get("artists").and_then(Value::as_array).map(|list| list.iter().filter_map(|a| a.get("name")?.as_str().map(str::to_string)).collect()).unwrap_or_default();
        Some(Self {
            id,
            title,
            artists,
            duration_ms: track.get("durationMs").and_then(Value::as_f64).map(|ms| ms.round() as i64).filter(|ms| *ms > 0),
            album: track.get("album").is_some_and(Value::is_object),
            preview: track.get("preview") == Some(&Value::Bool(true)),
            plays: track.get("plays").and_then(Value::as_u64),
            verified: track.get("verified") == Some(&Value::Bool(true)),
        })
    }

    pub fn origin(&self) -> Origin {
        if self.id.starts_with("sc:") {
            Origin::SoundCloud
        } else if self.id.starts_with("local:") {
            Origin::Local
        } else {
            Origin::YouTube
        }
    }

    fn credits(&self) -> String {
        self.artists.join(", ")
    }
}

/// A release on YouTube Music or a verified SoundCloud uploader.
pub fn is_official(song: &Song) -> bool {
    match song.origin() {
        Origin::YouTube => song.album,
        Origin::SoundCloud => song.verified,
        Origin::Local => true,
    }
}

/// Points for the copy rather than its words: official releases, verified and popular uploads rise; previews and odd lengths sink.
/// `rank` is the place in YouTube's own answer.
pub fn copy_points(song: &Song, rank: Option<usize>) -> f64 {
    let mut total = match song.duration_ms {
        _ if song.preview => -40.0,
        None => -3.0,
        Some(ms) if ms < 60_000 => -20.0,
        Some(ms) if ms > 15 * 60_000 => -25.0,
        Some(_) => 0.0,
    };
    match song.origin() {
        Origin::YouTube => total += if song.album { 10.0 } else { 0.0 } + rank.map_or(0.0, |r| 10.0 - r.min(10) as f64),
        Origin::SoundCloud => total += if song.verified { 8.0 } else { 0.0 } + ((song.plays.unwrap_or(0) as f64 + 1.0).log10() * 1.5).min(10.0),
        Origin::Local => total += 12.0,
    }
    total
}

/// The versions a song is other than the record, by its title or its uploader.
pub fn variant_markers(title: &str, artists: &[String]) -> Vec<&'static str> {
    let mut found = markers(&fold_accents(title));
    for name in artists {
        for marker in markers(&fold_accents(name)) {
            if !found.contains(&marker) {
                found.push(marker);
            }
        }
    }
    found
}

fn fold(text: &str) -> String {
    compare_form(&fold_accents(text))
}

fn fold_accents(text: &str) -> String {
    let mut out = String::new();
    for c in text.chars() {
        match c {
            'ł' => out.push('l'),
            'ø' => out.push('o'),
            'ß' => out.push_str("ss"),
            'æ' => out.push_str("ae"),
            'œ' => out.push_str("oe"),
            'đ' | 'ð' => out.push('d'),
            'ħ' => out.push('h'),
            'ı' => out.push('i'),
            'þ' => out.push_str("th"),
            'ŧ' => out.push('t'),
            'À'..='ɏ' | 'Ḁ'..='ỿ' => out.extend(std::iter::once(c).nfd().filter(|m| !('\u{300}'..='\u{36f}').contains(m))),
            _ => out.push(c),
        }
    }
    out
}

fn latin(text: &str) -> String {
    translit(&fold(text))
}

fn swap_layout(text: &str) -> String {
    let (latin_keys, cyrillic_keys): (Vec<char>, Vec<char>) = (LATIN_KEYS.chars().collect(), CYRILLIC_KEYS.chars().collect());
    text.to_lowercase()
        .chars()
        .map(|c| match latin_keys.iter().position(|k| *k == c) {
            Some(at) => cyrillic_keys[at],
            None => cyrillic_keys.iter().position(|k| *k == c).map_or(c, |at| latin_keys[at]),
        })
        .collect()
}

fn words(text: &str) -> Vec<&str> {
    text.split(' ').filter(|w| !w.is_empty()).collect()
}

fn coverage(query: &[&str], text: &[&str]) -> f64 {
    if query.is_empty() {
        return 0.0;
    }
    query.iter().filter(|q| text.iter().any(|w| w.starts_with(**q))).count() as f64 / query.len() as f64
}

fn has_phrase(text: &str, phrases: &[&[&str]]) -> bool {
    let padded = format!(" {text} ");
    phrases.iter().any(|p| padded.contains(&format!(" {} ", p.join(" "))))
}

fn artist_names(credits: &str) -> Vec<String> {
    let mut names = Vec::new();
    for piece in credits.split([',', '&']) {
        let mut name: Vec<&str> = Vec::new();
        for word in piece.split_whitespace() {
            if ["x", "feat", "feat.", "ft", "ft.", "и"].contains(&word.to_lowercase().as_str()) {
                names.push(name.join(" "));
                name.clear();
            } else {
                name.push(word);
            }
        }
        names.push(name.join(" "));
    }
    names.iter().map(|name| latin(name)).filter(|name| !name.is_empty()).collect()
}

fn without_brackets(title: &str) -> String {
    let mut out = String::new();
    let mut open = false;
    for c in title.chars() {
        match c {
            '(' | '[' | '{' => open = true,
            ')' | ']' | '}' if open => open = false,
            _ if !open => out.push(c),
            _ => {}
        }
    }
    out.split_whitespace().filter(|w| !w.starts_with('#')).collect::<Vec<_>>().join(" ")
}

fn dash_split(title: &str) -> Option<(&str, &str)> {
    let chars: Vec<(usize, char)> = title.char_indices().collect();
    chars.windows(3).find_map(|w| {
        let [(_, before), (at, dash), (_, after)] = [w[0], w[1], w[2]];
        let (left, right) = (title[..at].trim(), title[at + dash.len_utf8()..].trim());
        (before.is_whitespace() && matches!(dash, '-' | '–' | '—') && after.is_whitespace() && !left.is_empty() && !right.is_empty()).then_some((left, right))
    })
}

// "Artist - Title" uploads name the performer in the title; the uploader is often someone else
fn parts(song: &Song) -> (String, String) {
    let uploader = artist_names(&song.credits()).into_iter().next().unwrap_or_default();
    let bare = |title: &str| latin(&without_brackets(title));
    match dash_split(&song.title) {
        Some((left, right)) => {
            let first = |text: &str| artist_names(text).into_iter().next().unwrap_or_default();
            let (left_name, right_name) = (first(left), first(right));
            if left_name != uploader && right_name == uploader { (bare(left), right_name) } else { (bare(right), left_name) }
        }
        None => (bare(&song.title), uploader),
    }
}

fn query_score(song: &Song, query: &str, rank: Option<usize>) -> i64 {
    let title = fold(&song.title);
    let text = format!("{title} {}", fold(&song.credits()));
    let queries = [fold(query), fold(&swap_layout(query))];
    let latin_text = translit(&text);
    let matched = queries
        .iter()
        .map(|q| coverage(&words(q), &words(&text)).max(coverage(&words(&translit(q)), &words(&latin_text))))
        .fold(0.0, f64::max);
    let latin_queries: Vec<String> = queries.iter().map(|q| translit(q)).collect();
    let asked: Vec<&str> = latin_queries.iter().flat_map(|q| words(q)).collect();
    let (title_part, artist_part) = parts(song);
    let extra = words(&title_part).iter().filter(|w| !asked.iter().any(|token| w.starts_with(token))).count();
    let credited = artist_names(&song.credits()).iter().any(|name| latin_queries.iter().any(|q| q.contains(name.as_str())));
    let named = !credited && !artist_part.is_empty() && latin_queries.iter().any(|q| q.contains(artist_part.as_str()));

    let mut total = matched * 60.0;
    if matched < 0.5 {
        total -= 40.0;
    }
    total -= (extra as f64 * 5.0).min(20.0);
    if credited {
        total += 15.0;
    } else if named {
        total += 6.0;
    }
    if !variant_markers(&song.title, &song.artists).is_empty() && markers(&fold_accents(query)).is_empty() {
        total -= 25.0;
    } else if has_phrase(&title, &LYRIC_VIDEO) && !has_phrase(&queries[0], &LYRIC_VIDEO) {
        total -= 6.0;
    }
    (total + copy_points(song, rank)).round() as i64
}

fn song_key(song: &Song) -> (String, String) {
    parts(song)
}

/// The same song from two sources: one title and performer at about one length.
pub fn same_song(a: &Song, b: &Song) -> bool {
    song_key(a) == song_key(b) && a.duration_ms.zip(b.duration_ms).is_none_or(|(x, y)| (x - y).abs() <= SAME_SONG_MS)
}

/// Songs for a typed query, best first; of one song found twice only the better copy stays.
pub fn rank_songs(query: &str, songs: &[Song]) -> Vec<usize> {
    let mut youtube = 0;
    let mut scored: Vec<(usize, i64)> = songs
        .iter()
        .enumerate()
        .map(|(at, song)| {
            let rank = (song.origin() == Origin::YouTube).then(|| {
                youtube += 1;
                youtube - 1
            });
            (at, query_score(song, query, rank))
        })
        .collect();
    scored.sort_by_key(|(_, score)| std::cmp::Reverse(*score));
    let mut kept: Vec<usize> = Vec::new();
    for (at, _) in scored {
        if !kept.iter().any(|k| same_song(&songs[*k], &songs[at])) {
            kept.push(at);
        }
    }
    kept
}

/// Drops later copies of a song already listed; the order stays.
pub fn distinct(songs: &[Song]) -> Vec<usize> {
    let mut kept: Vec<usize> = Vec::new();
    for at in 0..songs.len() {
        if !kept.iter().any(|k| same_song(&songs[*k], &songs[at])) {
            kept.push(at);
        }
    }
    kept
}
