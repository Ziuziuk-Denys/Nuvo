//! yt-dlp stderr to an error code, by marker lists.

use crate::FetchError;

const DRM: &[&str] = &["drm protected", "drm-protected", "this video is drm", "protected by drm"];
const AGE_GATED: &[&str] = &["age-restricted", "age restricted", "confirm your age", "inappropriate for some users"];
const BOT_WALL: &[&str] = &[
    "not a bot",
    "sign in to confirm",
    "failed to extract any player response",
    "unable to extract player response",
    "please sign in",
];
const LOGIN: &[&str] = &[
    "login required",
    "requires login",
    "login_required",
    "requested content is not available",
    "use --cookies",
    "cookies-from-browser",
    "account is private",
    "you need to log in",
];
const THROTTLED: &[&str] = &["http error 429", "too many requests", "rate-limit", "rate limit", "temporarily blocked"];
const NETWORK: &[&str] = &[
    "temporary failure in name resolution",
    "name or service not known",
    "network is unreachable",
    "connection refused",
    "connection reset",
    "timed out",
];
const UNSUPPORTED: &[&str] = &["unsupported url", "no suitable extractor", "no video formats found", "requested format is not available"];

/// First matching list wins, in this order. The "gone" markers (private video, removed,
/// unavailable) and anything unrecognised both end as `Unavailable`.
pub fn classify(stderr: &str) -> FetchError {
    let text = stderr.to_lowercase();
    let has = |marks: &[&str]| marks.iter().any(|mark| text.contains(mark));
    if has(DRM) {
        FetchError::Drm
    } else if has(AGE_GATED) {
        FetchError::AgeGated
    } else if has(BOT_WALL) {
        FetchError::Blocked
    } else if has(LOGIN) {
        FetchError::LoginRequired
    } else if has(THROTTLED) {
        FetchError::Throttled
    } else if has(NETWORK) {
        FetchError::Network(stderr.lines().find(|l| !l.trim().is_empty()).unwrap_or("").trim().to_string())
    } else if has(UNSUPPORTED) {
        FetchError::Unsupported
    } else {
        FetchError::Unavailable
    }
}
