use axum::extract::{DefaultBodyLimit, State};
use axum::routing::post;
use axum::{Json, Router};
use nuvo_match::relevance::{Song, rank_songs};
use nuvo_match::{Answer, Candidate, Source, Step, evaluate, memo, outcome};
use nuvo_store::now_ms;
use nuvo_soundcloud::map;
use serde::Deserialize;
use serde_json::{Value, json};

use crate::error::ApiError;
use crate::extract::JsonBody;
use crate::state::AppState;

const MAX_CANDIDATES: usize = 100;
const MAX_EXCLUDED: usize = 100;
const MAX_RANKED: usize = 200;
const SEARCH_LIMIT: usize = 20;
/// 100 candidate snapshots are far below this; the daemon-wide 16 MiB cap is for bulk imports.
const BODY_LIMIT_BYTES: usize = 1024 * 1024;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/v1/match/evaluate", post(decide))
        .route("/v1/match/next", post(next))
        .route("/v1/match/approved", post(approved))
        .route("/v1/match/rank", post(rank))
        .layer(DefaultBodyLimit::max(BODY_LIMIT_BYTES))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SourceBody {
    title: String,
    #[serde(default)]
    artists: Vec<String>,
    #[serde(default)]
    duration_ms: Option<f64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MatchBody {
    source: SourceBody,
    #[serde(default)]
    candidates: Vec<Value>,
    #[serde(default)]
    steps: Vec<Step>,
    #[serde(default)]
    stand_in_for: Option<String>,
}

fn to_source(raw: &SourceBody) -> Result<Source, ApiError> {
    if raw.title.trim().is_empty() {
        return Err(ApiError::Invalid("source title must not be blank".into()));
    }
    Ok(Source {
        title: raw.title.clone(),
        artists: raw.artists.iter().map(|a| a.trim().to_string()).filter(|a| !a.is_empty()).collect(),
        duration_ms: raw.duration_ms.map(|ms| ms.round() as i64).filter(|ms| *ms > 0),
    })
}

fn source(body: &MatchBody) -> Result<Source, ApiError> {
    if body.candidates.len() > MAX_CANDIDATES {
        return Err(ApiError::Invalid(format!("at most {MAX_CANDIDATES} candidates per request")));
    }
    to_source(&body.source)
}

async fn decide(JsonBody(body): JsonBody<MatchBody>) -> Result<Json<Answer>, ApiError> {
    let src = source(&body)?;
    let candidates: Vec<Candidate> = body.candidates.iter().filter_map(Candidate::from_track).collect();
    Ok(Json(outcome(&candidates, &evaluate(&src, &candidates))))
}

async fn next(State(state): State<AppState>, JsonBody(body): JsonBody<MatchBody>) -> Result<Json<Answer>, ApiError> {
    let src = source(&body)?;
    let data = state.data().ok();
    if body.steps.is_empty()
        && let Some(data) = &data
    {
        let (lookup, stand_in) = (src.clone(), body.stand_in_for.clone());
        let remembered = data
            .db
            .call(move |c| {
                if let Some(id) = stand_in
                    && let Some(answer) = memo::standin(c, &id)?
                {
                    return Ok(Some(answer));
                }
                memo::get(c, &lookup, now_ms())
            })
            .await?;
        if let Some(answer) = remembered {
            return Ok(Json(answer));
        }
    }
    let answer = nuvo_match::next(&src, &body.candidates, &body.steps).map_err(ApiError::Invalid)?;
    if !matches!(answer, Answer::Search { .. })
        && let Some(data) = data
    {
        let (stored, stand_in) = (answer.clone(), body.stand_in_for.clone());
        let saved = data
            .db
            .call(move |c| {
                memo::put(c, &src, &stored, now_ms())?;
                match stand_in {
                    Some(id) => memo::put_standin(c, &id, &stored, now_ms()),
                    None => Ok(()),
                }
            })
            .await;
        if let Err(err) = saved {
            tracing::warn!(%err, "match outcome not remembered");
        }
    }
    Ok(Json(answer))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ApprovedBody {
    target: String,
    source: SourceBody,
    #[serde(default)]
    exclude: Vec<String>,
}

async fn approved(State(state): State<AppState>, JsonBody(body): JsonBody<ApprovedBody>) -> Result<Json<Answer>, ApiError> {
    if body.target != "soundcloud" {
        return Err(ApiError::Invalid("target must be soundcloud".into()));
    }
    if body.exclude.len() > MAX_EXCLUDED {
        return Err(ApiError::Invalid(format!("at most {MAX_EXCLUDED} excluded ids per request")));
    }
    let src = to_source(&body.source)?;
    let sc = state.soundcloud().await;
    let exclude = &body.exclude;
    let answer = nuvo_match::run(&src, |query, _filter| async move {
        let records = sc.search_tracks(&query, SEARCH_LIMIT).await.map_err(|err| err.to_string())?;
        let tracks = records.iter().filter_map(map::track).filter(|t| !exclude.contains(&t.id));
        Ok(tracks.filter_map(|t| serde_json::to_value(t).ok()).collect())
    })
    .await
    .map_err(ApiError::Invalid)?;
    Ok(Json(answer))
}

#[derive(Deserialize)]
struct RankBody {
    query: String,
    songs: Vec<Value>,
}

// The search screen's order of songs: the same relevance an import matches by
async fn rank(JsonBody(body): JsonBody<RankBody>) -> Result<Json<Value>, ApiError> {
    if body.songs.len() > MAX_RANKED {
        return Err(ApiError::Invalid(format!("at most {MAX_RANKED} songs per request")));
    }
    let songs: Vec<Song> = body.songs.iter().filter_map(Song::from_track).collect();
    let ids: Vec<&str> = rank_songs(&body.query, &songs).into_iter().map(|i| songs[i].id.as_str()).collect();
    Ok(Json(json!({ "ids": ids })))
}
