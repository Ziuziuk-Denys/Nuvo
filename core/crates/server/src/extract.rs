use axum::body::Bytes;
use axum::extract::rejection::BytesRejection;
use axum::extract::{FromRequest, Request};
use axum::http::StatusCode;
use serde::de::DeserializeOwned;

use crate::error::ApiError;

/// Required JSON body. Parsed from raw bytes so a missing Content-Type is not an error,
/// and failures use the daemon's error shape instead of axum's plain-text rejection.
pub struct JsonBody<T>(pub T);

/// Optional JSON body: an empty body yields `T::default()`. The renderer sends some
/// PUTs without a body (for example liking a track it has no snapshot for).
pub struct OptionalJson<T>(pub T);

/// A body over the length limit keeps its 413, in the daemon's JSON error shape.
pub fn body_error(err: BytesRejection) -> ApiError {
    if err.status() == StatusCode::PAYLOAD_TOO_LARGE {
        ApiError::TooLarge
    } else {
        ApiError::Invalid(err.body_text())
    }
}

async fn bytes<S: Send + Sync>(req: Request, state: &S) -> Result<Bytes, ApiError> {
    Bytes::from_request(req, state).await.map_err(body_error)
}

impl<S: Send + Sync, T: DeserializeOwned> FromRequest<S> for JsonBody<T> {
    type Rejection = ApiError;

    async fn from_request(req: Request, state: &S) -> Result<Self, ApiError> {
        let body = bytes(req, state).await?;
        serde_json::from_slice(&body).map(JsonBody).map_err(|e| ApiError::Invalid(e.to_string()))
    }
}

impl<S: Send + Sync, T: DeserializeOwned + Default> FromRequest<S> for OptionalJson<T> {
    type Rejection = ApiError;

    async fn from_request(req: Request, state: &S) -> Result<Self, ApiError> {
        let body = bytes(req, state).await?;
        if body.iter().all(u8::is_ascii_whitespace) {
            return Ok(OptionalJson(T::default()));
        }
        serde_json::from_slice(&body).map(OptionalJson).map_err(|e| ApiError::Invalid(e.to_string()))
    }
}
