//! The daemon's half of the network check: DNS, TCP and HTTPS per host (TLS problems show in the
//! HTTPS row), the proxy, clock skew and tools. Every step has 5 s and all hosts run at once.
//! Main adds the interface and Chromium-path rows; the renderer adds the YouTube stream resolve.

use std::future::Future;
use std::io;
use std::net::SocketAddr;
use std::pin::Pin;
use std::sync::Arc;
use std::time::{Duration, Instant};

use futures::future::join_all;
use nuvo_contracts::{Deps, NetCheck, NetCheckRow, ToolStatusKind, iso_from_ms, ms_from_iso};
use nuvo_fetch::link::is_public;
use reqwest::Url;
use reqwest::header::DATE;
use tokio::net::TcpStream;
use tokio::time::timeout;

pub const STEP_TIMEOUT: Duration = Duration::from_secs(5);
pub const CLOCK_SKEW_LIMIT_MS: i64 = 5 * 60_000;
/// Most specific first: a failing service is named by the first of these its rows show.
const PRIORITY: [&str; 6] = ["tls_intercepted", "dns_failed", "blocked", "rate_limited", "server_error", "timeout"];

pub type Resolver = Arc<dyn Fn(String, u16) -> Pin<Box<dyn Future<Output = io::Result<Vec<SocketAddr>>> + Send>> + Send + Sync>;

#[derive(Clone, Debug)]
pub struct Target {
    pub service: &'static str,
    pub host: String,
    pub url: String,
}

/// What the check talks to. Tests swap in local servers and a fake resolver.
#[derive(Clone)]
pub struct Setup {
    pub targets: Vec<Target>,
    pub resolver: Resolver,
    /// Local test servers answer on loopback; in production a private answer is a sinkhole.
    pub private_ok: bool,
}

impl Setup {
    /// Only services Nuvo already uses; there is no server of ours to ping.
    pub fn production() -> Self {
        let hosts = [
            ("YouTube", "music.youtube.com"),
            ("YouTube", "www.youtube.com"),
            ("YouTube", "redirector.googlevideo.com"),
            ("YouTube", "i.ytimg.com"),
            ("SoundCloud", "soundcloud.com"),
            ("SoundCloud", "api-v2.soundcloud.com"),
            ("Lyrics", "lrclib.net"),
            ("Lyrics", "raw.githubusercontent.com"),
        ];
        let targets = hosts.map(|(service, host)| Target { service, host: host.into(), url: format!("https://{host}/") }).to_vec();
        Self { targets, resolver: system_resolver(), private_ok: false }
    }
}

pub fn system_resolver() -> Resolver {
    Arc::new(|host: String, port: u16| Box::pin(async move { Ok(tokio::net::lookup_host((host.as_str(), port)).await?.collect()) }))
}

/// The S3 code for an HTTP status; `None` means the host answered and works. Other 4xx count as
/// working: a root path may well be a 404 on an API host.
pub fn status_code(status: u16) -> Option<&'static str> {
    match status {
        407 => Some("proxy_failed"),
        403 | 451 => Some("blocked"),
        429 => Some("rate_limited"),
        500..=599 => Some("server_error"),
        _ => None,
    }
}

/// The S3 code and a short detail for a failed request, read from the whole error chain.
pub fn classify_error(err: &reqwest::Error, proxied: bool) -> (&'static str, String) {
    let mut text = err.to_string();
    let mut source = std::error::Error::source(err);
    while let Some(cause) = source {
        text.push_str(": ");
        text.push_str(&cause.to_string());
        source = cause.source();
    }
    let lower = text.to_lowercase();
    let code = if lower.contains("certificate") || lower.contains("unknownissuer") {
        "tls_intercepted"
    } else if proxied && lower.contains("proxy authorization required") {
        // hyper reports a 407 answer to CONNECT as this exact tunnel error.
        return ("proxy_failed", "HTTP 407".to_string());
    } else if proxied && (lower.contains("tunnel") || lower.contains("proxy")) {
        // Refused, reset or any other non-407 answer from the proxy.
        "proxy_failed"
    } else if err.is_timeout() {
        "timeout"
    } else if lower.contains("dns error") || lower.contains("failed to lookup") {
        "dns_failed"
    } else {
        "blocked"
    };
    // The URL is the target's root and carries nothing private, but keep the detail short.
    (code, text.chars().take(200).collect())
}

/// `Date: Sun, 06 Nov 1994 08:49:37 GMT` in unix milliseconds.
pub fn http_date_ms(value: &str) -> Option<i64> {
    let parts: Vec<&str> = value.split_whitespace().collect();
    let [_, day, month, year, time, "GMT"] = parts[..] else { return None };
    const MONTHS: [&str; 12] = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    let month = MONTHS.iter().position(|m| *m == month)? + 1;
    ms_from_iso(&format!("{year}-{month:02}-{day:0>2}T{time}Z"))
}

