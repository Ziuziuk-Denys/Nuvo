use std::time::Duration;

use nuvo_contracts::{Deps, ToolStatus, ToolStatusKind, iso_from_ms, ms_from_iso};
use nuvo_fetch::tools::{ToolCheck, check_all};
use nuvo_store::now_ms;

use crate::state::AppState;

pub const CHECK_TIMEOUT: Duration = Duration::from_secs(5);
/// YouTube changes break old yt-dlp releases within weeks.
pub const OUTDATED_AFTER_MS: i64 = 90 * 86_400_000;
pub const SINGLE_FLIGHT_CACHE_MS: i64 = 2000;

/// yt-dlp versions are release dates: `2026.10.21`; nightly builds add `.232807`.
pub fn ytdlp_release_ms(version: &str) -> Option<i64> {
    let mut parts = version.trim().split('.');
    let (year, month, day) = (parts.next()?, parts.next()?, parts.next()?);
    if year.len() != 4 || !(1..=2).contains(&month.len()) || !(1..=2).contains(&day.len()) {
        return None;
    }
    ms_from_iso(&format!("{year}-{month:0>2}-{day:0>2}T00:00:00Z"))
}

pub fn to_wire(checks: Vec<ToolCheck>, now: i64) -> Deps {
    let tools = checks
        .into_iter()
        .map(|check| {
            let released = check.version.as_deref().and_then(ytdlp_release_ms);
            let status = match check.status {
                "ok" => {
                    if check.name == "yt-dlp" && released.is_some_and(|at| now - at > OUTDATED_AFTER_MS) {
                        ToolStatusKind::Outdated
                    } else {
                        ToolStatusKind::Ok
                    }
                }
                "missing" => ToolStatusKind::Missing,
                "broken" => ToolStatusKind::Broken,
                _ => ToolStatusKind::Missing,
            };
            ToolStatus {
                name: check.name,
                path: check.path.map(|p| p.to_string_lossy().into_owned()),
                version: check.version,
                status,
                needed_by: check.needed_by,
            }
        })
        .collect();
    Deps { checked_at: iso_from_ms(now), tools, download: None }
}

async fn do_check(state: &AppState) -> Deps {
    let now = now_ms();
    let deps = to_wire(check_all(&state.env, CHECK_TIMEOUT).await, now);
    *state.deps.write().expect("deps lock") = Some(deps.clone());
    *state.deps_checked_at.write().expect("deps_checked_at lock") = now;
    deps
}

pub async fn refresh(state: &AppState) -> Deps {
    let _lock = state.deps_lock.lock().await;
    let now = now_ms();
    let checked_at = *state.deps_checked_at.read().expect("deps_checked_at lock");

    if now - checked_at < SINGLE_FLIGHT_CACHE_MS
        && let Some(deps) = state.deps.read().expect("deps lock").clone()
    {
        return deps;
    }

    do_check(state).await
}

pub async fn recheck(state: &AppState) -> Deps {
    let _lock = state.deps_lock.lock().await;
    do_check(state).await
}

pub async fn current(state: &AppState) -> Deps {
    let cached = state.deps.read().expect("deps lock").clone();
    match cached {
        Some(deps) => deps,
        None => refresh(state).await,
    }
}
