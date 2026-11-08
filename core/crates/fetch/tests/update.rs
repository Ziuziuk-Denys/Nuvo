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

mod ffmpeg {
    use std::os::unix::fs::PermissionsExt;
    use std::path::Path;

    use axum::Router;
    use axum::routing::get;
    use nuvo_fetch::update::{FfmpegBuild, Outcome, UpdateError, ffmpeg_build_for, install_ffmpeg};
    use sha2::{Digest, Sha256};

    /// A tar.xz holding `ffmpeg-7.0.2-test/ffmpeg`, the way the pinned archives are laid out.
    fn archive(dir: &Path, script: &str) -> Vec<u8> {
        let root = dir.join("src");
        std::fs::create_dir_all(root.join("ffmpeg-7.0.2-test")).unwrap();
        let file = root.join("ffmpeg-7.0.2-test/ffmpeg");
        std::fs::write(&file, script).unwrap();
        std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o644)).unwrap();
        let out = dir.join("a.tar.xz");
        assert!(std::process::Command::new("tar").arg("-cJf").arg(&out).arg("-C").arg(&root).arg("ffmpeg-7.0.2-test").status().unwrap().success());
        std::fs::read(out).unwrap()
    }

    async fn serve(bytes: Vec<u8>) -> String {
        let app = Router::new().route("/a.tar.xz", get(move || async move { bytes.clone() }));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/a.tar.xz", listener.local_addr().unwrap());
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        url
    }

    fn pinned(url: String, bytes: &[u8]) -> (String, String) {
        (url, Sha256::digest(bytes).iter().map(|b| format!("{b:02x}")).collect())
    }

    async fn install(url: &str, sha: &str, dir: &Path) -> Result<Outcome, UpdateError> {
        let build = FfmpegBuild { url: Box::leak(url.to_string().into_boxed_str()), sha256: Box::leak(sha.to_string().into_boxed_str()), folder: "ffmpeg-7.0.2-test" };
        install_ffmpeg(&reqwest::Client::new(), &build, dir, &|_, _| ()).await
    }

    #[tokio::test]
    async fn a_verified_archive_gives_one_runnable_ffmpeg_and_nothing_else() {
        let work = tempfile::tempdir().unwrap();
        let bytes = archive(work.path(), "#!/bin/sh\necho ffmpeg version 7.0.2\n");
        let (url, sha) = pinned(serve(bytes.clone()).await, &bytes);
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(install(&url, &sha, dir.path()).await.unwrap(), Outcome::Installed);
        assert_eq!(dir.path().join("ffmpeg").metadata().unwrap().permissions().mode() & 0o777, 0o755);
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
        assert_eq!(install(&url, &sha, dir.path()).await.unwrap(), Outcome::UpToDate);
    }

    #[tokio::test]
    async fn an_archive_with_the_wrong_hash_is_refused_and_removed() {
        let work = tempfile::tempdir().unwrap();
        let bytes = archive(work.path(), "#!/bin/sh\necho ffmpeg version 7.0.2\n");
        let url = serve(bytes).await;
        let dir = tempfile::tempdir().unwrap();
        assert!(matches!(install(&url, &"0".repeat(64), dir.path()).await, Err(UpdateError::Checksum)));
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 0);
    }

    #[tokio::test]
    async fn a_build_that_does_not_run_is_never_installed() {
        let work = tempfile::tempdir().unwrap();
        let bytes = archive(work.path(), "#!/bin/sh\nexit 3\n");
        let (url, sha) = pinned(serve(bytes.clone()).await, &bytes);
        let dir = tempfile::tempdir().unwrap();
        assert!(matches!(install(&url, &sha, dir.path()).await, Err(UpdateError::Broken)));
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 0);
    }

    #[test]
    fn linux_has_pinned_builds_and_other_systems_none() {
        assert!(ffmpeg_build_for("linux", "x86_64").is_some_and(|b| b.sha256.len() == 64 && b.url.starts_with("https://")));
        assert!(ffmpeg_build_for("linux", "aarch64").is_some());
        assert!(ffmpeg_build_for("macos", "aarch64").is_none());
    }
}
