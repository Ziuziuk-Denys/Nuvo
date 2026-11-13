use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use nuvo_contracts::{Deps, ToolDownload, ToolStatusKind};
use nuvo_fetch::tools::exe_name;
use nuvo_fetch::update::{Archive, BINARY_NAME, Outcome, Progress, TOOL_HOSTS, UpdateError, asset_for, deno_build_for, ffmpeg_build_for, install_archive, update_yt_dlp};
use nuvo_store::now_ms;
use reqwest::redirect::Policy;

use crate::deps;
use crate::state::AppState;

pub const DAY_MS: i64 = 86_400_000;
const RETRY_AFTER: Duration = Duration::from_secs(3600);
/// Main sends the proxy once the daemon is ready; the first request has to go through it.
const FIRST_DELAY: Duration = Duration::from_secs(20);
/// A connection that breaks mid-download gets two more tries, each continuing the partial file.
const RETRY_PAUSES: [Duration; 2] = [Duration::from_secs(10), Duration::from_secs(60)];
const STAMP_FILE: &str = ".last-update-check";

/// The rows Settings can download again.
pub const TOOLS: [&str; 3] = ["yt-dlp", "js-runtime", "ffmpeg"];

pub fn wanted(deps: &Deps, have_managed: bool) -> bool {
    have_managed || deps.tools.iter().find(|tool| tool.name == BINARY_NAME).is_none_or(|tool| tool.status != ToolStatusKind::Ok)
}

pub fn due(now: i64, last_check: Option<i64>) -> bool {
    last_check.is_none_or(|at| now - at >= DAY_MS || at > now)
}

