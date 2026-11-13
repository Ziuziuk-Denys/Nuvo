use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

use axum::Router;
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode, header};
use axum::response::IntoResponse;
use axum::routing::get;
use nuvo_fetch::update::{Outcome, Pinned, TOOL_HOST_SUFFIX, TOOL_HOSTS, UpdateError, WHISPER_BASE, WHISPER_SMALL, install_pinned};
use sha2::{Digest, Sha256};

const BODY: &[u8] = b"a small stand-in for a speech model";

fn sha(bytes: &[u8]) -> String {
    Sha256::digest(bytes).iter().map(|b| format!("{b:02x}")).collect()
}

// Serves BODY and honours `Range: bytes=N-`, counting the requests
async fn serve() -> (String, Arc<AtomicUsize>) {
    let hits = Arc::new(AtomicUsize::new(0));
    let app = Router::new()
        .route(
            "/model.bin",
            get(|State(hits): State<Arc<AtomicUsize>>, headers: HeaderMap| async move {
                hits.fetch_add(1, Ordering::SeqCst);
                let from = headers.get(header::RANGE).and_then(|v| v.to_str().ok()?.strip_prefix("bytes=")?.trim_end_matches('-').parse::<usize>().ok());
                match from {
                    Some(from) => (StatusCode::PARTIAL_CONTENT, BODY[from..].to_vec()).into_response(),
                    None => BODY.to_vec().into_response(),
                }
            }),
        )
        .with_state(hits.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}/model.bin", listener.local_addr().unwrap());
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    (url, hits)
}

fn pinned(url: String, sha256: String) -> &'static Pinned {
    Box::leak(Box::new(Pinned { name: "test-model", url: url.leak(), sha256: sha256.leak(), bytes: BODY.len() as u64 }))
}

#[tokio::test]
async fn a_checked_download_is_installed_once() {
    let dir = tempfile::tempdir().unwrap();
    let (url, hits) = serve().await;
    let file = pinned(url, sha(BODY));
    let path = dir.path().join("models/model.bin");
    let client = reqwest::Client::new();
    assert_eq!(install_pinned(&client, file, &path, &|_, _| ()).await.unwrap(), Outcome::Installed);
    assert_eq!(std::fs::read(&path).unwrap(), BODY);
    assert_eq!(install_pinned(&client, file, &path, &|_, _| ()).await.unwrap(), Outcome::UpToDate);
    assert_eq!(hits.load(Ordering::SeqCst), 1);
    assert_eq!(std::fs::read_dir(dir.path().join("models")).unwrap().count(), 1, "no partial file is left");
}

#[tokio::test]
async fn a_partial_download_is_continued() {
    let dir = tempfile::tempdir().unwrap();
    let (url, _) = serve().await;
    let file = pinned(url, sha(BODY));
    std::fs::write(dir.path().join(".test-model.partial"), &BODY[..10]).unwrap();
    let path = dir.path().join("model.bin");
    install_pinned(&reqwest::Client::new(), file, &path, &|_, _| ()).await.unwrap();
    assert_eq!(std::fs::read(&path).unwrap(), BODY);
}

#[tokio::test]
async fn a_file_that_misses_its_hash_is_dropped() {
    let dir = tempfile::tempdir().unwrap();
    let (url, _) = serve().await;
    let file = pinned(url, sha(b"something else"));
    let path = dir.path().join("model.bin");
    let result = install_pinned(&reqwest::Client::new(), file, &path, &|_, _| ()).await;
    assert!(matches!(result, Err(UpdateError::Checksum)), "{result:?}");
    assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 0);
}

#[test]
fn the_models_are_pinned_on_allowed_hosts() {
    for model in [WHISPER_BASE, WHISPER_SMALL] {
        let host = model.url.strip_prefix("https://").and_then(|rest| rest.split('/').next()).unwrap();
        assert!(TOOL_HOSTS.contains(&host) || host.ends_with(TOOL_HOST_SUFFIX), "{host}");
        assert!(model.url.contains("/resolve/") && !model.url.contains("/main/"), "a fixed revision: {}", model.url);
        assert!(model.sha256.len() == 64 && model.sha256.bytes().all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase()));
    }
}
