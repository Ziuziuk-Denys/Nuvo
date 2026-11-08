//! Deny-by-default link rules.

use std::future::Future;
use std::net::{IpAddr, SocketAddr};
use std::time::Duration;

use reqwest::Url;
use reqwest::header::{LOCATION, RANGE};

use crate::{FetchError, Remote};

pub const MAX_LINK_LEN: usize = 2048;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Link {
    /// Normalised, without the fragment.
    pub url: String,
    /// Lowercase domain or IP address (IPv6 without brackets).
    pub host: String,
    pub tiktok: bool,
}

/// `http`/`https` only, at most 2048 characters, no credentials, ports 80/443 only,
/// and no loopback, private or link-local address literals.
pub fn parse_link(text: &str) -> Result<Link, FetchError> {
    let text = text.trim();
    if text.is_empty() || text.len() > MAX_LINK_LEN {
        return Err(FetchError::InvalidLink);
    }
    let mut url = Url::parse(text).map_err(|_| FetchError::InvalidLink)?;
    if !matches!(url.scheme(), "http" | "https") || !url.username().is_empty() || url.password().is_some() {
        return Err(FetchError::InvalidLink);
    }
    // allow exactly ports 80 and 443
    if let Some(port) = url.port()
        && !matches!(port, 80 | 443)
    {
        return Err(FetchError::InvalidLink);
    }
    let host = host_of(&url).ok_or(FetchError::InvalidLink)?;
    if host.parse::<IpAddr>().is_ok_and(|ip| !is_public(ip)) {
        return Err(FetchError::InvalidLink);
    }
    url.set_fragment(None);
    let tiktok = host == "tiktok.com" || host.ends_with(".tiktok.com");
    Ok(Link { url: url.into(), host, tiktok })
}

/// Resolves the host of an `http`/`https` URL and refuses it unless every address is public.
pub async fn ensure_public(url: &str) -> Result<(), FetchError> {
    public_addresses(url).await.map(|_| ())
}

/// Like `ensure_public`, and returns the checked addresses so a client can connect to exactly those.
pub async fn public_addresses(url: &str) -> Result<Vec<SocketAddr>, FetchError> {
    let url = Url::parse(url).map_err(|_| FetchError::InvalidLink)?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err(FetchError::InvalidLink);
    }
    let host = host_of(&url).ok_or(FetchError::InvalidLink)?;
    let port = url.port_or_known_default().unwrap_or(443);
    let addresses: Vec<_> = tokio::net::lookup_host((host.as_str(), port))
        .await
        .map_err(|e| FetchError::Network(e.to_string()))?
        .collect();
    if addresses.is_empty() {
        return Err(FetchError::Network(format!("{host} has no address")));
    }
    if addresses.iter().all(|a| is_public(a.ip())) { Ok(addresses) } else { Err(FetchError::InvalidLink) }
}

/// `scheme://host/path`: no credentials, query or fragment. Empty when the text is not a URL.
pub fn bare_url(url: &str) -> String {
    match Url::parse(url) {
        Ok(parsed) => format!("{}://{}{}", parsed.scheme(), parsed.host_str().unwrap_or(""), parsed.path()),
        Err(_) => String::new(),
    }
}

const MAX_HOPS: usize = 5;

/// Resolves a media URL's redirects by hand, checking every hop with `public_addresses` and connecting
/// only to the addresses it approved (a second DNS answer cannot rebind a hop), and returns the final
/// URL for ffmpeg (which is told not to follow redirects itself). Credentials leave with a redirect
/// to another host. `proxy` is the daemon's proxy hook, when one is set; a proxy resolves names itself.
pub async fn follow_public(remote: &Remote, proxy: Option<&reqwest::Proxy>) -> Result<Remote, FetchError> {
    follow_checked(remote, proxy, |url| async move { public_addresses(&url).await }).await
}

