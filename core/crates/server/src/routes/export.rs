// Main-only: M3U8 carries local paths and the listening history is personal

use axum::extract::{Path, Query, State};
use axum::http::header;
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::Router;
use nuvo_contracts::{iso_day, iso_from_ms};
use nuvo_import::export::{self, ExportPlaylist, ExportTrack, csv_cell};
use nuvo_store::listening::{self, ExportEvent};
use nuvo_store::{export as queries, now_ms};
use serde::Deserialize;
use serde_json::json;

use crate::error::ApiError;
use crate::routes::stats::day_range;
use crate::state::AppState;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/v1/fs/export/playlists/{id}", get(playlist))
        .route("/v1/fs/export/library", get(library))
        .route("/v1/fs/export/stats", get(stats))
}

#[derive(Deserialize)]
struct Format {
    format: Option<String>,
}

#[derive(Deserialize)]
struct StatsFormat {
    format: Option<String>,
    from: Option<String>,
    to: Option<String>,
}

const STATS_CSV_HEADER: &str = "played_at,local_date,track_id,title,artist,album,played_ms,duration_ms,end_reason,context,context_id,source,session_id,loop_count";

fn stats_csv(events: &[ExportEvent]) -> String {
    let mut out = format!("{STATS_CSV_HEADER}\r\n");
    let text = |value: &Option<String>| value.as_deref().map(csv_cell).unwrap_or_default();
    for e in events {
        let cells = [
            iso_from_ms(e.started_at),
            iso_day(e.local_day),
            csv_cell(&e.track_id),
            csv_cell(&e.title),
            csv_cell(&e.artist),
            text(&e.album),
            e.played_ms.to_string(),
            e.duration_ms.map(|ms| ms.to_string()).unwrap_or_default(),
            csv_cell(&e.end_reason),
            text(&e.context),
            text(&e.context_id),
            text(&e.source),
            csv_cell(&e.session_id),
            e.loop_count.to_string(),
        ];
        out.push_str(&cells.join(","));
        out.push_str("\r\n");
    }
    out
}

fn stats_json(events: &[ExportEvent], from: Option<&str>, to: Option<&str>) -> String {
    let rows: Vec<_> = events
        .iter()
        .map(|e| {
            json!({
                "playedAt": iso_from_ms(e.started_at), "localDate": iso_day(e.local_day), "trackId": e.track_id, "title": e.title, "artist": e.artist,
                "album": e.album, "playedMs": e.played_ms, "durationMs": e.duration_ms, "endReason": e.end_reason, "context": e.context,
                "contextId": e.context_id, "source": e.source, "sessionId": e.session_id, "loopCount": e.loop_count,
            })
        })
        .collect();
    json!({ "kind": "nuvo-listening", "version": 1, "exportedAt": iso_from_ms(now_ms()), "from": from, "to": to, "events": rows }).to_string()
}

fn tracks(rows: Vec<queries::Row>) -> Vec<ExportTrack> {
    rows.into_iter().map(|(snapshot, local_path, added_at)| ExportTrack { snapshot, local_path, added_at: Some(added_at) }).collect()
}

fn document(kind: &'static str, body: String) -> Response {
    ([(header::CONTENT_TYPE, kind)], body).into_response()
}

async fn playlist(State(state): State<AppState>, Path(id): Path<String>, Query(q): Query<Format>) -> Result<Response, ApiError> {
    let data = state.data()?;
    let (title, description, rows) = data.db.call(move |c| queries::playlist(c, &id)).await?;
    let playlist = ExportPlaylist { title, description, tracks: tracks(rows) };
    Ok(match q.format.as_deref().unwrap_or("m3u8") {
        "m3u8" => document("audio/x-mpegurl; charset=utf-8", export::m3u8(&playlist)),
        "csv" => {
            let rows: Vec<_> = playlist.tracks.iter().map(|t| (Some(playlist.title.as_str()), t)).collect();
            document("text/csv; charset=utf-8", export::csv(&rows))
        }
        "json" => document("application/json", export::nuvo_playlist(&playlist).to_string()),
        _ => return Err(ApiError::Invalid("format is m3u8, csv or json".into())),
    })
}

async fn stats(State(state): State<AppState>, Query(q): Query<StatsFormat>) -> Result<Response, ApiError> {
    let data = state.data()?;
    let range = day_range(q.from.as_deref(), q.to.as_deref())?;
    let events = data.db.call(move |c| listening::export_events(c, range)).await?;
    Ok(match q.format.as_deref().unwrap_or("json") {
        "json" => document("application/json", stats_json(&events, q.from.as_deref(), q.to.as_deref())),
        "csv" => document("text/csv; charset=utf-8", stats_csv(&events)),
        _ => return Err(ApiError::Invalid("format is json or csv".into())),
    })
}

async fn library(State(state): State<AppState>, Query(q): Query<Format>) -> Result<Response, ApiError> {
    let data = state.data()?;
    let (liked, playlists) = data
        .db
        .call(|c| {
            let liked = queries::liked(c)?;
            let mut playlists = Vec::new();
            for id in queries::own_playlist_ids(c)? {
                let (title, description, rows) = queries::playlist(c, &id)?;
                playlists.push((title, description, rows));
            }
            Ok((liked, playlists))
        })
        .await?;
    let liked = tracks(liked);
    let playlists: Vec<ExportPlaylist> = playlists.into_iter().map(|(title, description, rows)| ExportPlaylist { title, description, tracks: tracks(rows) }).collect();
    Ok(match q.format.as_deref().unwrap_or("json") {
        "json" => document("application/json", export::nuvo_library(&liked, &playlists, now_ms()).to_string()),
        "csv" => {
            let mut rows: Vec<(Option<&str>, &ExportTrack)> = liked.iter().map(|t| (None, t)).collect();
            for p in &playlists {
                rows.extend(p.tracks.iter().map(|t| (Some(p.title.as_str()), t)));
            }
            document("text/csv; charset=utf-8", export::csv(&rows))
        }
        _ => return Err(ApiError::Invalid("format is json or csv".into())),
    })
}
