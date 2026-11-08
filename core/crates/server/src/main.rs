use std::process::ExitCode;

use nuvo_crypto::{FallbackKeyStore, FileKeyStore, KeyringStore};
use nuvo_fetch::tools::ToolEnv;
use nuvo_fetch::update::RELEASE_URL;
use nuvo_lastfm::LASTFM_URL;
use nuvo_lyrics::{AMLL_URL, LRCLIB_URL};
use nuvo_recognize::{Pace, SHAZAM_URL};
use nuvo_server::paths::Paths;
use nuvo_server::{Config, logging, run};

#[tokio::main]
async fn main() -> ExitCode {
    let env = |key: &str| std::env::var(key).ok().filter(|v| !v.is_empty());
    let paths = match Paths::from_env(env) {
        Ok(paths) => paths,
        Err(err) => {
            eprintln!("nuvo-core: {err}");
            return ExitCode::from(2);
        }
    };
    if let Err(err) = logging::init(&paths.log) {
        eprintln!("nuvo-core: cannot open log {}: {err}", paths.log.display());
    }
    let Some(token) = env("NUVO_CORE_TOKEN").filter(|t| t.len() >= 32) else {
        eprintln!("nuvo-core: NUVO_CORE_TOKEN with at least 32 characters is required");
        return ExitCode::from(2);
    };
    let managed = paths.tools.clone();
    let key_file = paths.db.with_file_name("master.key");
    // Empty turns the update off; e2e runs must not reach for a real release.
    let tools_url = match env("NUVO_CORE_TOOLS_URL") {
        Some(url) if url.is_empty() => None,
        Some(url) => Some(url),
        None => Some(RELEASE_URL.into()),
    };
    let config = Config {
        paths,
        token,
        lrclib_url: env("NUVO_CORE_LRCLIB_URL").unwrap_or_else(|| LRCLIB_URL.into()),
        amll_url: env("NUVO_CORE_AMLL_URL").unwrap_or_else(|| AMLL_URL.into()),
        shazam_url: env("NUVO_CORE_SHAZAM_URL").unwrap_or_else(|| SHAZAM_URL.into()),
        lastfm_url: env("NUVO_CORE_LASTFM_URL").unwrap_or_else(|| LASTFM_URL.into()),
        pace: Pace::SHAZAM,
        exit_on_stdin_eof: env("NUVO_CORE_EXIT_ON_STDIN_EOF").is_some(),
        net_rewrite: None,
        env: ToolEnv { managed: Some(managed), ..ToolEnv::from_process() },
        tools_url,
        test: Default::default(),
    };
    // A separate service name keeps test runs away from the owner's real key.
    let keyring = KeyringStore::new(env("NUVO_CORE_KEYRING_SERVICE").unwrap_or_else(|| "nuvo-core".into()));
    let keystore = FallbackKeyStore::new(keyring, FileKeyStore::new(key_file));
    let code = match run(config, Box::new(keystore)).await {
        Ok(()) => 0,
        Err(err) => {
            tracing::error!(%err, "nuvo-core stopped");
            eprintln!("nuvo-core: {err}");
            1
        }
    };
    // Exit here: dropping the runtime would wait for a keyring call still blocked on a prompt.
    std::process::exit(code);
}
