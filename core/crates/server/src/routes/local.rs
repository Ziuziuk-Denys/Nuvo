//! `/v1/local/*` for the renderer and `/v1/fs/local/*` for Electron main (the bridge refuses
//! `fs` paths, so only native dialogs choose folders).

use std::io::SeekFrom;
use std::path::{Path as FsPath, PathBuf};

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::routing::{delete, get, post};
use axum::body::{Body, Bytes};
use axum::http::{HeaderMap, HeaderValue, header};
use axum::response::{IntoResponse, Response};
use axum::{Json, Router};
use nuvo_contracts::{AddLocalRoot, Items, LocalRelated, LocalRoot, LocalScanStatus, LocalStyle, LocalTracksPage};
use nuvo_store::{local, now_ms};
use nuvo_covers::picture::Processed;
use serde::Deserialize;
use tokio::io::{AsyncReadExt, AsyncSeekExt};

use crate::error::ApiError;
use crate::extract::JsonBody;
use crate::local::{Msg, poke};
use crate::routes::cache::{Unsatisfiable, parse_range};
use crate::state::AppState;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/v1/fs/local/roots", post(add_root))
        .route("/v1/local/roots", get(list_roots))
        .route("/v1/local/roots/{id}", delete(remove_root))
        .route("/v1/local/rescan", post(rescan))
        .route("/v1/local/status", get(status))
        .route("/v1/local/tracks", get(tracks))
        .route("/v1/local/related", get(related))
        .route("/v1/local/style", get(style))
        .route("/v1/local/tracks/{id}/audio", get(audio))
        .route("/v1/local/tracks/{id}/cover", get(cover))
        .route("/v1/fs/local/tracks/{id}/path", get(file_path))
}

/// System folders are never music folders.
const SYSTEM_DIRS: [&str; 12] = ["/proc", "/sys", "/dev", "/run", "/boot", "/etc", "/usr", "/bin", "/sbin", "/lib", "/lib64", "/var/lib"];

/// Why `path` (canonical) cannot be a music folder; `own` are Nuvo's data and cache folders. A
/// folder that holds them is refused too: a scan would read the library and cache files.
pub fn refused_folder(path: &FsPath, own: &[&FsPath]) -> Option<&'static str> {
    if own.iter().filter(|dir| !dir.as_os_str().is_empty()).any(|dir| dir.starts_with(path)) {
        return Some("a folder that holds Nuvo's own data cannot be a music folder");
    }
    refused_target(path, own)
}

/// Why `path` (canonical) cannot receive saved files: the disk root, system folders, Nuvo's own data.
pub fn refused_target(path: &FsPath, own: &[&FsPath]) -> Option<&'static str> {
    if path == FsPath::new("/") {
        return Some("the whole disk cannot be a music folder");
    }
    if SYSTEM_DIRS.iter().any(|dir| path.starts_with(dir)) {
        return Some("system folders cannot be music folders");
    }
    if own.iter().filter(|dir| !dir.as_os_str().is_empty()).any(|dir| path.starts_with(dir)) {
        return Some("Nuvo's own data cannot be a music folder");
    }
    None
}

async fn add_root(State(state): State<AppState>, JsonBody(body): JsonBody<AddLocalRoot>) -> Result<(StatusCode, Json<LocalRoot>), ApiError> {
    let data = state.data()?;
    let raw = PathBuf::from(&body.path);
    if !raw.is_absolute() {
        return Err(ApiError::Invalid("path must be absolute".into()));
    }
    let path = tokio::fs::canonicalize(&raw).await.map_err(|_| ApiError::NotFound("the folder is gone".into()))?;
    if !tokio::fs::metadata(&path).await.is_ok_and(|m| m.is_dir()) {
        return Err(ApiError::Invalid("pick a folder, not a file".into()));
    }
    let data_dir = canonical_or_same(state.paths.db.parent()).await;
    let cache_dir = canonical_or_same(state.paths.audio.parent()).await;
    if let Some(why) = refused_folder(&path, &[&data_dir, &cache_dir]) {
        return Err(ApiError::Invalid(why.into()));
    }
    let text = path.to_str().ok_or_else(|| ApiError::Invalid("the folder name is not valid UTF-8".into()))?.to_string();
    let root = data.db.call(move |c| local::add_root(c, &text, now_ms())).await?;
    poke(&state, Msg::Root(root.id));
    Ok((StatusCode::ACCEPTED, Json(root)))
}

