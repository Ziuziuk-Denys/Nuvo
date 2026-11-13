use nuvo_contracts::catalog::{AlbumDetails, ArtistRef, ArtistSummary, Cover, PlaylistDetails, SetSummary, Track, TrackDetails};
use serde_json::Value;

use crate::play::availability;
use crate::{Reason, ids};

fn text(value: &Value, key: &str) -> Option<String> {
    value.get(key)?.as_str().map(str::trim).filter(|s| !s.is_empty()).map(str::to_string)
}

pub fn num(record: &Value) -> Option<u64> {
    record.get("id")?.as_u64()
}

pub fn sized_500(url: &str) -> String {
    let (path, query) = url.split_once('?').map_or((url, None), |(p, q)| (p, Some(q)));
    let file_start = path.rfind('/').map_or(0, |i| i + 1);
    let Some(dot) = path[file_start..].rfind('.').map(|i| file_start + i) else { return url.to_string() };
    let stem = &path[..dot];
    let Some(dash) = stem[file_start..].rfind('-').map(|i| file_start + i) else { return url.to_string() };
    let token = &stem[dash + 1..];
    let sized = token
        .strip_prefix('t')
        .and_then(|wh| wh.split_once('x'))
        .is_some_and(|(w, h)| !w.is_empty() && !h.is_empty() && w.bytes().chain(h.bytes()).all(|b| b.is_ascii_digit()));
    if !(sized || matches!(token, "large" | "crop" | "original")) {
        return url.to_string();
    }
    let mut out = format!("{}-t500x500{}", &stem[..dash], &path[dot..]);
    if let Some(query) = query {
        out.push('?');
        out.push_str(query);
    }
    out
}

pub fn cover(url: Option<&str>) -> Option<Cover> {
    let url = url.map(str::trim).filter(|u| !u.is_empty())?;
    Some(Cover { url: sized_500(url), width: 500, height: 500, fallback_url: Some(url.to_string()) })
}

pub fn year(record: &Value) -> Option<i32> {
    let date = ["release_date", "display_date", "created_at"].iter().find_map(|key| text(record, key))?;
    date.get(..4)?.parse::<i32>().ok().filter(|y| *y > 1900)
}

pub fn user_ref(user: &Value) -> Option<ArtistRef> {
    Some(ArtistRef { id: ids::user_id(num(user)?), name: text(user, "username")? })
}

fn avatar(user: &Value) -> Option<&str> {
    user.get("avatar_url")?.as_str()
}

pub fn track(record: &Value) -> Option<Track> {
    let id = num(record)?;
    let title = text(record, "title")?;
    let user = record.get("user").unwrap_or(&Value::Null);
    let artwork = record.get("artwork_url").and_then(Value::as_str).filter(|u| !u.trim().is_empty());
    Some(Track {
        id: ids::track_id(id),
        title,
        artists: user_ref(user).into_iter().collect(),
        duration_ms: record.get("duration").and_then(Value::as_i64).filter(|d| *d > 0).unwrap_or(0),
        cover: cover(artwork.or_else(|| avatar(user))),
        explicit: (record.pointer("/publisher_metadata/explicit") == Some(&Value::Bool(true))).then_some(true),
        preview: (availability(record) == Err(Reason::Preview)).then_some(true),
    })
}

pub fn track_details(record: &Value) -> Option<TrackDetails> {
    Some(TrackDetails {
        track: track(record)?,
        description: text(record, "description"),
        release_date: text(record, "release_date").or_else(|| text(record, "display_date")),
    })
}

struct SetCore {
    id: String,
    title: String,
    year: Option<i32>,
    cover: Option<Cover>,
    track_count: i64,
    duration_ms: i64,
    tracks: Vec<Track>,
}

fn set_core(set: &Value, track_records: &[Value]) -> Option<SetCore> {
    let tracks: Vec<Track> = track_records.iter().filter_map(track).collect();
    let user = set.get("user").unwrap_or(&Value::Null);
    let artwork = set.get("artwork_url").and_then(Value::as_str).filter(|u| !u.trim().is_empty());
    let first_artwork = track_records.first().and_then(|t| t.get("artwork_url")).and_then(Value::as_str).filter(|u| !u.trim().is_empty());
    Some(SetCore {
        id: ids::set_id(num(set)?),
        title: text(set, "title")?,
        year: year(set),
        cover: cover(artwork.or(first_artwork).or_else(|| avatar(user))),
        track_count: set.get("track_count").and_then(Value::as_i64).unwrap_or(tracks.len() as i64),
        duration_ms: tracks.iter().map(|t| t.duration_ms).sum(),
        tracks,
    })
}

pub fn album(set: &Value, track_records: &[Value]) -> Option<AlbumDetails> {
    let core = set_core(set, track_records)?;
    let artists = user_ref(set.get("user").unwrap_or(&Value::Null)).into_iter().collect();
    Some(AlbumDetails { id: core.id, title: core.title, year: core.year, cover: core.cover, track_count: core.track_count, duration_ms: core.duration_ms, tracks: core.tracks, artists })
}

pub fn playlist(set: &Value, track_records: &[Value]) -> Option<PlaylistDetails> {
    let core = set_core(set, track_records)?;
    let author = set.pointer("/user/username").and_then(Value::as_str).unwrap_or_default().trim().to_string();
    Some(PlaylistDetails {
        id: core.id,
        title: core.title,
        year: core.year,
        cover: core.cover,
        track_count: core.track_count,
        duration_ms: core.duration_ms,
        tracks: core.tracks,
        author,
        description: text(set, "description"),
    })
}

pub fn release_type(set: &Value) -> Option<&'static str> {
    match set.get("set_type").and_then(Value::as_str).map(|t| t.trim().to_ascii_lowercase()).as_deref() {
        Some("single") => Some("single"),
        Some("ep") => Some("ep"),
        _ => None,
    }
}

pub fn set_summary(set: &Value) -> Option<SetSummary> {
    let count = set.get("track_count").and_then(Value::as_i64);
    let user = set.get("user").unwrap_or(&Value::Null);
    let artwork = set.get("artwork_url").and_then(Value::as_str).filter(|u| !u.trim().is_empty());
    Some(SetSummary {
        id: ids::set_id(num(set)?),
        title: text(set, "title")?,
        year: year(set),
        cover: cover(artwork.or_else(|| avatar(user))),
        track_count: count,
        total_tracks: count,
        release_type: release_type(set),
        artists: None,
        author: None,
    })
}

pub fn artist_summary(user: &Value) -> Option<ArtistSummary> {
    let artist = user_ref(user)?;
    Some(ArtistSummary { id: artist.id, name: text(user, "full_name").unwrap_or(artist.name), cover: cover(avatar(user)) })
}

pub fn is_album(set: &Value) -> bool {
    set.get("is_album") == Some(&Value::Bool(true)) || set.get("set_type").and_then(Value::as_str).is_some_and(|t| !t.trim().is_empty())
}
