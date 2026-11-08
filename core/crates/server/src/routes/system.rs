use axum::extract::State;
use axum::http::StatusCode;
use axum::routing::{get, post, put};
use axum::{Json, Router};
use nuvo_contracts::{DaemonReport, Deps, Health, KeyStorage, NetCheck, NetworkSettings, SetPassphrase};
use nuvo_fetch::proxy::parse_proxy;
use nuvo_store::now_ms;

use crate::deps;
use crate::error::ApiError;
use crate::extract::JsonBody;
use crate::netcheck;
use crate::report::{log_tail, redact};
use crate::routes::cache::cache_status;
use crate::state::AppState;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/health", get(health))
        .route("/v1/system/shutdown", post(shutdown))
        .route("/v1/system/network", put(set_network))
        .route("/v1/system/deps", get(read_deps))
        .route("/v1/system/deps/recheck", post(recheck_deps))
        .route("/v1/system/network-check", post(network_check))
        .route("/v1/system/report", get(report))
        .route("/v1/system/key-storage", get(key_storage))
        .route("/v1/system/key-passphrase", put(set_key_passphrase))
}

/// Where the key lives; works while locked, so the lock screen and Settings can both ask.
async fn key_storage(State(state): State<AppState>) -> Json<KeyStorage> {
    Json(KeyStorage { protection: state.key_protection() })
}

/// Seals the key file with a passphrase, or writes it plain again for `null`. Only where the key is
/// in a file: a keyring needs none.
async fn set_key_passphrase(State(state): State<AppState>, JsonBody(body): JsonBody<SetPassphrase>) -> Result<Json<KeyStorage>, ApiError> {
    if body.passphrase.as_deref().is_some_and(|p| p.chars().count() < 8 || p.len() > 256) {
        return Err(ApiError::Invalid("a passphrase has 8 to 256 characters".into()));
    }
    state.set_key_passphrase(body.passphrase).await?;
    Ok(Json(KeyStorage { protection: state.key_protection() }))
}

/// Answers from the first moment, so Electron can tell a slow start (keyring prompt) from a dead daemon.
async fn health(State(state): State<AppState>) -> Json<Health> {
    if state.is_starting() {
        return Json(Health { status: "starting", locked: false, passphrase: false });
    }
    Json(Health { status: "ok", locked: state.is_locked(), passphrase: state.needs_passphrase() })
}

/// Main calls this before the renderer loads; the bridge refuses it from the renderer.
async fn set_network(State(state): State<AppState>, JsonBody(body): JsonBody<NetworkSettings>) -> Result<StatusCode, ApiError> {
    let proxy = body.proxy_url.as_deref().map(parse_proxy).transpose().map_err(ApiError::Invalid)?;
    state.set_proxy(proxy);
    Ok(StatusCode::NO_CONTENT)
}

async fn read_deps(State(state): State<AppState>) -> Json<Deps> {
    let mut deps = deps::current(&state).await;
    deps.download = state.tool_download.read().expect("tool download lock").clone();
    Json(deps)
}

/// "Check again" after the user installed a tool.
async fn recheck_deps(State(state): State<AppState>) -> Json<Deps> {
    Json(deps::recheck(&state).await)
}

/// Works locked and while starting: it needs no library. Concurrent POSTs share one run.
async fn network_check(State(state): State<AppState>) -> Json<NetCheck> {
    let arrived = std::time::Instant::now();
    let mut finished = state.net_lock.lock().await;
    // A run that finished while this caller waited is fresh enough: share it.
    if finished.is_some_and(|at| at > arrived)
        && let Some(shared) = state.last_network_check.read().expect("network check lock").clone()
    {
        return Json(shared);
    }
    let proxy = state.proxy();
    let (deps, mut result) = tokio::join!(deps::current(&state), netcheck::run(&state.net_setup, proxy.as_ref(), state.proxy_hook(), now_ms()));
    result.rows.extend(netcheck::tool_rows(&deps));
    *state.last_network_check.write().expect("network check lock") = Some(result.clone());
    *finished = Some(std::time::Instant::now());
    Json(result)
}

/// Never runs a check or touches the network: it reports what the daemon already knows.
async fn report(State(state): State<AppState>) -> Result<Json<DaemonReport>, ApiError> {
    let home = state.env.home.as_ref().map(|h| h.to_string_lossy().into_owned());
    let hide = |text: &str| redact(text, home.as_deref(), &state.token);
    let mut deps = state.deps.read().expect("deps lock").clone();
    for tool in deps.iter_mut().flat_map(|d| d.tools.iter_mut()) {
        tool.path = tool.path.as_deref().map(hide);
    }
    let (mut schema_version, mut db_bytes, mut cache) = (None, None, None);
    if let Ok(data) = state.data() {
        schema_version = Some(data.db.call(|c| Ok(c.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))?)).await?);
        let mut wal = state.paths.db.clone().into_os_string();
        wal.push("-wal");
        let size = |p: &std::path::Path| std::fs::metadata(p).map_or(0, |m| m.len());
        db_bytes = Some(size(&state.paths.db) + size(std::path::Path::new(&wal)));
        cache = Some(cache_status(&data).await?);
    }
    Ok(Json(DaemonReport {
        version: env!("CARGO_PKG_VERSION"),
        uptime_secs: state.started.elapsed().as_secs(),
        phase: if state.is_starting() { "starting" } else { "ok" },
        locked: !state.is_starting() && state.is_locked(),
        schema_version,
        db_bytes,
        cache,
        deps,
        network_check: state.last_network_check.read().expect("network check lock").clone().map(|mut check| {
            check.summary = hide(&check.summary);
            for row in &mut check.rows {
                row.host = row.host.as_deref().map(hide);
                row.detail = row.detail.as_deref().map(hide);
            }
            check
        }),
        log: hide(&log_tail(&state.paths.log)),
    }))
}

async fn shutdown(State(state): State<AppState>) -> StatusCode {
    state.shutdown.notify_one();
    StatusCode::NO_CONTENT
}