pub(crate) async fn canonical_or_same(dir: Option<&FsPath>) -> PathBuf {
    let dir = dir.map(FsPath::to_path_buf).unwrap_or_default();
    tokio::fs::canonicalize(&dir).await.unwrap_or(dir)
}

async fn list_roots(State(state): State<AppState>) -> Result<Json<Items<LocalRoot>>, ApiError> {
    let data = state.data()?;
    Ok(Json(Items { items: data.db.call(local::roots).await? }))
}

async fn remove_root(State(state): State<AppState>, Path(id): Path<i64>) -> Result<StatusCode, ApiError> {
    let data = state.data()?;
    data.db.call(move |c| local::remove_root(c, id)).await?;
    poke(&state, Msg::Root(id));
    Ok(StatusCode::NO_CONTENT)
}

async fn rescan(State(state): State<AppState>) -> Result<StatusCode, ApiError> {
    state.data()?;
    poke(&state, Msg::All);
    Ok(StatusCode::ACCEPTED)
}

async fn status(State(state): State<AppState>) -> Result<Json<LocalScanStatus>, ApiError> {
    state.data()?;
    Ok(Json(state.local.status()))
}

#[derive(Deserialize)]
struct TracksQuery {
    q: Option<String>,
    cursor: Option<String>,
    limit: Option<usize>,
}

async fn tracks(State(state): State<AppState>, Query(q): Query<TracksQuery>) -> Result<Json<LocalTracksPage>, ApiError> {
    let data = state.data()?;
    Ok(Json(data.db.call(move |c| local::list(c, q.q.as_deref(), q.cursor.as_deref(), q.limit.unwrap_or(100))).await?))
}

#[derive(Deserialize)]
struct RelatedQuery {
    seed: String,
    limit: Option<usize>,
}

async fn related(State(state): State<AppState>, Query(q): Query<RelatedQuery>) -> Result<Json<LocalRelated>, ApiError> {
    let data = state.data()?;
    Ok(Json(data.db.call(move |c| local::related(c, &q.seed, q.limit.unwrap_or(20))).await?))
}

#[derive(Deserialize)]
struct StyleQuery {
    limit: Option<usize>,
}

async fn style(State(state): State<AppState>, Query(q): Query<StyleQuery>) -> Result<Json<LocalStyle>, ApiError> {
    let data = state.data()?;
    Ok(Json(data.db.call(move |c| local::style(c, q.limit.unwrap_or(20))).await?))
}

const CHUNK: u64 = 64 * 1024;

pub(crate) struct Opened {
    pub file: tokio::fs::File,
    pub size: u64,
    pub path: PathBuf,
}

/// Opens a scanned file only while it is still a regular file at its scanned place inside its
/// music folder: not a link, no parent swapped for a link, the same inode that was checked.
pub(crate) async fn open_inside(path: &str, root: &str) -> Result<Opened, ApiError> {
    let gone = || ApiError::NotFound("the file is gone".into());
    let (checked, checked_root) = (PathBuf::from(path), PathBuf::from(root));
    let file = tokio::task::spawn_blocking(move || nuvo_local::open::open_inside(&checked, &checked_root)).await.map_err(|_| gone())?.map_err(|_| gone())?;
    let size = file.metadata().map_err(|_| gone())?.len();
    Ok(Opened { file: tokio::fs::File::from_std(file), size, path: PathBuf::from(path) })
}

fn file_body(file: tokio::fs::File, len: u64) -> Body {
    let chunks = futures::stream::unfold((file, len), |(mut file, left)| async move {
        if left == 0 {
            return None;
        }
        let mut buf = vec![0u8; left.min(CHUNK) as usize];
        match file.read(&mut buf).await {
            Ok(0) => None,
            Ok(n) => {
                buf.truncate(n);
                Some((Ok::<_, std::io::Error>(Bytes::from(buf)), (file, left - n as u64)))
            }
            Err(err) => Some((Err(err), (file, 0))),
        }
    });
    Body::from_stream(chunks)
}

async fn found(state: &AppState, id: String) -> Result<local::LocalFile, ApiError> {
    let data = state.data()?;
    data.db.call(move |c| local::file_for(c, &id)).await?.ok_or_else(|| ApiError::NotFound("no local file for this track".into()))
}