#[doc(hidden)]
pub async fn follow_checked<F, Fut>(remote: &Remote, proxy: Option<&reqwest::Proxy>, check: F) -> Result<Remote, FetchError>
where
    F: Fn(String) -> Fut,
    Fut: Future<Output = Result<Vec<SocketAddr>, FetchError>>,
{
    let mut url = Url::parse(&remote.url).map_err(|_| FetchError::InvalidLink)?;
    let origin = host_of(&url);
    for _ in 0..=MAX_HOPS {
        let addresses = check(url.to_string()).await?;
        // One client per hop, pinned to the addresses just checked.
        let mut builder = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(20));
        if let Some(host) = url.host_str() {
            builder = builder.resolve_to_addrs(host, &addresses);
        }
        if let Some(proxy) = proxy {
            builder = builder.proxy(proxy.clone());
        } else {
            builder = builder.no_proxy();
        }
        let client = builder.build().expect("static reqwest config is valid");
        let same_host = host_of(&url) == origin;
        let mut request = client.get(url.clone()).header(RANGE, "bytes=0-0");
        if same_host {
            for (name, value) in &remote.headers {
                request = request.header(name.as_str(), value.as_str());
            }
        }
        let response = request.send().await.map_err(|e| FetchError::Network(e.without_url().to_string()))?;
        if !response.status().is_redirection() {
            if !response.status().is_success() {
                return Err(FetchError::Unavailable);
            }
            let headers = remote
                .headers
                .iter()
                .filter(|(name, _)| same_host || !matches!(name.to_ascii_lowercase().as_str(), "cookie" | "authorization"))
                .cloned()
                .collect();
            return Ok(Remote { url: url.into(), headers });
        }
        let location = response.headers().get(LOCATION).and_then(|v| v.to_str().ok()).ok_or(FetchError::Unavailable)?;
        url = url.join(location).map_err(|_| FetchError::InvalidLink)?;
    }
    Err(FetchError::InvalidLink)
}

/// Lowercase host; IPv6 literals lose their brackets so they parse as `IpAddr`; trailing dots are removed.
fn host_of(url: &Url) -> Option<String> {
    let host = url.host_str()?.trim_start_matches('[').trim_end_matches(']').trim_end_matches('.');
    (!host.is_empty()).then(|| host.to_ascii_lowercase())
}

/// Globally routable unicast. `IpAddr::is_global` is still unstable.
pub fn is_public(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            let [a, b, c, ..] = v4.octets();
            !(v4.is_private()
                || v4.is_loopback()
                || v4.is_link_local()
                || v4.is_unspecified()
                || v4.is_broadcast()
                || v4.is_documentation()
                || v4.is_multicast()
                || a == 0
                || a >= 240
                || (a == 100 && (64..128).contains(&b))
                || (a == 198 && (18..20).contains(&b))
                || (a == 192 && b == 0 && c == 0))
        }
        IpAddr::V6(v6) => {
            if let Some(v4) = v6.to_ipv4_mapped() {
                return is_public(IpAddr::V4(v4));
            }
            let segs = v6.segments();
            let first = segs[0];
            if (first & 0xffc0) == 0xfec0 {
                return false;
            }
            if first == 0x2001 && segs[1] == 0xdb8 {
                return false;
            }
            if first == 0x100 {
                return false;
            }
            if first == 0x64 && segs[1] == 0xff9b {
                let octets = [(segs[6] >> 8) as u8, (segs[6] & 0xff) as u8, (segs[7] >> 8) as u8, (segs[7] & 0xff) as u8];
                let v4 = std::net::Ipv4Addr::new(octets[0], octets[1], octets[2], octets[3]);
                return is_public(IpAddr::V4(v4));
            }
            if first == 0x2002 {
                let octets = [(segs[1] >> 8) as u8, (segs[1] & 0xff) as u8, (segs[2] >> 8) as u8, (segs[2] & 0xff) as u8];
                let v4 = std::net::Ipv4Addr::new(octets[0], octets[1], octets[2], octets[3]);
                return is_public(IpAddr::V4(v4));
            }
            if first == 0 && segs[1] == 0 && segs[2] == 0 && segs[3] == 0 && segs[4] == 0 && segs[5] == 0 {
                let octets = [(segs[6] >> 8) as u8, (segs[6] & 0xff) as u8, (segs[7] >> 8) as u8, (segs[7] & 0xff) as u8];
                let v4 = std::net::Ipv4Addr::new(octets[0], octets[1], octets[2], octets[3]);
                return is_public(IpAddr::V4(v4));
            }
            !(v6.is_loopback() || v6.is_unspecified() || v6.is_multicast() || (first & 0xfe00) == 0xfc00 || (first & 0xffc0) == 0xfe80)
        }
    }
}
