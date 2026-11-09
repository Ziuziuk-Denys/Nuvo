use axum::extract::State;
use axum::http::StatusCode;
use axum::routing::{delete, get, patch, post};
use axum::{Json, Router};
use nuvo_contracts::{LastfmSessionRequest, LastfmSettings, LastfmStatus, LastfmToken, NowPlaying};
use nuvo_lastfm::{LastfmError, TOKEN_NOT_AUTHORIZED, auth_url};
use nuvo_store::{scrobbles, settings};
use serde_json::{Value, json};

use crate::error::ApiError;
use crate::extract::JsonBody;
use crate::scrobbler;
use crate::state::AppState;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/v1/lastfm/status", get(status))
        .route("/v1/lastfm/settings", patch(update_settings))
        .route("/v1/lastfm/auth/token", post(auth_token))
        .route("/v1/lastfm/auth/session", post(auth_session))
        .route("/v1/lastfm/session", delete(disconnect))
        .route("/v1/me/playback/now-playing", post(now_playing))
}

fn checked(value: &str, name: &str) -> Result<String, ApiError> {
    let value = value.trim();
    if value.is_empty() || value.len() > 64 || !value.bytes().all(|b| b.is_ascii_alphanumeric()) {
        return Err(ApiError::Invalid(format!("{name} must be 1-64 letters and digits")));
    }
    Ok(value.to_string())
}

fn lastfm_error(err: LastfmError) -> ApiError {
    match err {
        LastfmError::Api { code: TOKEN_NOT_AUTHORIZED, .. } => ApiError::Conflict("approve Nuvo on the Last.fm page first".into()),
        other if other.is_retryable() => ApiError::Upstream(other.to_string()),
        LastfmError::Api { message, .. } => ApiError::Invalid(format!("Last.fm: {message}")),
        other => ApiError::Upstream(other.to_string()),
    }
}

async fn status(State(state): State<AppState>) -> Result<Json<LastfmStatus>, ApiError> {
    let data = state.data()?;
    Ok(Json(data.db.call(scrobbler::status).await?))
}

async fn update_settings(State(state): State<AppState>, JsonBody(body): JsonBody<LastfmSettings>) -> Result<Json<LastfmStatus>, ApiError> {
    let api_key = body.api_key.as_deref().map(|v| checked(v, "apiKey")).transpose()?;
    let api_secret = body.api_secret.as_deref().map(|v| checked(v, "apiSecret")).transpose()?;
    let enabled = body.enabled;
    let data = state.data()?;
    let status = data
        .db
        .call(move |c| {
            let tx = c.unchecked_transaction()?;
            let mut changed = false;
            for (key, value) in [(settings::LASTFM_API_KEY, api_key), (settings::LASTFM_API_SECRET, api_secret)] {
                if let Some(value) = value
                    && scrobbler::text(&tx, key)?.as_deref() != Some(value.as_str())
                {
                    settings::set(&tx, key, &json!(value))?;
                    changed = true;
                }
            }
            // A session belongs to the key that created it, and its plays must not reach another account.
            if changed {
                scrobbler::clear_session(&tx)?;
                scrobbles::clear_all(&tx)?;
            }
            if let Some(enabled) = enabled {
                settings::set(&tx, settings::LASTFM_ENABLED, &json!(enabled))?;
            }
            tx.commit()?;
            scrobbler::status(c)
        })
        .await?;
    Ok(Json(status))
}

async fn auth_token(State(state): State<AppState>) -> Result<Json<LastfmToken>, ApiError> {
    let data = state.data()?;
    let creds = data
        .db
        .call(scrobbler::credentials)
        .await?
        .ok_or_else(|| ApiError::Invalid("enter the Last.fm API key and secret first".into()))?;
    let token = state.lastfm.get_token(&creds).await.map_err(lastfm_error)?;
    Ok(Json(LastfmToken { auth_url: auth_url(&creds.api_key, &token), token }))
}

async fn auth_session(State(state): State<AppState>, JsonBody(body): JsonBody<LastfmSessionRequest>) -> Result<Json<LastfmStatus>, ApiError> {
    let token = checked(&body.token, "token")?;
    let data = state.data()?;
    let creds = data
        .db
        .call(scrobbler::credentials)
        .await?
        .ok_or_else(|| ApiError::Invalid("enter the Last.fm API key and secret first".into()))?;
    let session = state.lastfm.get_session(&creds, &token).await.map_err(lastfm_error)?;
    let status = data
        .db
        .call(move |c| {
            let tx = c.unchecked_transaction()?;
            settings::set(&tx, settings::LASTFM_SESSION_KEY, &json!(session.key))?;
            settings::set(&tx, settings::LASTFM_USER, &json!(session.name))?;
            settings::set(&tx, settings::LASTFM_LAST_ERROR, &Value::Null)?;
            tx.commit()?;
            scrobbler::status(c)
        })
        .await?;
    scrobbler::spawn_flush(&state);
    Ok(Json(status))
}

// The queue is cleared so another account never receives these plays
async fn disconnect(State(state): State<AppState>) -> Result<Json<LastfmStatus>, ApiError> {
    let data = state.data()?;
    Ok(Json(
        data.db
            .call(|c| {
                let tx = c.unchecked_transaction()?;
                scrobbler::clear_session(&tx)?;
                scrobbles::clear_all(&tx)?;
                tx.commit()?;
                scrobbler::status(c)
            })
            .await?,
    ))
}

async fn now_playing(State(state): State<AppState>, JsonBody(body): JsonBody<NowPlaying>) -> Result<StatusCode, ApiError> {
    scrobbler::now_playing(&state, body.track_id, body.track_snapshot).await?;
    Ok(StatusCode::NO_CONTENT)
}
