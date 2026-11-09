use std::time::Duration;

use axum::extract::{Path, Query, State};
use axum::routing::{get, post};
use axum::{Json, Router};
use nuvo_contracts::{StatsCollection, StatsContextPlays, StatsDeleteRequest, StatsDeleted, StatsDetail, StatsOverview, day_from_iso, local_day};
use nuvo_store::listening::{self, History};
use nuvo_store::now_ms;
use serde::Deserialize;

use crate::error::ApiError;
use crate::extract::JsonBody;
use crate::state::AppState;

/// Rows per step of the warm-up: about 15 ms, so the database is never held for long.
const WARM_UP_ROWS: i64 = 20_000;
const WARM_UP_DELAY: Duration = Duration::from_secs(5);
const WARM_UP_PAUSE: Duration = Duration::from_millis(50);

pub fn spawn_warm_up(state: AppState) {
    let weak = state.downgrade();
    tokio::spawn(async move {
        tokio::time::sleep(WARM_UP_DELAY).await;
        loop {
            let Some(state) = AppState::upgrade(&weak) else { return };
            let Ok(data) = state.data() else { return };
            let history = data.history.clone();
            let done = data
                .db
                .call(move |c| {
                    nuvo_recs::keys::refresh(c)?;
                    lock(&history).catch_up(c, WARM_UP_ROWS)
                })
                .await;
            if !matches!(done, Ok(false)) {
                return;
            }
            tokio::time::sleep(WARM_UP_PAUSE).await;
        }
    });
}

/// A panic in an earlier pass leaves a copy that is at worst behind; the next pass catches up.
fn lock(history: &std::sync::Mutex<History>) -> std::sync::MutexGuard<'_, History> {
    history.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/v1/stats/overview", get(overview))
        .route("/v1/stats/tracks/{id}", get(track))
        .route("/v1/stats/artists/{key}", get(artist))
        .route("/v1/stats/contexts", get(contexts))
        .route("/v1/stats/collection", get(collection).put(set_collection))
        .route("/v1/stats/delete", post(delete))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct OverviewQuery {
    from: Option<String>,
    to: Option<String>,
    tz_offset_min: Option<i64>,
}

pub fn day_range(from: Option<&str>, to: Option<&str>) -> Result<Option<(i64, i64)>, ApiError> {
    let parse = |text: &str| day_from_iso(text).ok_or_else(|| ApiError::Invalid("dates are YYYY-MM-DD".into()));
    match (from, to) {
        (None, None) => Ok(None),
        (Some(from), Some(to)) => {
            let range = (parse(from)?, parse(to)?);
            if range.0 > range.1 {
                return Err(ApiError::Invalid("from is after to".into()));
            }
            Ok(Some(range))
        }
        _ => Err(ApiError::Invalid("give both from and to, or neither".into())),
    }
}

async fn overview(State(state): State<AppState>, Query(q): Query<OverviewQuery>) -> Result<Json<StatsOverview>, ApiError> {
    let data = state.data()?;
    let range = day_range(q.from.as_deref(), q.to.as_deref())?;
    let today = local_day(now_ms(), q.tz_offset_min.unwrap_or(0));
    let period = listening::Period { from: range.map(|r| r.0), to: range.map(|r| r.1), today };
    let history = data.history.clone();
    Ok(Json(
        data.db
            .call(move |c| {
                nuvo_recs::keys::refresh(c)?;
                listening::overview(c, &mut lock(&history), period)
            })
            .await?,
    ))
}

async fn track(State(state): State<AppState>, Path(id): Path<String>) -> Result<Json<StatsDetail>, ApiError> {
    let data = state.data()?;
    Ok(Json(data.db.call(move |c| listening::track_detail(c, &id)).await?))
}

async fn artist(State(state): State<AppState>, Path(key): Path<String>) -> Result<Json<StatsDetail>, ApiError> {
    let data = state.data()?;
    Ok(Json(
        data.db
            .call(move |c| {
                nuvo_recs::keys::refresh(c)?;
                let canonical = key.strip_prefix("name:").map(|name| nuvo_recs::canon::canon("", name).artist_key);
                match canonical.filter(|key| !key.is_empty()).map(|key| listening::artist_detail(c, &key)) {
                    Some(Ok(detail)) => Ok(detail),
                    _ => listening::artist_detail(c, &key),
                }
            })
            .await?,
    ))
}

async fn contexts(State(state): State<AppState>) -> Result<Json<Vec<StatsContextPlays>>, ApiError> {
    let data = state.data()?;
    Ok(Json(data.db.call(listening::context_plays).await?))
}

async fn collection(State(state): State<AppState>) -> Result<Json<StatsCollection>, ApiError> {
    let data = state.data()?;
    Ok(Json(StatsCollection { paused: data.db.call(listening::collection_paused).await? }))
}

async fn set_collection(State(state): State<AppState>, JsonBody(body): JsonBody<StatsCollection>) -> Result<Json<StatsCollection>, ApiError> {
    let data = state.data()?;
    let paused = body.paused;
    data.db.call(move |c| listening::set_collection_paused(c, paused)).await?;
    Ok(Json(StatsCollection { paused }))
}

async fn delete(State(state): State<AppState>, JsonBody(body): JsonBody<StatsDeleteRequest>) -> Result<Json<StatsDeleted>, ApiError> {
    let data = state.data()?;
    let range = day_range(body.from.as_deref(), body.to.as_deref())?;
    let history = data.history.clone();
    let events = data
        .db
        .call(move |c| {
            let events = listening::delete(c, range)?;
            *lock(&history) = History::default();
            Ok(events)
        })
        .await?;
    Ok(Json(StatsDeleted { events }))
}
