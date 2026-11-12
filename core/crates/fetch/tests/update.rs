use std::os::unix::fs::PermissionsExt;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};

use axum::Router;
use axum::extract::State;
use axum::routing::get;
use nuvo_fetch::update::{Outcome, UpdateError, asset_for, checksum_of, update_yt_dlp};
use sha2::{Digest, Sha256};

const ASSET: &str = "yt-dlp_linux";
const GOOD: &str = "#!/bin/sh\necho 2026.11.01\n";
const NEWER: &str = "#!/bin/sh\necho 2026.11.07\n";
const BROKEN: &str = "#!/bin/sh\nexit 3\n";

#[derive(Clone)]
struct Release {
    binary: &'static str,
    listed: String,
    downloads: Arc<AtomicUsize>,
}

fn sha(text: &str) -> String {
    Sha256::digest(text.as_bytes()).iter().map(|b| format!("{b:02x}")).collect()
}

async fn serve(binary: &'static str, listed: String) -> (String, Arc<AtomicUsize>) {
    let downloads = Arc::new(AtomicUsize::new(0));
    let state = Release { binary, listed, downloads: downloads.clone() };
    let app = Router::new()
        .route("/SHA2-256SUMS", get(|State(r): State<Release>| async move { format!("{}  {ASSET}\nabc  other\n", r.listed) }))
        .route(
            "/yt-dlp_linux",
            get(|State(r): State<Release>| async move {
                r.downloads.fetch_add(1, Ordering::SeqCst);
                r.binary
            }),
        )
        .with_state(state);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    (url, downloads)
}

async fn run(url: &str, dir: &std::path::Path) -> Result<Outcome, UpdateError> {
    update_yt_dlp(&reqwest::Client::new(), url, ASSET, dir, &|_, _| ()).await
}

#[tokio::test]
async fn first_run_installs_a_verified_executable_and_reports_progress() {
    let dir = tempfile::tempdir().unwrap();
    let (url, _) = serve(GOOD, sha(GOOD)).await;
    let seen = AtomicU64::new(0);
    let outcome = update_yt_dlp(&reqwest::Client::new(), &url, ASSET, dir.path(), &|received, total| {
        assert_eq!(total, Some(GOOD.len() as u64));
        seen.store(received, Ordering::SeqCst);
    })
    .await
    .unwrap();
    assert_eq!(outcome, Outcome::Installed);
    assert_eq!(seen.load(Ordering::SeqCst), GOOD.len() as u64);
    let file = dir.path().join("yt-dlp");
    assert_eq!(std::fs::read_to_string(&file).unwrap(), GOOD);
    assert_eq!(file.metadata().unwrap().permissions().mode() & 0o777, 0o755);
}

