//! `GET /v1/spotify/import?url=`: a public Spotify playlist or album link as rows for
//! `POST /v1/imports`. Read from Spotify's public embed page with no account, through the daemon's
//! network rules: https only, Spotify hosts only on every hop, a size cap and a timeout. A list the
//! embed cuts at 100 is read on through the web player's paged query with the embed's anonymous
//! token; any failure there keeps the embed's songs and the partial notice.

use std::time::Duration;

use axum::extract::{Query, State};
use axum::routing::get;
use axum::{Json, Router};
use nuvo_import::spotify::{self, EMBED_MAX_TRACKS, EmbedError, Kind, Page, SpotifyLink};
use nuvo_import::{MAX_ROWS, SourceRow};
use nuvo_net::{Fetch, Fetched, NetError, Url};
use serde::Deserialize;
use serde_json::{Value, json};

use crate::error::ApiError;
use crate::state::AppState;

/// A 100-song embed is about 160 KB and the playlist page about 450 KB.
const MAX_PAGE_BYTES: usize = 4 * 1024 * 1024;
const TIMEOUT: Duration = Duration::from_secs(15);

fn host_allowed(host: &str) -> bool {
    matches!(host, "open.spotify.com" | "spotify.link" | "spotify.app.link")
}

const FETCH: Fetch = Fetch { allow: host_allowed, max_bytes: MAX_PAGE_BYTES, timeout: TIMEOUT, max_redirects: 5, accept: "text/html" };

/// A page of 100 playlist entries answers about 570 KB.
const QUERY: Fetch = Fetch {
    allow: |host| host == "api-partner.spotify.com",
    max_bytes: MAX_PAGE_BYTES,
    timeout: TIMEOUT,
    max_redirects: 0,
    accept: "application/json",
};

const BROWSER: &str = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
/// The pause between two pages, and the waits after a 429 when Spotify names none.
const PAGE_PAUSE: Duration = Duration::from_millis(300);
const BACKOFF: [Duration; 3] = [Duration::from_secs(1), Duration::from_secs(2), Duration::from_secs(4)];
const MAX_RETRY_WAIT: Duration = Duration::from_secs(10);

pub fn routes() -> Router<AppState> {
    Router::new().route("/v1/spotify/import", get(import))
}

#[derive(Deserialize)]
struct ImportQuery {
    url: Option<String>,
}

fn net_error(err: NetError) -> ApiError {
    match err {
        // a short link that leads off Spotify
        NetError::Forbidden(_) => ApiError::Invalid("not a Spotify playlist or album link".into()),
        NetError::Timeout => ApiError::UpstreamTimeout,
        NetError::TooLarge => ApiError::SourceChanged,
        NetError::Redirects | NetError::Http(_) => ApiError::Upstream("Spotify could not be reached".into()),
    }
}

async fn page(state: &AppState, url: &str) -> Result<Fetched, ApiError> {
    let url = Url::parse(url).map_err(|_| ApiError::Invalid("not a Spotify playlist or album link".into()))?;
    let fetched = state.net.send(&url, &FETCH, &[("user-agent", BROWSER)], None).await.map_err(net_error)?;
    match fetched.status {
        200..=299 => Ok(fetched),
        404 | 410 => Err(ApiError::NotFound("the playlist is private or does not exist".into())),
        429 => Err(ApiError::RateLimited),
        status => Err(ApiError::Upstream(format!("Spotify answered {status}"))),
    }
}

/// A `spotify.link` short link is followed to the playlist or album it names.
async fn resolve(state: &AppState, input: &str) -> Result<SpotifyLink, ApiError> {
    if let Some(link) = spotify::parse_link(input) {
        return Ok(link);
    }
    let invalid = || ApiError::Invalid("not a Spotify playlist or album link".into());
    let short = Url::parse(input).ok().filter(|url| url.host_str() == Some("spotify.link")).ok_or_else(invalid)?;
    let landed = page(state, short.as_str()).await?;
    spotify::parse_link(landed.url.as_str()).ok_or_else(invalid)
}

