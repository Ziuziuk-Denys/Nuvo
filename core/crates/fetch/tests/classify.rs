use nuvo_fetch::{FetchError, classify};

#[test]
fn stderr_markers_map_to_error_codes() {
    let table = [
        ("ERROR: [youtube] abc: Sign in to confirm you're not a bot. Use --cookies-from-browser", "blocked"),
        ("ERROR: [youtube] abc: Sign in to confirm your age. This video may be inappropriate for some users.", "age_gated"),
        ("ERROR: [instagram] x: Requested content is not available, rate-limit reached or login required", "login_required"),
        ("ERROR: [Spotify] x: This video is DRM protected", "drm"),
        ("ERROR: Unable to download webpage: HTTP Error 429: Too Many Requests", "throttled"),
        ("ERROR: [youtube] abc: Video unavailable. This video has been removed by the uploader", "unavailable"),
        ("ERROR: [youtube] abc: Private video. Sign in if you've been granted access", "unavailable"),
        ("ERROR: Unsupported URL: https://example.com/page", "unsupported"),
        ("ERROR: No suitable extractor found for URL https://example.com/page", "unsupported"),
        ("ERROR: [vk] x: No video formats found!", "unsupported"),
        ("ERROR: Unable to download webpage: <urlopen error [Errno -3] Temporary failure in name resolution>", "network"),
        ("ERROR: [generic] x: Read timed out.", "network"),
        ("something nobody has seen before", "unavailable"),
        ("", "unavailable"),
    ];
    for (stderr, code) in table {
        assert_eq!(classify(stderr).code(), code, "{stderr}");
    }
}

#[test]
fn network_errors_keep_the_first_line_and_codes_cover_the_spec() {
    assert_eq!(classify("\n  ERROR: connection refused\nmore").to_string(), "network error: ERROR: connection refused");
    let codes: Vec<&str> = [
        FetchError::InvalidLink,
        FetchError::Unsupported,
        FetchError::Unavailable,
        FetchError::LoginRequired,
        FetchError::AgeGated,
        FetchError::Drm,
        FetchError::Blocked,
        FetchError::Throttled,
        FetchError::ToolMissing("ffmpeg"),
        FetchError::DecodeFailed(String::new()),
        FetchError::Network(String::new()),
    ]
    .iter()
    .map(FetchError::code)
    .collect();
    assert_eq!(
        codes,
        ["invalid_link", "unsupported", "unavailable", "login_required", "age_gated", "drm", "blocked", "throttled", "tool_missing", "decode_failed", "network"]
    );
}