/// Missing or broken; a system copy that works is always used first.
pub fn lacking(deps: &Deps, name: &str) -> bool {
    deps.tools.iter().find(|tool| tool.name == name).is_none_or(|tool| tool.status == ToolStatusKind::Missing || tool.status == ToolStatusKind::Broken)
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

/// Plain http is the local test server; real sources are https and must stay on their hosts.
pub fn redirect_allowed(url: &reqwest::Url, https_only: bool) -> bool {
    !https_only || (url.scheme() == "https" && url.host_str().is_some_and(|host| TOOL_HOSTS.contains(&host)))
}

fn client(state: &AppState, https_only: bool) -> Result<reqwest::Client, UpdateError> {
    let redirects = Policy::custom(move |attempt| {
        if attempt.previous().len() >= 5 {
            attempt.error("too many redirects")
        } else if redirect_allowed(attempt.url(), https_only) {
            attempt.follow()
        } else {
            attempt.error("redirect to a host outside the tool sources")
        }
    });
    reqwest::Client::builder()
        .redirect(redirects)
        .https_only(https_only)
        .connect_timeout(Duration::from_secs(15))
        .read_timeout(Duration::from_secs(60))
        .proxy(state.proxy_hook())
        .build()
        .map_err(|e| UpdateError::Network(e.to_string()))
}

enum Job<'a> {
    YtDlp { url: &'a str, asset: &'static str },
    Archive { build: &'a Archive, force: bool },
}

async fn run(state: &AppState, tool: &'static str, job: &Job<'_>, client: &reqwest::Client, progress: Progress<'_>) -> Result<Outcome, UpdateError> {
    let dir = &state.paths.tools;
    match job {
        Job::YtDlp { url, asset } => update_yt_dlp(client, url, asset, dir, progress).await,
        Job::Archive { build, force } => install_archive(client, build, tool, dir, *force, progress).await,
    }
}

// No answer at all is the offline case: logged, not shown, tried again later
async fn fetch(state: &AppState, tool: &'static str, https_only: bool, job: Job<'_>) -> Result<Outcome, UpdateError> {
    let started = AtomicBool::new(false);
    let report = |received, total| {
        started.store(true, Ordering::Relaxed);
        set_download(state, Some(ToolDownload { tool, received, total, failed: false }));
    };
    let client = client(state, https_only)?;
    let mut result = run(state, tool, &job, &client, &report).await;
    for pause in RETRY_PAUSES {
        if !(started.load(Ordering::Relaxed) && matches!(result, Err(UpdateError::Network(_)))) {
            break;
        }
        tokio::time::sleep(pause).await;
        result = run(state, tool, &job, &client, &report).await;
    }
    match &result {
        Ok(outcome) => {
            set_download(state, None);
            if *outcome == Outcome::Installed {
                deps::recheck(state).await;
                tracing::info!(tool, "tool installed");
            }
        }
        Err(err @ UpdateError::Network(_)) if !started.load(Ordering::Relaxed) => tracing::info!(tool, %err, "tool source unreachable, trying again later"),
        Err(err) => {
            tracing::warn!(tool, %err, "tool download failed, keeping what works");
            let last = state.tool_download.read().expect("tool download lock").clone().filter(|d| d.tool == tool);
            set_download(state, Some(ToolDownload { tool, received: last.as_ref().map_or(0, |d| d.received), total: last.and_then(|d| d.total), failed: true }));
        }
    }
    result
}

pub async fn tick(state: &AppState, url: &str, asset: &'static str, now: i64, force: bool) -> Duration {
    let dir = &state.paths.tools;
    let current = deps::current(state).await;
    if !force && !lacking(&current, BINARY_NAME) && !due(now, read_stamp(dir)) {
        return RETRY_AFTER;
    }
    if !force && !wanted(&current, dir.join(exe_name(BINARY_NAME)).is_file()) {
        return RETRY_AFTER;
    }
    if let Err(err) = std::fs::create_dir_all(dir) {
        tracing::warn!(%err, "tool directory unavailable");
        return RETRY_AFTER;
    }
    let result = fetch(state, BINARY_NAME, url.starts_with("https://"), Job::YtDlp { url, asset }).await;
    if result.is_ok()
        && let Err(err) = write_stamp(dir, now)
    {
        tracing::warn!(%err, "update stamp not written");
    }
    RETRY_AFTER
}

/// `name` is the program and the label of its download: `ffmpeg` or `deno`.
pub async fn ensure(state: &AppState, name: &'static str, build: Option<Archive>, wanted: bool, force: bool) {
    let Some(build) = build.filter(|_| wanted || force) else {
        return;
    };
    let _ = fetch(state, name, build.url.starts_with("https://"), Job::Archive { build: &build, force }).await;
}

/// Runs a round now instead of at the next hour; `tool` is a Settings row to download again.
pub fn request(state: &AppState, tool: Option<&'static str>) {
    if let Some(tool) = tool {
        state.tool_requests.lock().expect("tool requests lock").push(tool);
    }
    state.tool_wake.notify_one();
}

pub fn spawn(state: AppState) {
    let (Some(url), Some(asset)) = (state.tools_url.clone(), asset_for(std::env::consts::OS, std::env::consts::ARCH)) else {
        return;
    };
    let (os, arch) = (std::env::consts::OS, std::env::consts::ARCH);
    tokio::spawn(async move {
        tokio::time::sleep(FIRST_DELAY).await;
        loop {
            let asked = std::mem::take(&mut *state.tool_requests.lock().expect("tool requests lock"));
            let current = deps::recheck(&state).await;
            tick(&state, &url, asset, now_ms(), asked.contains(&"yt-dlp")).await;
            ensure(&state, "deno", deno_build_for(os, arch), lacking(&current, "js-runtime"), asked.contains(&"js-runtime")).await;
            ensure(&state, "ffmpeg", ffmpeg_build_for(os, arch), lacking(&current, "ffmpeg"), asked.contains(&"ffmpeg")).await;
            tokio::select! {
                () = tokio::time::sleep(RETRY_AFTER) => {}
                () = state.tool_wake.notified() => {}
            }
        }
    });
}
