use axum::extract::State;
use axum::http::StatusCode;
use axum::routing::{get, post};
use axum::{Json, Router};
use nuvo_contracts::{PassphraseBody, RecoveryPhrase, RestoreRequest};
use nuvo_crypto::{key_from_phrase, phrase_from_key};
use nuvo_store::settings;
use serde_json::{Value, json};

use crate::error::ApiError;
use crate::extract::JsonBody;
use crate::state::AppState;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/v1/recovery/phrase", get(phrase))
        .route("/v1/recovery/confirm", post(confirm))
        .route("/v1/recovery/restore", post(restore))
        .route("/v1/recovery/passphrase", post(unlock_with_passphrase))
}

/// The phrase is derived from the key on demand and served until the user confirms they wrote
/// it down; after that the route is gone (`404`), so the UI shows the onboarding step once.
async fn phrase(State(state): State<AppState>) -> Result<Json<RecoveryPhrase>, ApiError> {
    let data = state.data()?;
    let confirmed = data.db.call(|c| settings::get(c, settings::RECOVERY_CONFIRMED)).await?;
    if confirmed == Some(Value::Bool(true)) {
        return Err(ApiError::NotFound("recovery phrase was already confirmed".into()));
    }
    Ok(Json(RecoveryPhrase { phrase: phrase_from_key(&data.master) }))
}

async fn confirm(State(state): State<AppState>) -> Result<StatusCode, ApiError> {
    let data = state.data()?;
    data.db.call(|c| settings::set(c, settings::RECOVERY_CONFIRMED, &json!(true))).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn restore(State(state): State<AppState>, JsonBody(body): JsonBody<RestoreRequest>) -> Result<StatusCode, ApiError> {
    if state.is_starting() {
        return Err(ApiError::Starting);
    }
    if !state.is_locked() {
        return Err(ApiError::Conflict("library is already unlocked".into()));
    }
    let master = key_from_phrase(&body.phrase).map_err(|_| ApiError::Invalid("invalid recovery phrase".into()))?;
    state.unlock_with(master).await?;
    Ok(StatusCode::NO_CONTENT)
}

/// The way back in when the key file is sealed with a passphrase.
async fn unlock_with_passphrase(State(state): State<AppState>, JsonBody(body): JsonBody<PassphraseBody>) -> Result<StatusCode, ApiError> {
    if state.is_starting() {
        return Err(ApiError::Starting);
    }
    if !state.is_locked() {
        return Err(ApiError::Conflict("library is already unlocked".into()));
    }
    state.unlock_with_passphrase(body.passphrase).await?;
    Ok(StatusCode::NO_CONTENT)
}
