//! SoundCloud's public catalog and streams, without an account.

mod catalog;
mod client;
pub mod hls;
mod import;
pub mod ids;
pub mod link;
pub mod map;
pub mod play;

pub use catalog::{LikesPage, SetView, TypeFilter};
pub use client::{API_URL, Limits, SoundCloud, WEB_URL, find_client_id, host_allowed, script_urls};
pub use hls::AudioSink;
pub use import::{ImportListing, import_row, strip_artist};
pub use play::{Format, Playable};

/// Why a track cannot be played; the player falls back to another source for every one of them.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Reason {
    Gone,
    RegionBlocked,
    Preview,
    StreamDisabled,
    NoFormat,
    Drm,
}

impl Reason {
    pub fn as_str(self) -> &'static str {
        match self {
            Reason::Gone => "gone",
            Reason::RegionBlocked => "region_blocked",
            Reason::Preview => "preview",
            Reason::StreamDisabled => "stream_disabled",
            Reason::NoFormat => "no_format",
            Reason::Drm => "drm",
        }
    }
}

#[derive(Debug, thiserror::Error, PartialEq)]
pub enum ScError {
    #[error("{0} is not a SoundCloud id")]
    Invalid(String),
    #[error("not found on SoundCloud")]
    NotFound,
    /// A non-2xx answer to a primary read, after the `client_id` and `Retry-After` retries.
    #[error("SoundCloud answered {0}")]
    Status(u16),
    #[error("{0}")]
    Upstream(String),
    #[error("SoundCloud did not answer in time")]
    Timeout,
    #[error("SoundCloud is rate limiting requests")]
    RateLimited,
    #[error("SoundCloud cannot be reached at the moment")]
    Unavailable,
    #[error("track cannot be played: {}", .0.as_str())]
    Unplayable(Reason),
}
