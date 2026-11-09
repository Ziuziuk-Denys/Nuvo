use axum::extract::State;
use axum::http::StatusCode;
use axum::routing::{get, patch, put};
use axum::{Json, Router};
use nuvo_contracts::{YoutubeAccount, YoutubePreferences, YoutubePreferencesPatch, YoutubeSession};
use nuvo_store::{Connection, StoreError, settings};
use serde_json::Value;

use crate::error::ApiError;
use crate::extract::JsonBody;
use crate::state::AppState;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/v1/youtube/account", get(account))
        .route("/v1/youtube/account/session", put(save_session).delete(drop_session))
        .route("/v1/youtube/account/preferences", patch(update_preferences))
}

const MAX_TOKEN_LEN: usize = 4096;

fn checked(session: &YoutubeSession) -> Result<(), ApiError> {
    let token_ok = |value: &str| !value.is_empty() && value.len() <= MAX_TOKEN_LEN && value.bytes().all(|b| b.is_ascii_graphic());
    if !token_ok(&session.access_token) || !token_ok(&session.refresh_token) {
        return Err(ApiError::Invalid("accessToken and refreshToken must be 1-4096 visible ASCII characters".into()));
    }
    if session.token_type.is_empty() || session.token_type.len() > 32 || !session.token_type.bytes().all(|b| b.is_ascii_alphanumeric()) {
        return Err(ApiError::Invalid("tokenType must be 1-32 letters and digits".into()));
    }
    if session.expires_at <= 0 {
        return Err(ApiError::Invalid("expiresAt must be Unix milliseconds".into()));
    }
    if session.scope.as_deref().is_some_and(|scope| scope.len() > 1024) {
        return Err(ApiError::Invalid("scope is too long".into()));
    }
    Ok(())
}

fn preferences(conn: &Connection) -> Result<YoutubePreferences, StoreError> {
    Ok(settings::get(conn, settings::YOUTUBE_PREFERENCES)?
        .and_then(|value| serde_json::from_value(value).ok())
        .unwrap_or_default())
}

async fn account(State(state): State<AppState>) -> Result<Json<YoutubeAccount>, ApiError> {
    let data = state.data()?;
    let view = data
        .db
        .call(|c| {
            let session = settings::get(c, settings::YOUTUBE_SESSION)?.and_then(|value| serde_json::from_value(value).ok());
            Ok(YoutubeAccount { session, preferences: preferences(c)? })
        })
        .await?;
    Ok(Json(view))
}

async fn save_session(State(state): State<AppState>, JsonBody(session): JsonBody<YoutubeSession>) -> Result<StatusCode, ApiError> {
    checked(&session)?;
    let value = serde_json::to_value(&session).map_err(StoreError::from)?;
    let data = state.data()?;
    data.db.call(move |c| settings::set(c, settings::YOUTUBE_SESSION, &value)).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn drop_session(State(state): State<AppState>) -> Result<StatusCode, ApiError> {
    let data = state.data()?;
    data.db.call(|c| settings::set(c, settings::YOUTUBE_SESSION, &Value::Null)).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn update_preferences(State(state): State<AppState>, JsonBody(patch): JsonBody<YoutubePreferencesPatch>) -> Result<Json<YoutubePreferences>, ApiError> {
    let data = state.data()?;
    let updated = data
        .db
        .call(move |c| {
            let mut current = preferences(c)?;
            if let Some(value) = patch.play_through_account {
                current.play_through_account = value;
            }
            if let Some(value) = patch.offer_sign_in {
                current.offer_sign_in = value;
            }
            if let Some(value) = patch.show_account_playlists {
                current.show_account_playlists = value;
            }
            settings::set(c, settings::YOUTUBE_PREFERENCES, &serde_json::to_value(current)?)?;
            Ok(current)
        })
        .await?;
    Ok(Json(updated))
}
