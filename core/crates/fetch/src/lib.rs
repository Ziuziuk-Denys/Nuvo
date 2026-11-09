pub mod classify;
mod error;
pub mod ffmpeg;
pub mod link;
pub mod process;
pub mod proxy;
pub mod tiktok;
pub mod tools;
pub mod update;
pub mod ytdlp;

pub use classify::classify;
pub use error::FetchError;
pub use link::{Link, ensure_public, follow_public, parse_link, public_addresses};
pub use tiktok::{Sound, TIKTOK_URL, TikTok, TikTokPost};
pub use tools::Tools;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Remote {
    pub url: String,
    pub headers: Vec<(String, String)>,
}