fn host_row(check: &'static str, target: &Target, started: Instant, failure: Option<(&'static str, String)>) -> NetCheckRow {
    NetCheckRow {
        check,
        host: Some(target.host.clone()),
        service: Some(target.service),
        ok: failure.is_none(),
        code: failure.as_ref().map(|(code, _)| *code),
        ms: started.elapsed().as_millis() as u64,
        detail: failure.map(|(_, detail)| detail),
    }
}

async fn check_host(target: &Target, setup: &Setup, client: &reqwest::Client, proxied: bool) -> (Vec<NetCheckRow>, Option<i64>) {
    let port = match Url::parse(&target.url) {
        Ok(u) => u.port_or_known_default().unwrap_or(443),
        Err(_) => {
            return (
                vec![NetCheckRow {
                    check: "https",
                    host: Some(target.host.clone()),
                    service: Some(target.service),
                    ok: false,
                    code: Some("blocked"),
                    ms: 0,
                    detail: Some("invalid URL".to_string()),
                }],
                None,
            )
        }
    };
    let mut rows = Vec::new();

    let started = Instant::now();
    let resolved = match timeout(STEP_TIMEOUT, (setup.resolver)(target.host.clone(), port)).await {
        Ok(Ok(addrs)) if !addrs.is_empty() => match addrs.iter().find(|a| !setup.private_ok && !is_public(a.ip())) {
            Some(sinkhole) => Err(format!("resolves to {}", sinkhole.ip())),
            None => Ok(addrs),
        },
        Ok(_) => Err("does not resolve".to_string()),
        Err(_) => Err("no DNS answer in time".to_string()),
    };
    rows.push(host_row("dns", target, started, resolved.as_ref().err().map(|d| ("dns_failed", d.clone()))));

    if let Ok(addrs) = &resolved {
        let started = Instant::now();
        let failure = match timeout(STEP_TIMEOUT, TcpStream::connect(addrs[0])).await {
            Ok(Ok(_)) => None,
            Ok(Err(err)) => Some(("blocked", err.to_string())),
            Err(_) => Some(("timeout", "no answer in time".to_string())),
        };
        rows.push(host_row("tcp", target, started, failure));
    }

    // Through the proxy when one is set: this is the path the daemon's own requests take.
    let started = Instant::now();
    let (failure, date) = match client.get(&target.url).send().await {
        Ok(response) => {
            let status = response.status().as_u16();
            let date = response.headers().get(DATE).and_then(|v| v.to_str().ok()).and_then(http_date_ms);
            (status_code(status).map(|code| (code, format!("HTTP {status}"))), date)
        }
        Err(err) => (Some(classify_error(&err, proxied)), None),
    };
    rows.push(host_row("https", target, started, failure));
    (rows, date)
}

async fn check_proxy(proxy: &Url, setup: &Setup) -> NetCheckRow {
    let started = Instant::now();
    let host = proxy.host_str().unwrap_or_default().trim_start_matches('[').trim_end_matches(']').to_string();
    let port = proxy.port_or_known_default().unwrap_or(1080);
    let reachable = match timeout(STEP_TIMEOUT, (setup.resolver)(host.clone(), port)).await {
        Ok(Ok(addrs)) if !addrs.is_empty() => matches!(timeout(STEP_TIMEOUT, TcpStream::connect(addrs[0])).await, Ok(Ok(_))),
        _ => false,
    };
    NetCheckRow {
        check: "proxy",
        // The scheme only: where the proxy is stays out of rows, reports and logs.
        host: Some(format!("{} proxy", proxy.scheme())),
        service: None,
        ok: reachable,
        code: (!reachable).then_some("proxy_failed"),
        ms: started.elapsed().as_millis() as u64,
        detail: (!reachable).then(|| "not reachable".to_string()),
    }
}

/// Runs the daemon's checks. `hook` is the proxy every daemon client uses.
pub async fn run(setup: &Setup, proxy: Option<&Url>, hook: reqwest::Proxy, now: i64) -> NetCheck {
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(STEP_TIMEOUT)
        .timeout(STEP_TIMEOUT)
        .proxy(hook)
        .build()
        .expect("static reqwest config is valid");
    let hosts = join_all(setup.targets.iter().map(|target| check_host(target, setup, &client, proxy.is_some())));
    let proxy_row = async {
        match proxy {
            Some(url) => Some(check_proxy(url, setup).await),
            None => None,
        }
    };
    let (hosts, proxy_row) = tokio::join!(hosts, proxy_row);
    let mut rows: Vec<NetCheckRow> = proxy_row.into_iter().collect();
    let mut date = None;
    for (host_rows, host_date) in hosts {
        rows.extend(host_rows);
        date = date.or(host_date);
    }
    if let Some(date) = date {
        let skew = (now - date).abs();
        let ok = skew <= CLOCK_SKEW_LIMIT_MS;
        rows.push(NetCheckRow {
            check: "clock",
            host: None,
            service: None,
            ok,
            code: (!ok).then_some("clock"),
            ms: 0,
            detail: (!ok).then(|| format!("off by {} min", skew / 60_000)),
        });
    }
    let (summary, code, service) = summarize(&rows);
    NetCheck { checked_at: iso_from_ms(now), rows, summary, code, service }
}

