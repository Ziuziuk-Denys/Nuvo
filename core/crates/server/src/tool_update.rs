//! The daily yt-dlp update. Silent by design: nothing asks the user anything, a failure keeps the
//! last good build and tries again in an hour, and playback never waits for it.

use std::path::Path;
use std::time::Duration;

use nuvo_contracts::{Deps, ToolDownload, ToolStatusKind};
use nuvo_fetch::update::{BINARY_NAME, Outcome, UpdateError, asset_for, ffmpeg_build_for, install_ffmpeg, update_yt_dlp};
use nuvo_store::now_ms;
use reqwest::redirect::Policy;

use crate::deps;
use crate::state::AppState;

pub const DAY_MS: i64 = 86_400_000;
const RETRY_AFTER: Duration = Duration::from_secs(3600);
/// Main sends the proxy once the daemon is ready; the first request has to go through it.
const FIRST_DELAY: Duration = Duration::from_secs(20);
const STAMP_FILE: &str = ".last-update-check";

/// A build of ours is kept current; otherwise one is fetched only when the system has no working recent copy.
pub fn wanted(deps: &Deps, have_managed: bool) -> bool {
    have_managed || deps.tools.iter().find(|tool| tool.name == BINARY_NAME).is_none_or(|tool| tool.status != ToolStatusKind::Ok)
}

pub fn due(now: i64, last_check: Option<i64>) -> bool {
    last_check.is_none_or(|at| now - at >= DAY_MS || at > now)
}

/// The pinned ffmpeg is fetched once, and only when the system has no working one.
pub fn ffmpeg_wanted(deps: &Deps) -> bool {
    deps.tools.iter().find(|tool| tool.name == "ffmpeg").is_none_or(|tool| tool.status == ToolStatusKind::Missing || tool.status == ToolStatusKind::Broken)
}

fn read_stamp(dir: &Path) -> Option<i64> {
    std::fs::read_to_string(dir.join(STAMP_FILE)).ok()?.trim().parse().ok()
}

fn write_stamp(dir: &Path, now: i64) -> std::io::Result<()> {
    let partial = dir.join(format!("{STAMP_FILE}.partial"));
    std::fs::write(&partial, now.to_string())?;
    std::fs::rename(partial, dir.join(STAMP_FILE))
}

fn set_download(state: &AppState, download: Option<ToolDownload>) {
    *state.tool_download.write().expect("tool download lock") = download;
}

fn client(state: &AppState, https_only: bool) -> Result<reqwest::Client, UpdateError> {
    reqwest::Client::builder()
        .redirect(Policy::limited(5))
        .https_only(https_only)
        .connect_timeout(Duration::from_secs(15))
        .read_timeout(Duration::from_secs(60))
        .proxy(state.proxy_hook())
        .build()
        .map_err(|e| UpdateError::Network(e.to_string()))
}

async fn run_once(state: &AppState, url: &str, asset: &'static str) -> Result<Outcome, UpdateError> {
    let client = client(state, url.starts_with("https://"))?;
    let report = |received, total| set_download(state, Some(ToolDownload { tool: BINARY_NAME, received, total, failed: false }));
    update_yt_dlp(&client, url, asset, &state.paths.tools, &report).await
}

/// Runs the check when it is due and says how long to sleep.
pub async fn tick(state: &AppState, url: &str, asset: &'static str, now: i64) -> Duration {
    let dir = &state.paths.tools;
    if !due(now, read_stamp(dir)) {
        return RETRY_AFTER;
    }
    let current = deps::current(state).await;
    if !wanted(&current, dir.join(BINARY_NAME).is_file()) {
        return RETRY_AFTER;
    }
    if let Err(err) = std::fs::create_dir_all(dir) {
        tracing::warn!(%err, "tool directory unavailable");
        return RETRY_AFTER;
    }
    match run_once(state, url, asset).await {
        Ok(outcome) => {
            set_download(state, None);
            if outcome == Outcome::Installed {
                deps::recheck(state).await;
                tracing::info!("yt-dlp updated");
            }
            if let Err(err) = write_stamp(dir, now) {
                tracing::warn!(%err, "update stamp not written");
            }
        }
        Err(err) => {
            tracing::warn!(%err, "yt-dlp update failed, keeping the current build");
            let last = state.tool_download.read().expect("tool download lock").clone();
            set_download(state, Some(ToolDownload { tool: BINARY_NAME, received: last.as_ref().map_or(0, |d| d.received), total: last.and_then(|d| d.total), failed: true }));
        }
    }
    RETRY_AFTER
}

/// Fetches the pinned ffmpeg when the system has none. A failure keeps the download line (failed)
/// until the next try, an hour later.
pub async fn ensure_ffmpeg(state: &AppState) {
    let Some(build) = ffmpeg_build_for(std::env::consts::OS, std::env::consts::ARCH) else {
        return;
    };
    if !ffmpeg_wanted(&deps::current(state).await) {
        return;
    }
    let report = |received, total| set_download(state, Some(ToolDownload { tool: "ffmpeg", received, total, failed: false }));
    let result = match client(state, true) {
        Ok(client) => install_ffmpeg(&client, &build, &state.paths.tools, &report).await,
        Err(err) => Err(err),
    };
    match result {
        Ok(_) => {
            set_download(state, None);
            deps::recheck(state).await;
        }
        Err(err) => {
            tracing::warn!(%err, "ffmpeg download failed, trying again later");
            let last = state.tool_download.read().expect("tool download lock").clone();
            set_download(state, Some(ToolDownload { tool: "ffmpeg", received: last.as_ref().map_or(0, |d| d.received), total: last.and_then(|d| d.total), failed: true }));
        }
    }
}

pub fn spawn(state: AppState) {
    let (Some(url), Some(asset)) = (state.tools_url.clone(), asset_for(std::env::consts::OS, std::env::consts::ARCH)) else {
        return;
    };
    tokio::spawn(async move {
        tokio::time::sleep(FIRST_DELAY).await;
        loop {
            let wait = tick(&state, &url, asset, now_ms()).await;
            ensure_ffmpeg(&state).await;
            tokio::time::sleep(wait).await;
        }
    });
}
