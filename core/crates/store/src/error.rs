#[derive(Debug, thiserror::Error)]
pub enum StoreError {
    #[error("database key does not match this library")]
    WrongKey,
    #[error("database was written by a newer nuvo-core (schema v{0})")]
    TooNew(usize),
    #[error("{0} not found")]
    NotFound(&'static str),
    #[error("{0}")]
    Conflict(&'static str),
    #[error("{0}")]
    Invalid(String),
    #[error(transparent)]
    Sqlite(#[from] rusqlite::Error),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
    #[error("blocking task failed: {0}")]
    Task(String),
}

impl From<nuvo_contracts::InvalidTrack> for StoreError {
    fn from(err: nuvo_contracts::InvalidTrack) -> Self {
        StoreError::Invalid(err.to_string())
    }
}
