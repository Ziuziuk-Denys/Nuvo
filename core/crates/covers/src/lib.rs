//! Cover art at display size: CDN-side sizing first, local crop and downscale only when needed,
//! one fetch per cover and size, kept in the encrypted cache.

pub mod index;
pub mod picture;
mod service;
pub mod source;

pub use service::{Cover, Covers, Disk, Limits, Prepared, evict, prepare};

#[derive(Debug, Clone, PartialEq, thiserror::Error)]
pub enum CoverError {
    #[error("{0}")]
    Invalid(String),
    #[error("{0} is not an allowed cover host")]
    Forbidden(String),
    #[error("cover not found")]
    NotFound,
    #[error("{0}")]
    Upstream(String),
    #[error("the cover CDN did not answer in time")]
    Timeout,
}
