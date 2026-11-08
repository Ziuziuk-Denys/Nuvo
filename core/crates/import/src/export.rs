//! Files the library leaves as: M3U8 for players, CSV with Exportify column names (it imports
//! back), Nuvo JSON that imports back exactly. Only track facts and playlist names go in.

use nuvo_contracts::iso_from_ms;
use serde_json::{Value, json};

#[derive(Debug, Clone, PartialEq)]
pub struct ExportTrack {
    pub snapshot: Value,
    /// Only M3U8 uses it; CSV and JSON are for sharing and never carry paths.
    pub local_path: Option<String>,
    pub added_at: Option<i64>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ExportPlaylist {
    pub title: String,
    pub description: Option<String>,
    pub tracks: Vec<ExportTrack>,
}

fn artists(snapshot: &Value) -> String {
    snapshot["artists"].as_array().into_iter().flatten().filter_map(|a| a["name"].as_str()).collect::<Vec<_>>().join(", ")
}

fn one_line(text: &str) -> String {
    text.replace(['\r', '\n'], " ")
}

/// Where a streamed track lives on the web; `None` for local files and unknown ids.
pub fn public_url(snapshot: &Value) -> Option<String> {
    let id = snapshot["id"].as_str()?;
    if id.len() == 11 && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_') {
        return Some(format!("https://music.youtube.com/watch?v={id}"));
    }
    if id.starts_with("sc:") {
        return snapshot["permalinkUrl"].as_str().filter(|url| url.starts_with("https://soundcloud.com/")).map(String::from);
    }
    None
}

pub fn m3u8(playlist: &ExportPlaylist) -> String {
    let mut out = format!("#EXTM3U\n#PLAYLIST:{}\n", one_line(&playlist.title));
    for track in &playlist.tracks {
        let s = &track.snapshot;
        let seconds = (s["durationMs"].as_f64().unwrap_or(0.0) / 1000.0).floor() as i64;
        let seconds = if seconds > 0 { seconds } else { -1 };
        let display = one_line(&format!("{} - {}", artists(s), s["title"].as_str().unwrap_or("")));
        // a track with no location is left out: players and importers both need one
        let Some(location) = track.local_path.clone().or_else(|| public_url(s)) else { continue };
        out.push_str(&format!("#EXTINF:{seconds},{display}\n{}\n", one_line(&location)));
    }
    out
}

pub const CSV_HEADER: &str = "Track Name,Artist Name(s),Album Name,Duration (ms),Added At,Playlist,Source,Nuvo ID,URL";

/// RFC 4180 quoting; a leading `= + - @`, tab or CR gets an apostrophe so spreadsheets never run it.
pub fn csv_cell(text: &str) -> String {
    let safe = if text.starts_with(['=', '+', '-', '@', '\t', '\r']) { format!("'{text}") } else { text.to_string() };
    if safe.contains([',', '"', '\n', '\r']) { format!("\"{}\"", safe.replace('"', "\"\"")) } else { safe }
}

pub fn csv(rows: &[(Option<&str>, &ExportTrack)]) -> String {
    let mut out = format!("{CSV_HEADER}\r\n");
    for (playlist, track) in rows {
        let s = &track.snapshot;
        let id = s["id"].as_str().unwrap_or("");
        let cells = [
            s["title"].as_str().unwrap_or("").to_string(),
            artists(s),
            s.pointer("/album/title").and_then(Value::as_str).unwrap_or("").to_string(),
            s["durationMs"].as_f64().map(|ms| (ms.round() as i64).to_string()).unwrap_or_default(),
            track.added_at.map(iso_from_ms).unwrap_or_default(),
            playlist.unwrap_or("Liked songs").to_string(),
            nuvo_contracts::source_of(id).to_string(),
            id.to_string(),
            public_url(s).unwrap_or_default(),
        ];
        out.push_str(&cells.iter().map(|c| csv_cell(c)).collect::<Vec<_>>().join(","));
        out.push_str("\r\n");
    }
    out
}

/// The snapshot without per-viewer state (`viewer.liked`).
fn shareable(snapshot: &Value) -> Value {
    let mut snapshot = snapshot.clone();
    if let Some(object) = snapshot.as_object_mut() {
        object.remove("viewer");
    }
    snapshot
}

pub fn nuvo_playlist(playlist: &ExportPlaylist) -> Value {
    json!({
        "format": "nuvo-playlist",
        "version": 1,
        "title": playlist.title,
        "description": playlist.description,
        "tracks": playlist.tracks.iter().map(|t| shareable(&t.snapshot)).collect::<Vec<_>>(),
    })
}

pub fn nuvo_library(liked: &[ExportTrack], playlists: &[ExportPlaylist], exported_at: i64) -> Value {
    json!({
        "format": "nuvo-library",
        "version": 1,
        "exportedAt": iso_from_ms(exported_at),
        "liked": liked.iter().map(|t| shareable(&t.snapshot)).collect::<Vec<_>>(),
        "playlists": playlists.iter().map(nuvo_playlist).collect::<Vec<_>>(),
    })
}
