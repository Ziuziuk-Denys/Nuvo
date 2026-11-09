#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum FetchError {
    #[error("the link is not allowed")]
    InvalidLink,
    #[error("the site or media is not supported")]
    Unsupported,
    #[error("the media is gone, private or unavailable")]
    Unavailable,
    #[error("the site wants a signed-in account")]
    LoginRequired,
    #[error("the media is age-restricted")]
    AgeGated,
    #[error("the media is DRM protected")]
    Drm,
    #[error("the site blocks automated access right now")]
    Blocked,
    #[error("the site asks us to slow down")]
    Throttled,
    #[error("{0} is not installed")]
    ToolMissing(&'static str),
    #[error("audio could not be decoded: {0}")]
    DecodeFailed(String),
    #[error("the audio device cannot be opened")]
    NoCapture,
    #[error("network error: {0}")]
    Network(String),
    #[error("the proxy cannot handle this request")]
    ProxyUnsupported,
}

impl FetchError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::InvalidLink => "invalid_link",
            Self::Unsupported => "unsupported",
            Self::Unavailable => "unavailable",
            Self::LoginRequired => "login_required",
            Self::AgeGated => "age_gated",
            Self::Drm => "drm",
            Self::Blocked => "blocked",
            Self::Throttled => "throttled",
            Self::ToolMissing(_) => "tool_missing",
            Self::DecodeFailed(_) => "decode_failed",
            Self::NoCapture => "no_capture",
            Self::Network(_) => "network",
            Self::ProxyUnsupported => "proxy_unsupported",
        }
    }
}
