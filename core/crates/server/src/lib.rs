pub mod auth;
pub mod deps;
pub mod downloads;
pub mod error;
pub mod extract;
pub mod links;
pub mod local;
pub mod logging;
pub mod netcheck;
pub mod precache;
pub mod report;
pub mod paths;
pub mod routes;
pub mod scrobbler;
pub mod socket;
pub mod state;
pub mod tool_update;

use axum::Router;
use axum::extract::DefaultBodyLimit;
use axum::middleware;
use nuvo_crypto::KeyStore;
use tokio::io::AsyncReadExt;

pub use state::{AppState, BootError, Config, TestHooks};

/// Bulk playlist imports send thousands of snapshots in one body.
const BODY_LIMIT_BYTES: usize = 16 * 1024 * 1024;

pub fn router(state: AppState) -> Router {
    Router::new()
        .merge(routes::system::routes())
        .merge(routes::recovery::routes())
        .merge(routes::library::routes())
        .merge(routes::playlists::routes())
        .merge(routes::playback::routes())
        .merge(routes::lyrics::routes())
        .merge(routes::translate::routes())
        .merge(routes::cache::routes())
        .merge(routes::recs::routes())
        .merge(routes::recognize::routes())
        .merge(routes::trims::routes())
        .merge(routes::lastfm::routes())
        .merge(routes::youtube::routes())
        .merge(routes::soundcloud::routes())
        .merge(routes::spotify::routes())
        .merge(routes::matching::routes())
        .merge(routes::covers::routes())
        .merge(routes::alternatives::routes())
        .merge(routes::search_history::routes())
        .merge(routes::shortcuts::routes())
        .merge(routes::links::routes())
        .merge(routes::flags::routes())
        .merge(routes::imports::routes())
        .merge(routes::appearance::routes())
        .merge(routes::local::routes())
        .merge(routes::export::routes())
        .merge(routes::stats::routes())
        .merge(routes::downloads::routes())
        .layer(DefaultBodyLimit::max(BODY_LIMIT_BYTES))
        .layer(middleware::from_fn_with_state(state.clone(), auth::require_token))
        .with_state(state)
}

pub async fn run(config: Config, keystore: Box<dyn KeyStore>) -> Result<(), BootError> {
    // Bind first: a second daemon must give up before it touches the database.
    let listener = socket::bind(&config.paths.socket).await?;
    let socket_path = config.paths.socket.clone();
    // Serve at once and boot behind it: an unlock prompt can hold the keyring for as long as the
    // user takes, and a silent socket would look like a dead daemon to Electron.
    let state = AppState::new(config, keystore);
    let boot = tokio::spawn({
        let state = state.clone();
        async move {
            let result = state.start().await;
            if result.is_ok() {
                // After `/health` says ok, in the background: tools are never on the start path.
                let state = state.clone();
                let updater = state.clone();
                routes::stats::spawn_warm_up(state.clone());
                tokio::spawn(async move { deps::refresh(&state).await });
                tool_update::spawn(updater);
            } else {
                state.shutdown.notify_one();
            }
            result
        }
    });
    scrobbler::spawn_timer(state.clone());
    tracing::info!("nuvo-core listening");
    axum::serve(listener, router(state.clone()))
        .with_graceful_shutdown(wait_for_exit(state))
        .await?;
    let _ = std::fs::remove_file(socket_path);
    // A boot still waiting on the keyring is abandoned; main exits without joining it.
    if boot.is_finished() {
        boot.await.map_err(std::io::Error::other)??;
    }
    Ok(())
}

/// Shutdown route, SIGTERM, Ctrl-C, or (when Electron spawned us) stdin closing because the
/// parent died. The stdin signal is what stops an orphaned daemon after an Electron crash.
async fn wait_for_exit(state: AppState) {
    #[cfg(unix)]
    let mut term = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()).expect("SIGTERM handler");
    // Windows has no SIGTERM; the console close event stands in.
    #[cfg(windows)]
    let mut term = tokio::signal::windows::ctrl_close().expect("close handler");
    let stdin_closed = async {
        if !state.exit_on_stdin_eof {
            return std::future::pending().await;
        }
        let mut stdin = tokio::io::stdin();
        let mut buf = [0u8; 64];
        while matches!(stdin.read(&mut buf).await, Ok(n) if n > 0) {}
    };
    tokio::select! {
        _ = state.shutdown.notified() => {}
        _ = term.recv() => {}
        _ = tokio::signal::ctrl_c() => {}
        _ = stdin_closed => {}
    }
    tracing::info!("nuvo-core shutting down");
}
