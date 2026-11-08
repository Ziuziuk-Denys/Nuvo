//! The proxy URL main hands to the daemon, and the subset each tool understands.
//!
//! **Proxy modes:**
//! - `http://` and `https://` proxies: forward all traffic through the proxy host.
//! - `socks5://` proxy: resolve hostnames locally, tunnel through proxy. Used by yt-dlp and
//!   `reqwest` clients; ffmpeg has no SOCKS support.
//! - `socks5h://` proxy: resolve hostnames through the proxy ("h" = "hostnames"). Used by
//!   yt-dlp and `reqwest`; ffmpeg cannot use it.
//!
//! When a proxy is set, `ensure_public` (before redirection) and `follow_public` (after redirection)
//! do best-effort DNS checks with no guarantee: a malicious proxy or resolver can still bypass them.

use reqwest::Url;

const SCHEMES: [&str; 4] = ["http", "https", "socks5", "socks5h"];

/// Accepts `http`, `https`, `socks5` and `socks5h` URLs with a host and an explicit port, optional
/// credentials, and nothing after the authority. The error is one sentence for the user.
/// Credentials are passed through environment variables, not command arguments.
pub fn parse_proxy(text: &str) -> Result<Url, String> {
    let url = Url::parse(text.trim()).map_err(|_| "the proxy is not a valid URL".to_string())?;
    if !SCHEMES.contains(&url.scheme()) {
        return Err("the proxy must start with http://, https://, socks5:// or socks5h://".into());
    }
    if url.host_str().is_none_or(str::is_empty) {
        return Err("the proxy has no host".into());
    }
    if explicit_port(text.trim()).is_none() {
        return Err("the proxy needs a port between 1 and 65535".into());
    }
    if !matches!(url.path(), "" | "/") || url.query().is_some() || url.fragment().is_some() {
        return Err("the proxy URL must end after the port".into());
    }
    Ok(url)
}

/// `Url` forgets a port equal to the scheme default (`:80` on http), so the port is read from the text.
fn explicit_port(text: &str) -> Option<u16> {
    let authority = text.split_once("://")?.1.split('/').next()?;
    let host_port = authority.rsplit('@').next()?;
    let (_, port) = host_port.rsplit_once(':')?;
    port.parse().ok().filter(|port| *port > 0)
}

/// ffmpeg's `-http_proxy` speaks only plain HTTP proxies.
pub fn ffmpeg_proxy(url: &str) -> Option<&str> {
    url.starts_with("http://").then_some(url)
}
