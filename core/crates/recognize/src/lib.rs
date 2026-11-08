//! Song recognition: Shazam signatures, the Shazam client and the listening plan.

pub mod client;
pub mod limiter;
pub mod plan;
pub mod signature;
mod track;

pub use client::{Reply, SHAZAM_URL, Shazam, ShazamError};
pub use limiter::{Limiter, Pace};
pub use track::{InputInfo, InputKind, RecognizedTrack, Song, Via};
