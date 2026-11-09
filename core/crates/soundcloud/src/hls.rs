use std::future::Future;
use std::time::Duration;

use futures::StreamExt;
use nuvo_net::Url;

use crate::client::SoundCloud;
use crate::{Reason, ScError};

const PLAYLIST_MAX_BYTES: usize = 1024 * 1024;
const SEGMENT_MAX_BYTES: usize = 20 * 1024 * 1024;
const MAX_PLAYLIST_FETCHES: usize = 3;
const MAX_SEGMENTS: usize = 5000;
const SEGMENT_WINDOW: usize = 6;
const ATTEMPTS: usize = 2;
/// Larger assembled files fail this transcoding.
pub const MAX_ASSEMBLED_BYTES: u64 = 300 * 1024 * 1024;

#[derive(Debug, PartialEq)]
pub enum Playlist {
    Master(Url),
    Media { init: Option<Url>, segments: Vec<Url> },
}

#[derive(Debug, PartialEq)]
pub enum HlsError {
    NotAPlaylist,
    Encrypted,
    NoVariant,
    NoSegments,
    BadUri(String),
    TooManySegments,
    Unsupported(String),
}

pub trait AudioSink: Send {
    fn write(&mut self, chunk: &[u8]) -> impl Future<Output = std::io::Result<()>> + Send;
    fn discard(&mut self) -> impl Future<Output = ()> + Send;
}

impl AudioSink for Vec<u8> {
    async fn write(&mut self, chunk: &[u8]) -> std::io::Result<()> {
        self.extend_from_slice(chunk);
        Ok(())
    }

    async fn discard(&mut self) {
        self.clear();
    }
}

fn attribute(line: &str, name: &str) -> Option<String> {
    let key = format!("{name}=");
    let bytes = line.as_bytes();
    let mut in_quotes = false;
    for (i, ch) in line.char_indices() {
        if ch == '"' && (i == 0 || bytes[i - 1] != b'\\') {
            in_quotes = !in_quotes;
        }
        let at_boundary = i == 0 || bytes[i - 1] == b',' || bytes[i - 1] == b':';
        if in_quotes || !at_boundary || !line[i..].starts_with(&key) {
            continue;
        }
        let rest = &line[i + key.len()..];
        if rest.is_empty() {
            return None;
        }
        if let Some(quoted) = rest.strip_prefix('"') {
            return quoted.find('"').map(|end| quoted[..end].to_string());
        }
        return Some(rest.split(',').next().unwrap_or_default().to_string());
    }
    None
}

pub fn parse(text: &str, base: &Url) -> Result<Playlist, HlsError> {
    let mut lines = text.lines().map(str::trim).filter(|l| !l.is_empty());
    if lines.next() != Some("#EXTM3U") {
        return Err(HlsError::NotAPlaylist);
    }
    let join = |uri: &str| base.join(uri).map_err(|_| HlsError::BadUri(uri.to_string()));
    let mut master = false;
    let mut init = None;
    let mut segments = Vec::new();
    for line in lines {
        if line.starts_with("#EXT-X-KEY:") {
            let method = attribute(line, "METHOD").map(|m| m.to_ascii_uppercase()).unwrap_or_default();
            if method != "NONE" {
                return Err(HlsError::Encrypted);
            }
        } else if line.starts_with("#EXT-X-SESSION-KEY:") {
            let method = attribute(line, "METHOD").map(|m| m.to_ascii_uppercase()).unwrap_or_default();
            if method != "NONE" {
                return Err(HlsError::Encrypted);
            }
        } else if line.starts_with("#EXT-X-BYTERANGE") {
            return Err(HlsError::Unsupported("byte range segments not supported".into()));
        } else if line.starts_with("#EXT-X-STREAM-INF") {
            master = true;
        } else if let Some(map) = line.strip_prefix("#EXT-X-MAP:") {
            if let Some(uri) = attribute(map, "URI") {
                init = Some(join(&uri)?);
            }
        } else if line.starts_with('#') {
            continue;
        } else if master {
            return Ok(Playlist::Master(join(line)?));
        } else {
            if segments.len() >= MAX_SEGMENTS {
                return Err(HlsError::TooManySegments);
            }
            segments.push(join(line)?);
        }
    }
    if master {
        return Err(HlsError::NoVariant);
    }
    if segments.is_empty() {
        return Err(HlsError::NoSegments);
    }
    Ok(Playlist::Media { init, segments })
}

impl From<HlsError> for ScError {
    fn from(err: HlsError) -> Self {
        match err {
            HlsError::Encrypted => ScError::Unplayable(Reason::Drm),
            other => ScError::Upstream(format!("HLS playlist unusable: {other:?}")),
        }
    }
}

impl SoundCloud {
    async fn fetch_twice(&self, url: &Url, max_bytes: usize, timeout: Duration) -> Result<Vec<u8>, ScError> {
        let mut last = ScError::Upstream("no attempt".into());
        for attempt in 0..ATTEMPTS {
            match self.get_url(url, max_bytes, timeout).await {
                Ok(response) if response.ok() => return Ok(response.body),
                Ok(response) => {
                    last = ScError::Status(response.status);
                    if !matches!(response.status, 500..=599 | 429) || attempt >= ATTEMPTS - 1 {
                        return Err(last);
                    }
                }
                Err(err) => {
                    if !matches!(err, ScError::Timeout) || attempt >= ATTEMPTS - 1 {
                        return Err(err);
                    }
                    last = err;
                }
            }
        }
        Err(last)
    }

    pub async fn assemble(&self, playlist_url: &Url, sink: &mut impl AudioSink) -> Result<u64, ScError> {
        let mut url = playlist_url.clone();
        let mut fetches = 0;
        let (init, segments) = loop {
            fetches += 1;
            if fetches > MAX_PLAYLIST_FETCHES {
                return Err(ScError::Upstream("HLS master playlists nest too deep".into()));
            }
            let body = self.fetch_twice(&url, PLAYLIST_MAX_BYTES, self.inner.limits.api_timeout).await?;
            match parse(&String::from_utf8_lossy(&body), &url)? {
                Playlist::Master(variant) => url = variant,
                Playlist::Media { init, segments } => break (init, segments),
            }
        };
        let timeout = self.inner.limits.segment_timeout;
        let mut total = 0u64;
        let mut parts = futures::stream::iter(init.into_iter().chain(segments)).map(|u| async move { self.fetch_twice(&u, SEGMENT_MAX_BYTES, timeout).await }).buffered(SEGMENT_WINDOW);
        while let Some(part) = parts.next().await {
            let part = part?;
            total += part.len() as u64;
            if total > MAX_ASSEMBLED_BYTES {
                return Err(ScError::Upstream("HLS stream is over the size limit".into()));
            }
            sink.write(&part).await.map_err(|e| ScError::Upstream(format!("cannot store audio: {e}")))?;
        }
        Ok(total)
    }
}
