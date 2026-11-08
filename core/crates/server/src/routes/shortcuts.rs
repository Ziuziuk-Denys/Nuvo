//! `/v1/shortcuts`: the user's key bindings in the encrypted library. Only differences from the
//! defaults are stored; `null` means a cleared binding. The renderer owns the defaults and the rules.

use std::collections::BTreeMap;

use axum::extract::State;
use axum::http::StatusCode;
use axum::routing::get;
use axum::{Json, Router};
use nuvo_store::{StoreError, settings};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::error::ApiError;
use crate::extract::JsonBody;
use crate::state::AppState;

const MAX_ENTRIES: usize = 256;
const MAX_ID: usize = 64;
const MAX_ACCELERATOR: usize = 64;

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Bindings {
    version: u32,
    app: BTreeMap<String, Option<String>>,
    global: BTreeMap<String, Option<String>>,
}

pub fn routes() -> Router<AppState> {
    Router::new().route("/v1/shortcuts", get(read).put(write))
}

fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= MAX_ID && id.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'.' || b == b'-')
}

fn valid_accelerator(accelerator: &str) -> bool {
    !accelerator.is_empty() && accelerator.len() <= MAX_ACCELERATOR && accelerator.bytes().all(|b| b.is_ascii_graphic())
}

fn checked(bindings: &Bindings) -> Result<(), ApiError> {
    if bindings.version != 1 {
        return Err(ApiError::Invalid("version must be 1".into()));
    }
    for scope in [&bindings.app, &bindings.global] {
        if scope.len() > MAX_ENTRIES {
            return Err(ApiError::Invalid(format!("at most {MAX_ENTRIES} bindings per scope")));
        }
        for (id, accelerator) in scope {
            if !valid_id(id) {
                return Err(ApiError::Invalid("command ids are 1-64 of a-z, 0-9, '.' and '-'".into()));
            }
            if accelerator.as_deref().is_some_and(|a| !valid_accelerator(a)) {
                return Err(ApiError::Invalid("an accelerator is 1-64 visible ASCII characters or null".into()));
            }
        }
    }
    Ok(())
}

async fn read(State(state): State<AppState>) -> Result<Json<Value>, ApiError> {
    let data = state.data()?;
    let stored = data.db.call(|c| settings::get(c, settings::SHORTCUTS)).await?;
    Ok(Json(json!({ "bindings": stored })))
}

async fn write(State(state): State<AppState>, JsonBody(bindings): JsonBody<Bindings>) -> Result<StatusCode, ApiError> {
    checked(&bindings)?;
    let value = serde_json::to_value(&bindings).map_err(StoreError::from)?;
    let data = state.data()?;
    data.db.call(move |c| settings::set(c, settings::SHORTCUTS, &value)).await?;
    Ok(StatusCode::NO_CONTENT)
}
