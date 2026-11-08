//! Spotify playlist and album links, read from Spotify's public embed page with no account. The
//! embed lists at most 100 songs; the rest come from the web player's own paged query, sent with
//! the anonymous token the embed page hands every visitor. When that fails, the public playlist
//! page names how many songs there are, so a longer list is reported as partial instead.

use serde_json::{Value, json};

use crate::parse::SourceRow;

/// The most songs the embed page lists.
pub const EMBED_MAX_TRACKS: usize = 100;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    Playlist,
    Album,
}

impl Kind {
    fn path(self) -> &'static str {
        match self {
            Self::Playlist => "playlist",
            Self::Album => "album",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SpotifyLink {
    pub kind: Kind,
    pub id: String,
}

impl SpotifyLink {
    pub fn embed_url(&self) -> String {
        format!("https://open.spotify.com/embed/{}/{}", self.kind.path(), self.id)
    }

    pub fn page_url(&self) -> String {
        format!("https://open.spotify.com/{}/{}", self.kind.path(), self.id)
    }
}

/// An https `open.spotify.com` playlist or album link, with or without an `intl-xx` segment.
pub fn parse_link(url: &str) -> Option<SpotifyLink> {
    let rest = url.trim().strip_prefix("https://")?;
    let (host, path) = rest.split_once('/')?;
    if !matches!(host.to_ascii_lowercase().as_str(), "open.spotify.com" | "play.spotify.com") {
        return None;
    }
    let path = path.split(['?', '#']).next().unwrap_or_default();
    let mut parts: Vec<&str> = path.split('/').filter(|p| !p.is_empty()).collect();
    if parts.first().is_some_and(|p| p.starts_with("intl-")) {
        parts.remove(0);
    }
    if parts.first() == Some(&"embed") {
        parts.remove(0);
    }
    let [kind, id] = parts[..] else { return None };
    let kind = match kind {
        "playlist" => Kind::Playlist,
        "album" => Kind::Album,
        _ => return None,
    };
    // Spotify ids are 22 base-62 characters
    (id.len() == 22 && id.bytes().all(|b| b.is_ascii_alphanumeric())).then(|| SpotifyLink { kind, id: id.to_string() })
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum EmbedError {
    #[error("the playlist is private or does not exist")]
    Gone,
    #[error("the Spotify page has changed")]
    Changed,
}

#[derive(Debug, Clone, PartialEq)]
pub struct EmbedListing {
    pub label: String,
    pub rows: Vec<SourceRow>,
    /// Entries the page listed, songs or not: the embed's limit applies to these.
    pub listed: usize,
    /// The anonymous token the page gave the embed player.
    pub token: Option<String>,
}

/// The JSON of the page's `__NEXT_DATA__` script.
fn page_data(html: &str) -> Option<Value> {
    let start = html.find("<script id=\"__NEXT_DATA__\"")?;
    let body = &html[start..];
    let open = body.find('>')? + 1;
    let close = body[open..].find("</script>")?;
    serde_json::from_str(&body[open..open + close]).ok()
}

fn text(value: &Value, key: &str) -> String {
    value.get(key).and_then(Value::as_str).map(str::trim).unwrap_or_default().to_string()
}

/// Reads the embed page of a playlist or album into rows; an album's rows carry its title.
pub fn parse_embed(html: &str, kind: Kind) -> Result<EmbedListing, EmbedError> {
    let data = page_data(html).ok_or(EmbedError::Changed)?;
    let props = data.pointer("/props/pageProps").ok_or(EmbedError::Changed)?;
    // a private or deleted playlist answers 200 with a "Page not found" status inside
    if props.get("status").and_then(Value::as_u64).is_some_and(|status| status == 404 || status == 410) {
        return Err(EmbedError::Gone);
    }
    let entity = props.pointer("/state/data/entity").ok_or(EmbedError::Changed)?;
    let tracks = entity.get("trackList").and_then(Value::as_array).ok_or(EmbedError::Changed)?;
    let label = text(entity, "name");
    let album = (kind == Kind::Album && !label.is_empty()).then(|| label.clone());
    let rows = tracks
        .iter()
        .filter(|track| track.get("entityType").and_then(Value::as_str).is_none_or(|t| t == "track"))
        .filter_map(|track| {
            let title = text(track, "title");
            if title.is_empty() {
                return None;
            }
            // names are joined with a comma and a no-break space, so "Tyler, The Creator" stays whole
            let artists = text(track, "subtitle").split(",\u{a0}").map(str::trim).filter(|a| !a.is_empty()).map(str::to_string).collect();
            let duration_ms = track.get("duration").and_then(Value::as_i64).filter(|ms| *ms > 0);
            Some(SourceRow { title, artists, album: album.clone(), duration_ms, ..SourceRow::default() })
        })
        .collect();
    let token = props.pointer("/state/settings/session/accessToken").and_then(Value::as_str).filter(|t| !t.is_empty()).map(str::to_string);
    Ok(EmbedListing { label, rows, listed: tracks.len(), token })
}

/// The song count in the public playlist page's `music:song_count` tag.
pub fn song_count(html: &str) -> Option<usize> {
    let tag = &html[html.find("name=\"music:song_count\"")?..];
    let value = &tag[tag.find("content=\"")? + "content=\"".len()..];
    value[..value.find('"')?].parse().ok()
}

/// The web player's query endpoint.
pub const QUERY_URL: &str = "https://api-partner.spotify.com/pathfinder/v2/query";

/// Entries asked for per page of the web player's query.
pub const PAGE_SIZE: usize = 100;

/// The web player's request for one page of a playlist or album, starting at entry `offset`.
pub fn page_query(link: &SpotifyLink, offset: usize) -> Value {
    // shortcut: these are the persisted query hashes of the web player built 2026-11-06; once Spotify
    // retires them every import keeps the embed's first 100 songs, so update them from the player then
    let uri = format!("spotify:{}:{}", link.kind.path(), link.id);
    let (name, hash, variables) = match link.kind {
        Kind::Playlist => (
            "fetchPlaylistContents",
            "21ea11a6ac75a5f3e01fd365d29c18e0a4a8b7dc09f89bbb5d73910190c6acaf",
            json!({"uri": uri, "offset": offset, "limit": PAGE_SIZE}),
        ),
        Kind::Album => (
            "queryAlbumTracks",
            "0b6ce3511e1b02e4a40fa95440f992acbe85080eb308af9194322d708fc1914f",
            json!({"uri": uri, "offset": offset, "limit": PAGE_SIZE, "locale": ""}),
        ),
    };
    json!({"variables": variables, "operationName": name, "extensions": {"persistedQuery": {"version": 1, "sha256Hash": hash}}})
}

#[derive(Debug, Clone, PartialEq)]
pub struct Page {
    pub rows: Vec<SourceRow>,
    /// Entries on this page, songs or not: the next page starts after them.
    pub entries: usize,
    /// Entries in the whole playlist or album.
    pub total: usize,
}

/// Reads one answer of the web player's query into rows; `album` is the album's title for album rows.
pub fn parse_page(body: &[u8], kind: Kind, album: Option<&str>) -> Result<Page, EmbedError> {
    let data: Value = serde_json::from_slice(body).map_err(|_| EmbedError::Changed)?;
    let list = match kind {
        Kind::Playlist => data.pointer("/data/playlistV2/content"),
        Kind::Album => data.pointer("/data/albumUnion/tracksV2"),
    }
    .ok_or(EmbedError::Changed)?;
    let entries = list.get("items").and_then(Value::as_array).ok_or(EmbedError::Changed)?;
    let total = list.get("totalCount").and_then(Value::as_u64).ok_or(EmbedError::Changed)?;
    let rows = entries
        .iter()
        .filter_map(|entry| {
            // a playlist also holds episodes and missing songs; only songs become rows
            let track = match kind {
                Kind::Playlist => entry.pointer("/itemV2/data").filter(|d| d.get("__typename").and_then(Value::as_str) == Some("Track"))?,
                Kind::Album => entry.get("track")?,
            };
            let title = text(track, "name");
            if title.is_empty() {
                return None;
            }
            let artists = track
                .pointer("/artists/items")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .map(|artist| artist.get("profile").map(|p| text(p, "name")).unwrap_or_default())
                .filter(|name| !name.is_empty())
                .collect();
            let duration_ms = track
                .pointer("/trackDuration/totalMilliseconds")
                .or_else(|| track.pointer("/duration/totalMilliseconds"))
                .and_then(Value::as_i64)
                .filter(|ms| *ms > 0);
            let album = match album {
                Some(album) => Some(album.to_string()),
                None => track.get("albumOfTrack").map(|a| text(a, "name")).filter(|name| !name.is_empty()),
            };
            Some(SourceRow { title, artists, album, duration_ms, ..SourceRow::default() })
        })
        .collect();
    Ok(Page { rows, entries: entries.len(), total: total as usize })
}
