//! `POST /v1/links/inspect`: what a pasted link holds, without downloading audio. TikTok posts are read
//! by the TikTok extractor, short links of a few services are followed, everything else goes to yt-dlp
//! with recognize's fixed argument list. Failures answer `200 {"error": code}` with recognize's codes.

use std::time::Instant;

use axum::extract::State;
use axum::routing::post;
use axum::{Json, Router};
use nuvo_fetch::link::Link;
use nuvo_fetch::ytdlp;
use nuvo_fetch::{FetchError, Remote, ensure_public, follow_public, parse_link};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::error::ApiError;
use crate::extract::JsonBody;
use crate::links::Inspected;
use crate::state::AppState;

/// Short-link hosts whose redirects are followed (each hop checked); the renderer routes the target.
pub const SHORT_HOSTS: [&str; 4] = ["deezer.page.link", "link.deezer.com", "spotify.link", "on.soundcloud.com"];

pub fn routes() -> Router<AppState> {
    Router::new().route("/v1/links/inspect", post(inspect))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Body {
    url: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SoundInfo<'a> {
    title: &'a str,
    author: &'a str,
    original: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    album: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    clip_ms: Option<u64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MediaInfo<'a> {
    #[serde(skip_serializing_if = "Option::is_none")]
    title: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    uploader: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    track: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    artist: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    album: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    duration_ms: Option<u64>,
    is_live: bool,
}

async fn inspect(State(state): State<AppState>, JsonBody(body): JsonBody<Body>) -> Result<Json<Value>, ApiError> {
    state.data()?;
    Ok(match run(&state, &body.url).await {
        Ok(answer) => Json(answer),
        Err(err) => {
            tracing::info!(code = err.code(), "links: inspect failed");
            Json(json!({ "error": err.code() }))
        }
    })
}

pub fn is_short_link(host: &str) -> bool {
    SHORT_HOSTS.contains(&host)
}

/// The post's own address, which TikTok's extractor reads without a redirect.
fn tiktok_url(id: &str) -> String {
    format!("https://www.tiktok.com/@i/video/{id}")
}

async fn run(state: &AppState, url: &str) -> Result<Value, FetchError> {
    let link = parse_link(url)?;
    if is_short_link(&link.host) {
        let target = follow_public(&Remote { url: link.url.clone(), headers: vec![] }, Some(&state.proxy_hook())).await?;
        return Ok(json!({ "kind": "redirect", "canonicalUrl": parse_link(&target.url)?.url }));
    }
    let now = Instant::now();
    let inspected = match state.links.get(&link.url, now) {
        Some(hit) => hit,
        None => {
            let fresh = read(state, &link).await?;
            let canonical = match &fresh {
                Inspected::TikTok(post) => tiktok_url(&post.id),
                Inspected::Media(..) => link.url.clone(),
            };
            state.links.put(&[&link.url, &canonical], fresh.clone(), now);
            fresh
        }
    };
    Ok(describe(&link, &inspected))
}

async fn read(state: &AppState, link: &Link) -> Result<Inspected, FetchError> {
    if link.tiktok {
        match state.tiktok.post(&link.url).await {
            Ok(post) => return Ok(Inspected::TikTok(post)),
            // A wall or a network hiccup on our side: yt-dlp may still get through, as in recognize.
            Err(FetchError::Blocked | FetchError::Network(_)) => {}
            Err(other) => return Err(other),
        }
    } else {
        ensure_public(&link.url).await?;
    }
    let yt_dlp = state.env.find("yt-dlp").ok_or(FetchError::ToolMissing("yt-dlp"))?;
    let (resolved, tags) = ytdlp::resolve_full(&yt_dlp, &link.url, state.proxy_url().as_deref()).await?;
    Ok(Inspected::Media(resolved, tags))
}

fn describe(link: &Link, inspected: &Inspected) -> Value {
    match inspected {
        Inspected::TikTok(post) => {
            let sound = post.sound.as_ref().map(|s| SoundInfo {
                title: &s.title,
                author: &s.author,
                original: s.original,
                album: s.album.as_deref(),
                clip_ms: (s.duration_ms > 0).then_some(s.duration_ms),
            });
            let mut answer = json!({ "kind": "tiktok", "canonicalUrl": tiktok_url(&post.id) });
            if let Some(sound) = sound {
                answer["sound"] = serde_json::to_value(sound).expect("sound serializes");
            }
            answer
        }
        Inspected::Media(_, tags) => {
            let media = MediaInfo {
                title: tags.title.as_deref(),
                uploader: tags.uploader.as_deref(),
                track: tags.track.as_deref(),
                artist: tags.artist.as_deref(),
                album: tags.album.as_deref(),
                duration_ms: tags.duration_ms,
                is_live: tags.is_live,
            };
            json!({ "kind": "media", "canonicalUrl": link.url, "media": media })
        }
    }
}
