//! yt-dlp as a metadata resolver: it names the direct audio URL, ffmpeg reads only the ranges needed.

use std::path::Path;
use std::time::Duration;

use serde_json::Value;
use tokio::process::Command;

use crate::process::run;
use crate::{FetchError, Remote, classify};

pub const FORMAT: &str = "bestaudio[ext=m4a]/bestaudio/best";
/// Guest player clients that work without cookies; only the YouTube extractor reads them.
pub const YOUTUBE_CLIENTS: &str = "youtube:player_client=tv_simply,web_safari,mweb,default";
/// Usually 3-30 s; slow networks have needed minutes. Closing the stream stops it earlier.
const TIMEOUT: Duration = Duration::from_secs(180);

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Resolved {
    pub title: Option<String>,
    /// `None` for live streams and when the site does not say.
    pub duration_ms: Option<u64>,
    pub remote: Remote,
}

/// Site extractors only: the generic one fetches any page and follows its redirects, so a public
/// link could make yt-dlp read a loopback or LAN address. Needs yt-dlp 2023.01.02 or newer.
pub const EXTRACTORS: &str = "default,-generic";

/// Fixed argument list: no config files, no playlists, no `--exec`, no generic extractor, and the
/// URL after `--` so it can never be read as an option. Proxy is set via environment variables, not arguments.
pub fn args(url: &str) -> Vec<String> {
    [
        "--ignore-config",
        "--use-extractors",
        EXTRACTORS,
        "--no-playlist",
        "--no-exec",
        "--no-warnings",
        "--socket-timeout",
        "20",
        "--extractor-args",
        YOUTUBE_CLIENTS,
        "-f",
        FORMAT,
        "-J",
        "--",
        url,
    ]
    .map(String::from)
    .to_vec()
}

/// What the site says about the song in the media, for matching by name. YouTube and some other
/// extractors fill `track` and `artist`; most leave them empty.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct MediaTags {
    pub title: Option<String>,
    pub uploader: Option<String>,
    pub track: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub duration_ms: Option<u64>,
    pub is_live: bool,
}

pub async fn resolve(yt_dlp: &Path, url: &str, proxy: Option<&str>) -> Result<Resolved, FetchError> {
    resolve_full(yt_dlp, url, proxy).await.map(|(resolved, _)| resolved)
}

/// One yt-dlp run for both the media URL and its tags.
pub async fn resolve_full(yt_dlp: &Path, url: &str, proxy: Option<&str>) -> Result<(Resolved, MediaTags), FetchError> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err(FetchError::InvalidLink);
    }
    let mut command = Command::new(yt_dlp);
    command.args(args(url));
    if let Some(proxy_url) = proxy
        && let Ok(parsed) = reqwest::Url::parse(proxy_url)
    {
        // Extract scheme and set appropriate environment variables
        let scheme = parsed.scheme();
        let mut proxy_without_creds = format!("{}://{}", scheme, parsed.host_str().unwrap_or(""));
        if let Some(port) = parsed.port() {
            proxy_without_creds = format!("{}:{}", proxy_without_creds, port);
        }
        command.env(match scheme {
            "https" => "https_proxy",
            "socks5" | "socks5h" => "all_proxy",
            _ => "http_proxy",
        }, &proxy_without_creds);
    }
    let output = run(command, TIMEOUT, 8 * 1024 * 1024, 64 * 1024).await?;
    if !output.status.success() {
        return Err(classify(&String::from_utf8_lossy(&output.stderr)));
    }
    Ok((parse_info(&output.stdout)?, parse_tags(&output.stdout)?))
}

/// Reads `-J` output for a single selected format: top-level `url` and `http_headers`.
pub fn parse_info(json: &[u8]) -> Result<Resolved, FetchError> {
    let info: Value = serde_json::from_slice(json).map_err(|_| FetchError::Unavailable)?;
    if info["_type"] == "playlist" {
        return Err(FetchError::Unsupported);
    }
    let format = if info["url"].is_string() { &info } else { &info["requested_formats"][0] };
    let url = format["url"].as_str().filter(|u| u.starts_with("https://") || u.starts_with("http://")).ok_or(FetchError::Unsupported)?;
    let headers = format["http_headers"]
        .as_object()
        .into_iter()
        .flatten()
        .filter_map(|(name, value)| {
            let v = value.as_str()?;
            let valid_name = name.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-');
            let valid_value = !v.bytes().any(|b| b < 32 || b == 127);
            (valid_name && valid_value).then(|| (name.clone(), v.to_string()))
        })
        .collect();
    let live = info["is_live"].as_bool() == Some(true);
    let duration_ms = info["duration"].as_f64().filter(|s| *s > 0.0 && !live).map(|s| (s * 1000.0).round() as u64);
    let title = info["title"].as_str().map(str::trim).filter(|t| !t.is_empty()).map(String::from);
    Ok(Resolved { title, duration_ms, remote: Remote { url: url.to_string(), headers } })
}

/// Reads the song fields of `-J` output. Text is trimmed and capped at 300 characters.
pub fn parse_tags(json: &[u8]) -> Result<MediaTags, FetchError> {
    let info: Value = serde_json::from_slice(json).map_err(|_| FetchError::Unavailable)?;
    let text = |key: &str| info[key].as_str().map(str::trim).filter(|t| !t.is_empty()).map(|t| t.chars().take(300).collect::<String>());
    let is_live = info["is_live"].as_bool() == Some(true);
    Ok(MediaTags {
        title: text("title"),
        uploader: text("uploader"),
        track: text("track"),
        artist: text("artist").or_else(|| text("creator")),
        album: text("album"),
        duration_ms: info["duration"].as_f64().filter(|s| *s > 0.0 && !is_live).map(|s| (s * 1000.0).round() as u64),
        is_live,
    })
}
