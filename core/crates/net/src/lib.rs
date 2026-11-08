//! Outbound HTTP to catalog and artwork hosts: https only, a deny-by-default host list checked on
//! every hop, redirects followed by hand, one timeout for connect plus body, a body size cap, no
//! cookies and no referrer. Direct requests connect only to the public addresses a lookup returned;
//! a proxy resolves names itself. Tests send every request to one local fixture server instead.

#[cfg(feature = "fixture")]
pub mod fixture;

use std::future::Future;
use std::net::{IpAddr, SocketAddr};
use std::pin::Pin;
use std::sync::Arc;
use std::time::Duration;

use nuvo_fetch::link::is_public;

pub use reqwest::Url;
pub use reqwest::header::HeaderMap;
use reqwest::redirect::Policy;

#[derive(Debug, thiserror::Error, PartialEq)]
pub enum NetError {
    #[error("host is not allowed: {0}")]
    Forbidden(String),
    #[error("request timed out")]
    Timeout,
    #[error("response body is over the size limit")]
    TooLarge,
    #[error("too many redirects")]
    Redirects,
    #[error("request failed: {0}")]
    Http(String),
}

/// What one fetch may do. `allow` sees the lower-case host name of every hop.
pub struct Fetch {
    pub allow: fn(&str) -> bool,
    pub max_bytes: usize,
    pub timeout: Duration,
    pub max_redirects: usize,
    pub accept: &'static str,
}

#[derive(Debug)]
pub struct Fetched {
    pub status: u16,
    /// The URL that answered, after redirects, as the service sees it (never the fixture URL).
    pub url: Url,
    pub headers: HeaderMap,
    pub body: Vec<u8>,
}

impl Fetched {
    pub fn ok(&self) -> bool {
        (200..300).contains(&self.status)
    }

    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers.get(name).and_then(|v| v.to_str().ok())
    }
}

/// Name lookup, injectable so tests can count and fake it.
type Lookup = Arc<dyn Fn(String) -> Pin<Box<dyn Future<Output = std::io::Result<Vec<IpAddr>>> + Send>> + Send + Sync>;

fn system_lookup() -> Lookup {
    Arc::new(|host| {
        Box::pin(async move { Ok(tokio::net::lookup_host((host.as_str(), 443)).await?.map(|addr| addr.ip()).collect()) })
    })
}

#[derive(Clone)]
pub struct Net {
    client: reqwest::Client,
    rewrite: Option<String>,
    proxied: bool,
    lookup: Lookup,
}

fn base_builder() -> reqwest::ClientBuilder {
    reqwest::Client::builder().redirect(Policy::none()).referer(false).no_proxy().user_agent("nuvo-core/0.1")
}

impl Net {
    /// `rewrite` is for tests only: `https://host/path?q` is sent to `<rewrite>/host/path?q`.
    pub fn new(rewrite: Option<String>) -> Self {
        Self::with_proxy(rewrite, None)
    }

    /// `proxy` is the owner's proxy setting; without it requests go direct and ignore the environment.
    pub fn with_proxy(rewrite: Option<String>, proxy: Option<reqwest::Proxy>) -> Self {
        Self::build(rewrite, proxy, system_lookup())
    }

    fn build(rewrite: Option<String>, proxy: Option<reqwest::Proxy>, lookup: Lookup) -> Self {
        let proxied = proxy.is_some();
        let mut builder = base_builder();
        if let Some(proxy) = proxy {
            builder = builder.proxy(proxy);
        }
        let client = builder.build().expect("static reqwest config is valid");
        Self { client, rewrite: rewrite.map(|r| r.trim_end_matches('/').to_string()), proxied, lookup }
    }

    pub async fn get(&self, url: &Url, fetch: &Fetch) -> Result<Fetched, NetError> {
        self.send(url, fetch, &[], None).await
    }

    /// A request with extra headers, a POST when it has a body. A POST never follows a redirect: the
    /// 3xx answer comes back as it is.
    pub async fn send(&self, url: &Url, fetch: &Fetch, headers: &[(&str, &str)], body: Option<&[u8]>) -> Result<Fetched, NetError> {
        match tokio::time::timeout(fetch.timeout, self.follow(url.clone(), fetch, headers, body)).await {
            Ok(result) => result,
            Err(_) => Err(NetError::Timeout),
        }
    }

    async fn follow(&self, mut url: Url, fetch: &Fetch, headers: &[(&str, &str)], body: Option<&[u8]>) -> Result<Fetched, NetError> {
        let mut hops = 0;
        loop {
            let host = check(&url, fetch.allow)?;
            let client = self.client_for(&host).await?;
            let mut request = match body {
                Some(body) => client.post(self.wire_url(&url)).body(body.to_vec()),
                None => client.get(self.wire_url(&url)),
            }
            .header("accept", fetch.accept);
            for (name, value) in headers {
                request = request.header(*name, *value);
            }
            let mut response = request.send().await.map_err(|e| NetError::Http(without_url(e)))?;
            let status = response.status().as_u16();
            let location = response.headers().get("location").and_then(|v| v.to_str().ok()).map(str::to_string);
            if let (300..=399, Some(location), None) = (status, location, body) {
                hops += 1;
                if hops > fetch.max_redirects {
                    return Err(NetError::Redirects);
                }
                url = url.join(&location).map_err(|e| NetError::Http(e.to_string()))?;
                continue;
            }
            let headers = response.headers().clone();
            if response.content_length().is_some_and(|len| len > fetch.max_bytes as u64) {
                return Err(NetError::TooLarge);
            }
            let mut body = Vec::new();
            while let Some(chunk) = response.chunk().await.map_err(|e| NetError::Http(without_url(e)))? {
                if body.len() + chunk.len() > fetch.max_bytes {
                    return Err(NetError::TooLarge);
                }
                body.extend_from_slice(&chunk);
            }
            return Ok(Fetched { status, url, headers, body });
        }
    }

