//! Persisted SoundCloud id formats: `sc:<n>` tracks, `sc_user_<n>` users, `sc_playlist_<n>` sets.

fn digits(text: &str) -> Option<u64> {
    if text.is_empty() || !text.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    text.parse().ok()
}

/// Strips `prefix` in any letter case.
fn strip<'a>(text: &'a str, prefix: &str) -> Option<&'a str> {
    let head = text.get(..prefix.len())?;
    head.eq_ignore_ascii_case(prefix).then(|| &text[prefix.len()..])
}

/// Accepts `sc:<n>`, `soundcloud:<n>`, `soundcloud:track:<n>`, `soundcloud:tracks:<n>` and bare digits.
pub fn track_num(id: &str) -> Option<u64> {
    let id = id.trim();
    ["sc:", "soundcloud:tracks:", "soundcloud:track:", "soundcloud:"]
        .iter()
        .find_map(|prefix| strip(id, prefix))
        .map_or_else(|| digits(id), digits)
}

pub fn user_num(id: &str) -> Option<u64> {
    strip(id.trim(), "sc_user_").and_then(digits)
}

pub fn set_num(id: &str) -> Option<u64> {
    strip(id.trim(), "sc_playlist_").and_then(digits)
}

pub fn is_soundcloud(id: &str) -> bool {
    let id = id.trim();
    strip(id, "sc:").is_some() || strip(id, "sc_").is_some()
}

pub fn track_id(n: u64) -> String {
    format!("sc:{n}")
}

pub fn user_id(n: u64) -> String {
    format!("sc_user_{n}")
}

pub fn set_id(n: u64) -> String {
    format!("sc_playlist_{n}")
}