async fn audio(State(state): State<AppState>, Path(id): Path<String>, headers: HeaderMap) -> Result<Response, ApiError> {
    let local = found(&state, id).await?;
    if let Some(reason) = local.row.unsupported.clone() {
        return Err(ApiError::Unsupported(reason));
    }
    let Opened { mut file, size, .. } = open_inside(&local.row.path, &local.root_path).await?;
    if size == 0 {
        return Err(ApiError::NotFound("the file is empty".into()));
    }
    let range = headers.get(header::RANGE).and_then(|v| v.to_str().ok()).map_or(Ok(None), |v| parse_range(v, size));
    let (status, start, end) = match range {
        Ok(None) => (StatusCode::OK, 0, size - 1),
        Ok(Some((start, end))) => (StatusCode::PARTIAL_CONTENT, start, end),
        Err(Unsatisfiable) => {
            let content_range = HeaderValue::from_str(&format!("bytes */{size}")).expect("ascii header");
            return Ok((StatusCode::RANGE_NOT_SATISFIABLE, [(header::CONTENT_RANGE, content_range)]).into_response());
        }
    };
    file.seek(SeekFrom::Start(start)).await.map_err(|e| ApiError::Internal(e.to_string()))?;
    let len = end - start + 1;
    let mut response = Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, local.row.mime)
        .header(header::ACCEPT_RANGES, "bytes")
        .header(header::CONTENT_LENGTH, len)
        // Chromium would otherwise keep whole FLAC files in its HTTP cache
        .header(header::CACHE_CONTROL, "no-store")
        .header("x-nuvo-codec", local.row.codec);
    if status == StatusCode::PARTIAL_CONTENT {
        response = response.header(header::CONTENT_RANGE, format!("bytes {start}-{end}/{size}"));
    }
    if let Some(kbps) = local.row.bitrate_kbps {
        response = response.header("x-nuvo-bitrate", kbps);
    }
    response.body(file_body(file, len)).map_err(|e| ApiError::Internal(e.to_string()))
}

#[derive(Deserialize)]
struct SizeQuery {
    size: Option<String>,
}

async fn cover(State(state): State<AppState>, Path(id): Path<String>, Query(q): Query<SizeQuery>, headers: HeaderMap) -> Result<Response, ApiError> {
    let bucket = nuvo_covers::source::bucket(q.size.as_deref()).ok_or_else(|| ApiError::Invalid("size must be a number".into()))?;
    local_cover(&state, id, bucket, &headers).await
}

/// A local file's cover at a display bucket: embedded, else the folder's image.
pub(crate) async fn local_cover(state: &AppState, id: String, bucket: u32, headers: &HeaderMap) -> Result<Response, ApiError> {
    let local = found(state, id.clone()).await?;
    let opened = open_inside(&local.row.path, &local.root_path).await?;
    let etag = format!("\"lc-{}-{}-{}-{bucket}\"", &nuvo_crypto::sha256_hex(id.as_bytes())[..12], local.row.size_bytes, local.row.mtime_ms);
    if headers.get(header::IF_NONE_MATCH).and_then(|v| v.to_str().ok()) == Some(etag.as_str()) {
        return Ok((StatusCode::NOT_MODIFIED, [(header::ETAG, etag)]).into_response());
    }
    // the checked file itself is read, not its name again
    let dir = opened.path.parent().map(PathBuf::from).unwrap_or_default();
    let file = opened.file.into_std().await;
    let picture = tokio::task::spawn_blocking(move || -> Result<Option<Processed>, ApiError> {
        let Ok(Some(bytes)) = nuvo_local::tags::read_cover_from(file, &dir) else { return Ok(None) };
        Ok(Some(nuvo_covers::picture::process(bytes, bucket, false)?))
    })
    .await
    .map_err(|e| ApiError::Internal(e.to_string()))??
    .ok_or_else(|| ApiError::NotFound("this file has no cover".into()))?;
    Response::builder()
        .header(header::CONTENT_TYPE, picture.content_type)
        .header(header::CONTENT_LENGTH, picture.bytes.len())
        .header(header::ETAG, etag)
        .header(header::CACHE_CONTROL, "private, max-age=86400")
        .body(Body::from(picture.bytes))
        .map_err(|e| ApiError::Internal(e.to_string()))
}

#[derive(serde::Serialize)]
struct FilePath {
    path: String,
}

/// Main only: where a local track lives, to show it in the file manager.
async fn file_path(State(state): State<AppState>, Path(id): Path<String>) -> Result<Json<FilePath>, ApiError> {
    let local = found(&state, id).await?;
    let opened = open_inside(&local.row.path, &local.root_path).await?;
    Ok(Json(FilePath { path: opened.path.to_string_lossy().into_owned() }))
}