    /// Direct requests connect only to the addresses just approved as public, so a second DNS answer
    /// cannot redirect them. A proxy resolves by itself, and the test rewrite never leaves the machine.
    async fn client_for(&self, host: &str) -> Result<reqwest::Client, NetError> {
        if self.proxied || self.rewrite.is_some() {
            return Ok(self.client.clone());
        }
        let addresses = approved_addresses(host, &self.lookup).await?;
        base_builder().resolve_to_addrs(host, &addresses).build().map_err(|e| NetError::Http(without_url(e)))
    }

    fn wire_url(&self, url: &Url) -> String {
        match &self.rewrite {
            None => url.to_string(),
            Some(base) => {
                let query = url.query().map(|q| format!("?{q}")).unwrap_or_default();
                format!("{base}/{}{}{query}", url.host_str().unwrap_or_default(), url.path())
            }
        }
    }
}

/// The lower-case host of an allowed https URL; the rest of the address checks happen at connect time.
fn check(url: &Url, allow: fn(&str) -> bool) -> Result<String, NetError> {
    let host = url.host_str().unwrap_or_default().to_ascii_lowercase();
    if url.scheme() != "https" || url.port().is_some() {
        return Err(NetError::Forbidden(host));
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err(NetError::Forbidden("credentials in URL".into()));
    }
    if !allow(&host) || host.parse::<IpAddr>().is_ok() {
        return Err(NetError::Forbidden(host));
    }
    Ok(host)
}

/// The public addresses of `host`; non-public answers are dropped and never connected to.
async fn approved_addresses(host: &str, lookup: &Lookup) -> Result<Vec<SocketAddr>, NetError> {
    let ips = lookup(host.to_string()).await.map_err(|e| NetError::Forbidden(format!("DNS resolution failed: {e}")))?;
    if ips.is_empty() {
        return Err(NetError::Forbidden("no addresses found".into()));
    }
    let public: Vec<_> = ips.into_iter().filter(|ip| is_public(*ip)).map(|ip| SocketAddr::new(ip, 443)).collect();
    if public.is_empty() {
        return Err(NetError::Forbidden("all addresses are non-public".into()));
    }
    Ok(public)
}

/// Signed URLs and client ids must not reach logs through error messages.
fn without_url(err: reqwest::Error) -> String {
    err.without_url().to_string()
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;
    use std::sync::atomic::{AtomicUsize, Ordering};

    use super::*;

    const FETCH: Fetch = Fetch { allow: |h| h == "img.example", max_bytes: 16, timeout: Duration::from_secs(2), max_redirects: 1, accept: "*/*" };

    fn counting(ips: Vec<IpAddr>) -> (Lookup, Arc<AtomicUsize>) {
        let calls = Arc::new(AtomicUsize::new(0));
        let seen = calls.clone();
        let lookup: Lookup = Arc::new(move |_| {
            seen.fetch_add(1, Ordering::SeqCst);
            let ips = ips.clone();
            Box::pin(async move { Ok(ips) })
        });
        (lookup, calls)
    }

    #[tokio::test]
    async fn a_proxy_resolves_names_so_no_local_lookup_happens() {
        let (lookup, calls) = counting(vec!["8.8.8.8".parse().unwrap()]);
        let proxy = reqwest::Proxy::all("http://127.0.0.1:9").unwrap();
        let net = Net::build(None, Some(proxy), lookup);
        let url = Url::parse("https://img.example/a").unwrap();
        // The dead proxy fails the request; the point is that nothing was looked up locally.
        assert!(matches!(net.get(&url, &FETCH).await, Err(NetError::Http(_))));
        assert_eq!(calls.load(Ordering::SeqCst), 0);
        let off_list = Url::parse("https://evil.example/a").unwrap();
        assert!(matches!(net.get(&off_list, &FETCH).await, Err(NetError::Forbidden(_))));
    }

    #[tokio::test]
    async fn only_public_addresses_are_approved_and_pinned() {
        let (lookup, _) = counting(vec!["127.0.0.1".parse().unwrap(), "10.0.0.5".parse().unwrap()]);
        assert!(matches!(approved_addresses("img.example", &lookup).await, Err(NetError::Forbidden(_))));
        let (lookup, calls) = counting(vec!["127.0.0.1".parse().unwrap(), "8.8.8.8".parse().unwrap()]);
        let approved = approved_addresses("img.example", &lookup).await.unwrap();
        assert_eq!(approved, vec!["8.8.8.8:443".parse::<SocketAddr>().unwrap()]);
        assert_eq!(calls.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn a_failed_or_empty_lookup_is_refused() {
        let (lookup, _) = counting(vec![]);
        assert!(matches!(approved_addresses("img.example", &lookup).await, Err(NetError::Forbidden(_))));
    }
}
