use std::path::Path as FsPath;

use axum::body::Bytes;
use axum::extract::rejection::BytesRejection;
use axum::extract::{Path, Query, State};
use axum::http::{StatusCode, header};
use axum::response::IntoResponse;
use axum::routing::{get, post};
use axum::{Json, Router};
use nuvo_contracts::{ImportBulk, ImportNext, ImportRow, ImportRowsPage, ImportSummary, ImportTarget, Items, RowCandidates, RowDecision, StartImport};
use nuvo_import::job::{self, Target};
use nuvo_import::{MAX_FILE_BYTES, SourceRow, parse_file};
use nuvo_store::{now_ms, settings};
use serde::Deserialize;
use serde_json::{Value, json};
use tokio::io::AsyncReadExt;

use crate::error::ApiError;
use crate::extract::{JsonBody, body_error};
use crate::state::AppState;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/v1/imports", get(list).post(start))
        .route("/v1/fs/imports", post(start_from_path))
        .route("/v1/imports/pending-track", get(pending_get).put(pending_put).delete(pending_clear))
        .route("/v1/imports/{id}", get(summary).delete(remove))
        .route("/v1/imports/{id}/next", post(next))
        .route("/v1/imports/{id}/rows", get(rows).post(append))
        .route("/v1/imports/{id}/rows/{row_id}", axum::routing::patch(decide))
        .route("/v1/imports/{id}/rows/{row_id}/candidates", post(candidates))
        .route("/v1/imports/{id}/bulk", post(bulk))
        .route("/v1/imports/{id}/report.csv", get(report_csv))
}

fn target(input: Option<ImportTarget>) -> Result<Option<Target>, ApiError> {
    let Some(input) = input else { return Ok(None) };
    match (input.kind.as_str(), input.id) {
        ("new", None) => Ok(Some(Target::New)),
        ("liked", None) => Ok(Some(Target::Liked)),
        ("playlist", Some(id)) => Ok(Some(Target::Playlist(id))),
        _ => Err(ApiError::Invalid("target is {kind: new}, {kind: liked} or {kind: playlist, id}".into())),
    }
}

// A path would let the daemon read any file, so only main's route takes one
async fn start(State(state): State<AppState>, body: Result<Bytes, BytesRejection>) -> Result<Json<Items<ImportSummary>>, ApiError> {
    let body = parse_start(body)?;
    if body.path.is_some() {
        return Err(ApiError::Invalid("send the file's text, not its path".into()));
    }
    begin(state, body).await
}

async fn start_from_path(State(state): State<AppState>, body: Result<Bytes, BytesRejection>) -> Result<Json<Items<ImportSummary>>, ApiError> {
    begin(state, parse_start(body)?).await
}

fn parse_start(body: Result<Bytes, BytesRejection>) -> Result<StartImport, ApiError> {
    serde_json::from_slice(&body.map_err(body_error)?).map_err(|e| ApiError::Invalid(e.to_string()))
}