#[tokio::test]
async fn the_same_build_is_not_downloaded_again() {
    let dir = tempfile::tempdir().unwrap();
    let (url, downloads) = serve(GOOD, sha(GOOD)).await;
    run(&url, dir.path()).await.unwrap();
    assert_eq!(run(&url, dir.path()).await.unwrap(), Outcome::UpToDate);
    assert_eq!(downloads.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn a_new_release_replaces_the_old_build() {
    let dir = tempfile::tempdir().unwrap();
    let (url, _) = serve(GOOD, sha(GOOD)).await;
    run(&url, dir.path()).await.unwrap();
    let (url, _) = serve(NEWER, sha(NEWER)).await;
    assert_eq!(run(&url, dir.path()).await.unwrap(), Outcome::Installed);
    assert_eq!(std::fs::read_to_string(dir.path().join("yt-dlp")).unwrap(), NEWER);
}

#[tokio::test]
async fn a_wrong_checksum_keeps_the_last_good_build_and_leaves_nothing_behind() {
    let dir = tempfile::tempdir().unwrap();
    let (url, _) = serve(GOOD, sha(GOOD)).await;
    run(&url, dir.path()).await.unwrap();
    let (url, _) = serve(NEWER, sha("something else")).await;
    assert!(matches!(run(&url, dir.path()).await, Err(UpdateError::Checksum)));
    assert_eq!(std::fs::read_to_string(dir.path().join("yt-dlp")).unwrap(), GOOD);
    assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
}

#[tokio::test]
async fn a_build_that_does_not_run_is_never_installed() {
    let dir = tempfile::tempdir().unwrap();
    let (url, _) = serve(BROKEN, sha(BROKEN)).await;
    assert!(matches!(run(&url, dir.path()).await, Err(UpdateError::Broken)));
    assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 0);
}

#[tokio::test]
async fn an_unreachable_release_is_an_error_not_a_panic() {
    let dir = tempfile::tempdir().unwrap();
    assert!(matches!(run("http://127.0.0.1:1", dir.path()).await, Err(UpdateError::Network(_))));
}

#[test]
fn checksums_and_assets() {
    let hash = "a".repeat(64);
    assert_eq!(checksum_of(&format!("{hash}  yt-dlp_linux\n"), "yt-dlp_linux"), Some(hash.clone()));
    assert_eq!(checksum_of(&format!("{hash} *yt-dlp_linux\n"), "yt-dlp_linux"), Some(hash.clone()));
    assert_eq!(checksum_of(&format!("{hash}  yt-dlp_linux_aarch64\n"), "yt-dlp_linux"), None);
    assert_eq!(checksum_of("short  yt-dlp_linux\n", "yt-dlp_linux"), None);
    assert_eq!(asset_for("linux", "x86_64"), Some("yt-dlp_linux"));
    assert_eq!(asset_for("linux", "riscv64"), None);
}

mod archives {
    use std::os::unix::fs::PermissionsExt;
    use std::path::Path;

    use axum::Router;
    use axum::routing::get;
    use nuvo_fetch::update::{Archive, Outcome, UpdateError, install_archive};
    use sha2::{Digest, Sha256};

    fn tar_xz(dir: &Path, script: &str) -> Vec<u8> {
        let root = dir.join("src");
        std::fs::create_dir_all(root.join("ffmpeg-7.0.2-test")).unwrap();
        let file = root.join("ffmpeg-7.0.2-test/ffmpeg");
        std::fs::write(&file, script).unwrap();
        std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o644)).unwrap();
        let out = dir.join("a.tar.xz");
        assert!(std::process::Command::new("tar").arg("-cJf").arg(&out).arg("-C").arg(&root).arg("ffmpeg-7.0.2-test").status().unwrap().success());
        std::fs::read(out).unwrap()
    }

    async fn serve(name: &'static str, bytes: Vec<u8>) -> String {
        let app = Router::new().route(&format!("/{name}"), get(move || async move { bytes.clone() }));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/{name}", listener.local_addr().unwrap());
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        url
    }

    fn sha(bytes: &[u8]) -> String {
        Sha256::digest(bytes).iter().map(|b| format!("{b:02x}")).collect()
    }

    async fn install(name: &str, url: &str, sha: &str, member: &'static str, dir: &Path, force: bool) -> Result<Outcome, UpdateError> {
        let build = Archive { url: Box::leak(url.to_string().into_boxed_str()), sha256: Box::leak(sha.to_string().into_boxed_str()), member };
        install_archive(&reqwest::Client::new(), &build, name, dir, force, &|_, _| ()).await
    }

    #[tokio::test]
    async fn a_verified_archive_gives_one_runnable_ffmpeg_and_nothing_else() {
        let work = tempfile::tempdir().unwrap();
        let bytes = tar_xz(work.path(), "#!/bin/sh\necho ffmpeg version 7.0.2\n");
        let url = serve("a.tar.xz", bytes.clone()).await;
        let dir = tempfile::tempdir().unwrap();
        let member = "ffmpeg-7.0.2-test/ffmpeg";
        assert_eq!(install("ffmpeg", &url, &sha(&bytes), member, dir.path(), false).await.unwrap(), Outcome::Installed);
        assert_eq!(dir.path().join("ffmpeg").metadata().unwrap().permissions().mode() & 0o777, 0o755);
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
        assert_eq!(install("ffmpeg", &url, &sha(&bytes), member, dir.path(), false).await.unwrap(), Outcome::UpToDate);
        assert_eq!(install("ffmpeg", &url, &sha(&bytes), member, dir.path(), true).await.unwrap(), Outcome::Installed, "download again replaces a working copy");
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
    }

    #[tokio::test]
    async fn a_zip_gives_a_runnable_deno() {
        let bytes = include_bytes!("fixtures/tools.zip").to_vec();
        let url = serve("deno.zip", bytes.clone()).await;
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(install("deno", &url, &sha(&bytes), "pkg/bin/deno", dir.path(), false).await.unwrap(), Outcome::Installed);
        assert_eq!(nuvo_fetch::tools::version(&dir.path().join("deno")).await.as_deref(), Some("2.9.8"));
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
        assert!(matches!(install("node", &url, &sha(&bytes), "pkg/bin/node", dir.path(), false).await, Err(UpdateError::Broken)), "a member the archive lacks");
    }

    #[tokio::test]
    async fn an_archive_with_the_wrong_hash_is_refused_and_removed() {
        let work = tempfile::tempdir().unwrap();
        let bytes = tar_xz(work.path(), "#!/bin/sh\necho ffmpeg version 7.0.2\n");
        let url = serve("a.tar.xz", bytes).await;
        let dir = tempfile::tempdir().unwrap();
        assert!(matches!(install("ffmpeg", &url, &"0".repeat(64), "ffmpeg-7.0.2-test/ffmpeg", dir.path(), false).await, Err(UpdateError::Checksum)));
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 0);
    }

    #[tokio::test]
    async fn a_build_that_does_not_run_is_never_installed() {
        let work = tempfile::tempdir().unwrap();
        let bytes = tar_xz(work.path(), "#!/bin/sh\nexit 3\n");
        let url = serve("a.tar.xz", bytes.clone()).await;
        let dir = tempfile::tempdir().unwrap();
        assert!(matches!(install("ffmpeg", &url, &sha(&bytes), "ffmpeg-7.0.2-test/ffmpeg", dir.path(), false).await, Err(UpdateError::Broken)));
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 0);
    }

    #[tokio::test]
    async fn offline_keeps_the_partial_download_for_the_next_try() {
        let dir = tempfile::tempdir().unwrap();
        let partial = dir.path().join(".deno.partial.zip");
        std::fs::write(&partial, b"first half").unwrap();
        let result = install("deno", "http://127.0.0.1:1/deno.zip", &"0".repeat(64), "deno", dir.path(), false).await;
        assert!(matches!(result, Err(UpdateError::Network(_))));
        assert_eq!(std::fs::read(&partial).unwrap(), b"first half");
    }
}