async fn import(State(state): State<AppState>, Query(q): Query<ImportQuery>) -> Result<Json<Value>, ApiError> {
    let input = q.url.as_deref().map(str::trim).filter(|u| !u.is_empty() && u.len() <= 2048).ok_or_else(|| ApiError::Invalid("url is required".into()))?;
    let link = resolve(&state, input).await?;
    let embed = page(&state, &link.embed_url()).await?;
    let listing = spotify::parse_embed(&String::from_utf8_lossy(&embed.body), link.kind).map_err(|err| match err {
        EmbedError::Gone => ApiError::NotFound(err.to_string()),
        EmbedError::Changed => ApiError::SourceChanged,
    })?;
    let listed = listing.listed;
    let mut rows = listing.rows;
    let mut complete = listed < EMBED_MAX_TRACKS;
    if !complete {
        let album = (link.kind == Kind::Album).then_some(listing.label.as_str());
        let rest = match &listing.token {
            Some(token) => rest(&state, &link, token, listed, album).await,
            None => Err("the embed gave no token".into()),
        };
        match rest {
            Ok(more) => {
                rows.extend(more);
                complete = true;
            }
            // the reason names a status or a step, never the link
            Err(reason) => tracing::info!(%reason, "spotify: keeping the embed's first songs"),
        }
    }
    let mut answer = json!({"label": listing.label, "rows": rows});
    if !complete {
        // the public playlist page says how many songs there are; an album page does not
        let total = match link.kind {
            Kind::Playlist => match page(&state, &link.page_url()).await {
                Ok(fetched) => spotify::song_count(&String::from_utf8_lossy(&fetched.body)),
                Err(_) => None,
            },
            Kind::Album => None,
        };
        // an unknown total still warns: a full embed most likely means a longer list
        if total.is_none_or(|total| total > listed) {
            answer["partial"] = json!(true);
            if let Some(total) = total {
                answer["total"] = json!(total);
            }
        }
    }
    Ok(Json(answer))
}

/// The entries after the first `offset`, page by page the way the web player reads a list.
async fn rest(state: &AppState, link: &SpotifyLink, token: &str, mut offset: usize, album: Option<&str>) -> Result<Vec<SourceRow>, String> {
    let mut rows = Vec::new();
    loop {
        let page = query_page(state, link, token, offset, album).await?;
        if page.entries == 0 && offset < page.total {
            return Err("an empty page before the end".into());
        }
        offset += page.entries;
        rows.extend(page.rows);
        if offset >= page.total {
            return Ok(rows);
        }
        if offset >= MAX_ROWS {
            return Err("over the row limit".into());
        }
        tokio::time::sleep(PAGE_PAUSE).await;
    }
}

async fn query_page(state: &AppState, link: &SpotifyLink, token: &str, offset: usize, album: Option<&str>) -> Result<Page, String> {
    let url = Url::parse(spotify::QUERY_URL).expect("static URL");
    let body = spotify::page_query(link, offset).to_string();
    let auth = format!("Bearer {token}");
    let headers = [
        ("authorization", auth.as_str()),
        ("content-type", "application/json;charset=UTF-8"),
        ("user-agent", BROWSER),
        ("app-platform", "WebPlayer"),
    ];
    let mut waits = BACKOFF.into_iter();
    loop {
        let fetched = state.net.send(&url, &QUERY, &headers, Some(body.as_bytes())).await.map_err(|err| err.to_string())?;
        match fetched.status {
            200..=299 => return spotify::parse_page(&fetched.body, link.kind, album).map_err(|err| err.to_string()),
            429 => {
                let wait = waits.next().ok_or("still rate limited after retries")?;
                let named = fetched.header("retry-after").and_then(|v| v.trim().parse().ok()).map(Duration::from_secs);
                tokio::time::sleep(named.unwrap_or(wait).min(MAX_RETRY_WAIT)).await;
            }
            status => return Err(format!("Spotify answered {status}")),
        }
    }
}
