// With a proxy set, DNS checks are best effort: a malicious proxy or resolver can bypass them

use reqwest::Url;

use crate::FetchError;

const SCHEMES: [&str; 4] = ["http", "https", "socks5", "socks5h"];

// Credentials go through environment variables, never command arguments
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

/// ffmpeg speaks only plain HTTP proxies, so SOCKS goes through the loopback bridge.
pub fn ffmpeg_proxy(proxy: Option<&Url>, bridge: Option<&str>) -> Result<Option<String>, FetchError> {
    match proxy.map(Url::scheme) {
        None => Ok(None),
        Some("http") => Ok(proxy.map(Url::to_string)),
        Some("socks5" | "socks5h") => bridge.map(|url| Some(url.to_string())).ok_or(FetchError::ProxyUnsupported),
        Some(_) => Err(FetchError::ProxyUnsupported),
    }
}

/// Proxy errors can echo the proxy URL; its login stays out of messages and logs.
pub fn without_login(text: &str) -> String {
    text.split(' ')
        .map(|word| match (word.find("://"), word.rfind('@')) {
            (Some(scheme), Some(at)) if at > scheme => format!("{}://***{}", &word[..scheme], &word[at..]),
            _ => word.to_string(),
        })
        .collect::<Vec<_>>()
        .join(" ")
}