mod resume {
    use std::sync::{Arc, Mutex};

    use axum::Router;
    use axum::http::{HeaderMap, StatusCode, header};
    use axum::response::IntoResponse;
    use axum::routing::get;
    use nuvo_fetch::update::{Outcome, update_yt_dlp};
    use sha2::{Digest, Sha256};

    const BUILD: &str = "#!/bin/sh\necho 2026.11.07\n";

    // Answers `Range: bytes=N-` with 206 like GitHub's asset storage, or refuses it with 416
    async fn serve(refuse: bool) -> (String, Arc<Mutex<Vec<String>>>) {
        let ranges = Arc::new(Mutex::new(Vec::new()));
        let seen = ranges.clone();
        let sum = Sha256::digest(BUILD.as_bytes()).iter().map(|b| format!("{b:02x}")).collect::<String>();
        let app = Router::new().route("/SHA2-256SUMS", get(move || async move { format!("{sum}  yt-dlp_linux\n") })).route(
            "/yt-dlp_linux",
            get(move |headers: HeaderMap| async move {
                let range = headers.get(header::RANGE).and_then(|v| v.to_str().ok()).map(String::from);
                seen.lock().unwrap().push(range.clone().unwrap_or_default());
                match range.and_then(|r| r.strip_prefix("bytes=")?.strip_suffix('-')?.parse::<usize>().ok()) {
                    Some(_) if refuse => StatusCode::RANGE_NOT_SATISFIABLE.into_response(),
                    Some(from) => (StatusCode::PARTIAL_CONTENT, [(header::CONTENT_RANGE, format!("bytes {from}-{}/{}", BUILD.len() - 1, BUILD.len()))], &BUILD[from..]).into_response(),
                    None => BUILD.into_response(),
                }
            }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        (url, ranges)
    }

    #[tokio::test]
    async fn a_broken_download_continues_where_it_stopped() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join(".yt-dlp.partial"), &BUILD[..10]).unwrap();
        let (url, ranges) = serve(false).await;
        let progress = Mutex::new(Vec::new());
        let outcome = update_yt_dlp(&reqwest::Client::new(), &url, "yt-dlp_linux", dir.path(), &|received, total| progress.lock().unwrap().push((received, total))).await;
        assert_eq!(outcome.unwrap(), Outcome::Installed);
        assert_eq!(ranges.lock().unwrap().as_slice(), ["bytes=10-"]);
        assert_eq!(progress.lock().unwrap().first(), Some(&(10, Some(BUILD.len() as u64))));
        assert_eq!(std::fs::read_to_string(dir.path().join("yt-dlp")).unwrap(), BUILD);
    }

    #[tokio::test]
    async fn a_refused_range_starts_over_on_the_next_try() {
        let dir = tempfile::tempdir().unwrap();
        let partial = dir.path().join(".yt-dlp.partial");
        std::fs::write(&partial, &BUILD[..10]).unwrap();
        let (url, ranges) = serve(true).await;
        let client = reqwest::Client::new();
        let run = || update_yt_dlp(&client, &url, "yt-dlp_linux", dir.path(), &|_, _| ());
        assert!(run().await.is_err());
        assert!(!partial.exists());
        assert_eq!(run().await.unwrap(), Outcome::Installed);
        assert_eq!(ranges.lock().unwrap().as_slice(), ["bytes=10-", ""]);
    }
}