/// yt-dlp and ffmpeg rows from the dependency check. They never change the summary: playback needs neither.
pub fn tool_rows(deps: &Deps) -> Vec<NetCheckRow> {
    deps.tools
        .iter()
        .filter(|t| matches!(t.name, "yt-dlp" | "ffmpeg"))
        .map(|t| {
            let ok = matches!(t.status, ToolStatusKind::Ok | ToolStatusKind::Outdated);
            NetCheckRow { check: "tools", host: None, service: None, ok, code: (!ok).then_some("tool_missing"), ms: 0, detail: Some(t.name.to_string()) }
        })
        .collect()
}

fn sentence(code: &str, service: &str) -> String {
    match code {
        "dns_failed" => format!("{service} does not resolve on this network."),
        "blocked" => format!("{service} looks blocked on this network. A proxy can help."),
        "tls_intercepted" => format!("Something on this network intercepts secure connections to {service}."),
        "rate_limited" => format!("{service} is limiting requests. Nuvo will retry."),
        "server_error" => format!("{service} has a problem right now."),
        _ => format!("{service} did not answer in time."),
    }
}

fn join_and(names: &[&str]) -> String {
    match names {
        [] => String::new(),
        [one] => one.to_string(),
        [rest @ .., last] => format!("{} and {last}", rest.join(", ")),
    }
}

/// One English sentence with the most specific cause, plus its S3 code and service so the
/// renderer can say the same in its own language.
pub fn summarize(rows: &[NetCheckRow]) -> (String, Option<&'static str>, Option<&'static str>) {
    if rows.iter().any(|r| r.check == "proxy" && !r.ok) {
        return ("The proxy is not reachable.".into(), Some("proxy_failed"), None);
    }
    if let Some(row) = rows.iter().find(|r| r.code == Some("proxy_failed")) {
        let text = if row.detail.as_deref().is_some_and(|d| d.contains("407")) { "The proxy rejected the login." } else { "The proxy is not reachable." };
        return (text.into(), Some("proxy_failed"), None);
    }
    let https: Vec<&NetCheckRow> = rows.iter().filter(|r| r.check == "https").collect();
    let all_failed = |check: &str| rows.iter().filter(|r| r.check == check).all(|r| !r.ok);
    if !https.is_empty() && all_failed("https") && all_failed("dns") {
        return ("You are offline.".into(), Some("offline"), None);
    }
    let mut services: Vec<&'static str> = Vec::new();
    for service in https.iter().filter_map(|r| r.service) {
        if !services.contains(&service) {
            services.push(service);
        }
    }
    // A host counts as broken only when its HTTPS row failed: a blocked direct TCP connect is
    // fine while the proxy gets through.
    let broken_host = |host: &Option<String>| https.iter().any(|r| &r.host == host && !r.ok);
    let broken: Vec<(&'static str, &'static str)> = services
        .iter()
        .filter_map(|service| {
            let codes: Vec<&str> = rows.iter().filter(|r| r.service == Some(service) && !r.ok && broken_host(&r.host)).filter_map(|r| r.code).collect();
            PRIORITY.iter().find(|code| codes.contains(code)).map(|code| (*service, *code))
        })
        .collect();
    if let Some((service, code)) = broken.first() {
        let working: Vec<&str> = services.iter().filter(|s| !broken.iter().any(|(b, _)| b == *s)).copied().collect();
        let mut text = sentence(code, service);
        if !working.is_empty() {
            text.push_str(&format!(" {} {}.", join_and(&working), if working.len() == 1 { "works" } else { "work" }));
        }
        return (text, Some(code), Some(service));
    }
    if let Some(row) = rows.iter().find(|r| r.check == "clock" && !r.ok) {
        let minutes = row.detail.as_deref().unwrap_or_default().trim_start_matches("off by ").to_string();
        return (format!("Your clock is off by {minutes}. Secure connections and sign-ins can fail."), Some("clock"), None);
    }
    ("Everything is reachable.".into(), None, None)
}