async fn begin(state: AppState, body: StartImport) -> Result<Json<Items<ImportSummary>>, ApiError> {
    let data = state.data()?;
    let target = target(body.target)?;
    let imports = match (body.path, body.file, body.source, body.rows) {
        (Some(path), None, None, None) => {
            let path = FsPath::new(&path);
            if !path.is_absolute() {
                return Err(ApiError::Invalid("path must be absolute".into()));
            }
            let metadata = tokio::fs::metadata(path).await.map_err(|_| ApiError::NotFound("the file is gone".into()))?;
            if !metadata.is_file() {
                return Err(ApiError::Invalid("pick a file, not a folder".into()));
            }
            if metadata.len() > MAX_FILE_BYTES {
                return Err(ApiError::Invalid("the file is larger than 10 MB".into()));
            }
            let file = tokio::fs::File::open(path).await.map_err(|e| ApiError::Invalid(format!("the file cannot be read: {}", e.kind())))?;
            let mut bytes = Vec::new();
            file.take(MAX_FILE_BYTES).read_to_end(&mut bytes).await.map_err(|e| ApiError::Invalid(format!("the file cannot be read: {}", e.kind())))?;
            let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
            parse_file(&name, &bytes).map_err(|e| ApiError::Invalid(e.to_string()))?.into_iter().map(|p| (p, Vec::new())).collect::<Vec<_>>()
        }
        (None, Some(file), None, None) => {
            // The encoded text is checked first, so a huge string is never decoded.
            if file.data.len() as u64 / 4 * 3 > MAX_FILE_BYTES + 3 {
                return Err(ApiError::Invalid("the file is larger than 10 MB".into()));
            }
            let bytes = nuvo_crypto::base64_decode(&file.data).ok_or_else(|| ApiError::Invalid("the file data is not base64".into()))?;
            parse_file(&file.name, &bytes).map_err(|e| ApiError::Invalid(e.to_string()))?.into_iter().map(|p| (p, Vec::new())).collect::<Vec<_>>()
        }
        (None, None, Some(source), Some(rows)) => {
            let label = body.label.unwrap_or_default();
            vec![job::parse_rows(&source, &label, &rows)?]
        }
        _ => return Err(ApiError::Invalid("send a file, or a source with a label and rows".into())),
    };
    let mut imports = imports;
    let paths: Vec<String> = imports.iter().flat_map(|(p, _)| p.rows.iter().filter(|r| r.track.is_none()).filter_map(|r| r.path.clone())).collect();
    if !paths.is_empty() {
        let known = data
            .db
            .call(move |c| {
                let mut map = std::collections::HashMap::new();
                for path in paths {
                    if let Some(snapshot) = nuvo_store::local::snapshot_for_path(c, &path)? {
                        map.insert(path, snapshot);
                    }
                }
                Ok(map)
            })
            .await?;
        for (parsed, _) in &mut imports {
            for row in parsed.rows.iter_mut().filter(|r| r.track.is_none()) {
                row.track = row.path.as_ref().and_then(|p| known.get(p)).cloned();
            }
        }
    }
    let summaries = data
        .db
        .call(move |c| imports.iter().map(|(parsed, legacy)| job::start(c, parsed, legacy, target.clone(), now_ms())).collect::<Result<Vec<_>, _>>())
        .await?;
    Ok(Json(Items { items: summaries }))
}

async fn list(State(state): State<AppState>) -> Result<Json<Items<ImportSummary>>, ApiError> {
    let data = state.data()?;
    Ok(Json(Items { items: data.db.call(job::list).await? }))
}

async fn summary(State(state): State<AppState>, Path(id): Path<String>) -> Result<Json<ImportSummary>, ApiError> {
    let data = state.data()?;
    Ok(Json(data.db.call(move |c| job::summary(c, &id)).await?))
}

const MAX_PENDING_BYTES: usize = 16 * 1024;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PendingTrack {
    playlist_id: String,
    track: Value,
}

async fn pending_get(State(state): State<AppState>) -> Result<Json<Value>, ApiError> {
    let data = state.data()?;
    let job = data.db.call(|c| settings::get(c, settings::IMPORT_PENDING_TRACK)).await?;
    Ok(Json(json!({ "job": job })))
}

