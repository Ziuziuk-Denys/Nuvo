use axum::Json;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use nuvo_cache::CacheError;
use nuvo_contracts::ApiErrorBody;
use nuvo_crypto::{random_bytes, to_hex};
use nuvo_store::StoreError;

/// Error body matches the renderer's `ApiError`: `{ message, code, reqId }`.
#[derive(Debug)]
pub enum ApiError {
    NotFound(String),
    Invalid(String),
    Forbidden(String),
    Conflict(String),
    Locked,
    Starting,
    Unauthorized,
    TooLarge,
    TooManyRequests,
    Upstream(String),
    UpstreamTimeout,
    SourceChanged,
    RateLimited,
    ScUnavailable,
    Unplayable(&'static str),
    Unsupported(String),
    Internal(String),
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let req_id = to_hex(&random_bytes::<6>());
        let reason = match &self {
            Self::Unplayable(reason) => Some(*reason),
            _ => None,
        };
        let (status, code, message) = match self {
            Self::NotFound(m) => (StatusCode::NOT_FOUND, "NOT_FOUND", m),
            Self::Invalid(m) => (StatusCode::BAD_REQUEST, "INVALID_INPUT", m),
            Self::Forbidden(host) => (StatusCode::FORBIDDEN, "FORBIDDEN_HOST", format!("host {host} is not allowed")),
            Self::Conflict(m) => (StatusCode::CONFLICT, "CONFLICT", m),
            Self::Locked => (StatusCode::LOCKED, "LOCKED", "library is locked, enter the recovery phrase".into()),
            Self::Starting => (StatusCode::SERVICE_UNAVAILABLE, "CORE_STARTING", "nuvo-core is starting".into()),
            Self::Unauthorized => (StatusCode::UNAUTHORIZED, "UNAUTHORIZED", "missing or wrong token".into()),
            Self::TooLarge => (StatusCode::PAYLOAD_TOO_LARGE, "INVALID_INPUT", "upload is too large".into()),
            Self::TooManyRequests => (StatusCode::TOO_MANY_REQUESTS, "CONFLICT", "too many concurrent pre-cache jobs".into()),
            Self::Upstream(m) => (StatusCode::BAD_GATEWAY, "UPSTREAM", m),
            Self::UpstreamTimeout => (StatusCode::GATEWAY_TIMEOUT, "UPSTREAM_TIMEOUT", "the service did not answer in time".into()),
            Self::SourceChanged => (StatusCode::BAD_GATEWAY, "SOURCE_CHANGED", "the service changed its page".into()),
            Self::RateLimited => (StatusCode::TOO_MANY_REQUESTS, "RATE_LIMITED", "the service is rate limiting requests".into()),
            Self::ScUnavailable => (StatusCode::SERVICE_UNAVAILABLE, "SC_UNAVAILABLE", "SoundCloud cannot be reached at the moment".into()),
            Self::Unplayable(reason) => (StatusCode::CONFLICT, "SC_UNPLAYABLE", format!("this SoundCloud track cannot be played ({reason})")),
            Self::Unsupported(reason) => (StatusCode::UNSUPPORTED_MEDIA_TYPE, "UNSUPPORTED_FORMAT", format!("this file cannot be played here ({reason})")),
            Self::Internal(detail) => {
                tracing::error!(%req_id, %detail, "internal error");
                (StatusCode::INTERNAL_SERVER_ERROR, "INTERNAL", "internal error".into())
            }
        };
        (status, Json(ApiErrorBody { message, code, req_id, reason })).into_response()
    }
}

impl From<StoreError> for ApiError {
    fn from(err: StoreError) -> Self {
        match err {
            StoreError::NotFound(what) => Self::NotFound(format!("{what} not found")),
            StoreError::Conflict(message) => Self::Conflict(message.into()),
            StoreError::Invalid(message) => Self::Invalid(message),
            other => Self::Internal(other.to_string()),
        }
    }
}

impl From<nuvo_soundcloud::ScError> for ApiError {
    fn from(err: nuvo_soundcloud::ScError) -> Self {
        use nuvo_soundcloud::ScError;
        match err {
            ScError::Invalid(_) => Self::Invalid(err.to_string()),
            ScError::NotFound | ScError::Status(404) => Self::NotFound("not found on SoundCloud".into()),
            ScError::Status(429) | ScError::RateLimited => Self::RateLimited,
            ScError::Status(_) | ScError::Upstream(_) => Self::Upstream(err.to_string()),
            ScError::Timeout => Self::UpstreamTimeout,
            ScError::Unavailable => Self::ScUnavailable,
            ScError::Unplayable(reason) => Self::Unplayable(reason.as_str()),
        }
    }
}

impl From<CacheError> for ApiError {
    fn from(err: CacheError) -> Self {
        match err {
            CacheError::Empty => Self::Invalid(err.to_string()),
            other => Self::Internal(other.to_string()),
        }
    }
}