async fn pending_put(State(state): State<AppState>, JsonBody(body): JsonBody<PendingTrack>) -> Result<StatusCode, ApiError> {
    let id_ok = body.track["id"].as_str().is_some_and(|id| !id.is_empty());
    let job = json!({ "playlistId": body.playlist_id, "track": body.track });
    if body.playlist_id.is_empty() || body.playlist_id.len() > 128 || !id_ok || job.to_string().len() > MAX_PENDING_BYTES {
        return Err(ApiError::Invalid("a waiting song is {playlistId, track with an id}, under 16 KiB".into()));
    }
    let data = state.data()?;
    data.db.call(move |c| settings::set(c, settings::IMPORT_PENDING_TRACK, &job)).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn pending_clear(State(state): State<AppState>) -> Result<StatusCode, ApiError> {
    let data = state.data()?;
    data.db.call(|c| settings::set(c, settings::IMPORT_PENDING_TRACK, &Value::Null)).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn remove(State(state): State<AppState>, Path(id): Path<String>) -> Result<StatusCode, ApiError> {
    let data = state.data()?;
    data.db.call(move |c| job::delete(c, &id)).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn next(State(state): State<AppState>, Path(id): Path<String>) -> Result<Json<ImportNext>, ApiError> {
    let data = state.data()?;
    Ok(Json(data.db.call(move |c| job::next(c, &id, now_ms())).await?))
}

async fn candidates(State(state): State<AppState>, Path((id, row_id)): Path<(String, String)>, body: Result<Bytes, BytesRejection>) -> Result<Json<ImportRow>, ApiError> {
    let data = state.data()?;
    let row_id: i64 = row_id.parse().map_err(|_| ApiError::Invalid("invalid path parameter".into()))?;
    let body = body.map_err(body_error)?;
    let body: RowCandidates = serde_json::from_slice(&body).map_err(|e| ApiError::Invalid(e.to_string()))?;
    Ok(Json(data.db.call(move |c| job::post_candidates(c, &id, row_id, body.step, body.candidates, body.failed, now_ms())).await?))
}

#[derive(Deserialize)]
struct RowsQuery {
    label: Option<String>,
    cursor: Option<String>,
    limit: Option<usize>,
}

async fn rows(State(state): State<AppState>, Path(id): Path<String>, Query(q): Query<RowsQuery>) -> Result<Json<ImportRowsPage>, ApiError> {
    let data = state.data()?;
    let label = q.label.unwrap_or_else(|| "review".into());
    Ok(Json(data.db.call(move |c| job::rows(c, &id, &label, q.cursor.as_deref(), q.limit.unwrap_or(100))).await?))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct AppendRows {
    rows: Vec<SourceRow>,
}

async fn append(State(state): State<AppState>, Path(id): Path<String>, body: Result<Bytes, BytesRejection>) -> Result<Json<ImportSummary>, ApiError> {
    let data = state.data()?;
    let body: AppendRows = serde_json::from_slice(&body.map_err(body_error)?).map_err(|e| ApiError::Invalid(e.to_string()))?;
    Ok(Json(data.db.call(move |c| job::append(c, &id, &body.rows, &[], now_ms())).await?))
}

async fn decide(State(state): State<AppState>, Path((id, row_id)): Path<(String, String)>, body: Result<Bytes, BytesRejection>) -> Result<Json<ImportRow>, ApiError> {
    let data = state.data()?;
    let row_id: i64 = row_id.parse().map_err(|_| ApiError::Invalid("invalid path parameter".into()))?;
    let body = body.map_err(body_error)?;
    let body: RowDecision = serde_json::from_slice(&body).map_err(|e| ApiError::Invalid(e.to_string()))?;
    Ok(Json(data.db.call(move |c| job::decide(c, &id, row_id, &body.decision, body.track.as_ref(), now_ms())).await?))
}

async fn bulk(State(state): State<AppState>, Path(id): Path<String>, body: Result<Bytes, BytesRejection>) -> Result<Json<ImportSummary>, ApiError> {
    let data = state.data()?;
    let body = body.map_err(body_error)?;
    let body: ImportBulk = serde_json::from_slice(&body).map_err(|e| ApiError::Invalid(e.to_string()))?;
    Ok(Json(data.db.call(move |c| job::bulk(c, &id, &body.action)).await?))
}

/// Main saves it through a save dialog; the renderer never writes files.
async fn report_csv(State(state): State<AppState>, Path(id): Path<String>) -> Result<impl IntoResponse, ApiError> {
    let data = state.data()?;
    let csv = data.db.call(move |c| job::report_csv(c, &id)).await?;
    Ok(([(header::CONTENT_TYPE, "text/csv; charset=utf-8")], csv))
}
