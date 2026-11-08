mod common;

use std::sync::Arc;
use std::time::Duration;

use axum::http::StatusCode;
use axum::routing::get;
use nuvo_contracts::{NetCheck, NetCheckRow, ms_from_iso};
use nuvo_crypto::MemoryKeyStore;
use nuvo_server::netcheck::{self, Resolver, Setup, Target, http_date_ms, status_code, summarize, system_resolver};
use nuvo_store::now_ms;
use reqwest::Url;
use tokio::io::AsyncReadExt;
use tokio::net::TcpListener;
use tokio_rustls::rustls;
use tokio_rustls::rustls::pki_types::pem::PemObject;
use tokio_rustls::rustls::pki_types::{CertificateDer, PrivateKeyDer};

const CERT: &str = "-----BEGIN CERTIFICATE-----
MIIBljCCATugAwIBAgIUB+CXN19njyXtZeRoYgBBUtHziV4wCgYIKoZIzj0EAwIw
FDESMBAGA1UEAwwJbG9jYWxob3N0MCAXDTI2MTAyNzAyMDc0OVoYDzIxMjYxMDAz
MDIwNzQ5WjAUMRIwEAYDVQQDDAlsb2NhbGhvc3QwWTATBgcqhkjOPQIBBggqhkjO
PQMBBwNCAAQd3s4fChV+sW8gLINfz7gMmRknIvIYujKnHz0TDXPrHW2q+VbEH6bE
66AYNmZV4Bi+W6ORs2guHiquRTb3J2B0o2kwZzAdBgNVHQ4EFgQUzBdZNJiue0UK
a4yOlKy9ra2wjQcwHwYDVR0jBBgwFoAUzBdZNJiue0UKa4yOlKy9ra2wjQcwDwYD
VR0TAQH/BAUwAwEB/zAUBgNVHREEDTALgglsb2NhbGhvc3QwCgYIKoZIzj0EAwID
SQAwRgIhALhWD4dbjH2nErTt/OPqw+PZivOM5pruMmA12VGdoXmnAiEA81paaZkQ
PpG093VfIPYC1xqvgat+++jGZDW95aYFFwY=
-----END CERTIFICATE-----";
const KEY: &str = "-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgWFN7y9IBaF7hp9QI
VGtjYsOBstwMtzTtGOHHYAr6jkyhRANCAAQd3s4fChV+sW8gLINfz7gMmRknIvIY
ujKnHz0TDXPrHW2q+VbEH6bE66AYNmZV4Bi+W6ORs2guHiquRTb3J2B0
-----END PRIVATE KEY-----";

/// An HTTP server whose every path answers `status`; hyper adds a `Date` header.
async fn http_status(status: u16) -> String {
    let app = axum::Router::new().fallback(get(move || async move { StatusCode::from_u16(status).unwrap() }));
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://127.0.0.1:{}/", listener.local_addr().unwrap().port());
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    url
}

/// Accepts, reads the TLS ClientHello and hangs up, like a middlebox resetting the handshake.
async fn resetting() -> String {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("https://localhost:{}/", listener.local_addr().unwrap().port());
    tokio::spawn(async move {
        while let Ok((mut stream, _)) = listener.accept().await {
            let mut hello = [0u8; 512];
            let _ = stream.read(&mut hello).await;
            drop(stream);
        }
    });
    url
}

/// A TLS server with a self-signed certificate, like a middlebox rewriting TLS.
async fn self_signed() -> String {
    let certs = vec![CertificateDer::from_pem_slice(CERT.as_bytes()).unwrap()];
    let key = PrivateKeyDer::from_pem_slice(KEY.as_bytes()).unwrap();
    let config = rustls::ServerConfig::builder_with_provider(Arc::new(rustls::crypto::aws_lc_rs::default_provider()))
        .with_safe_default_protocol_versions()
        .unwrap()
        .with_no_client_auth()
        .with_single_cert(certs, key)
        .unwrap();
    let acceptor = tokio_rustls::TlsAcceptor::from(Arc::new(config));
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("https://localhost:{}/", listener.local_addr().unwrap().port());
    tokio::spawn(async move {
        while let Ok((stream, _)) = listener.accept().await {
            let acceptor = acceptor.clone();
            tokio::spawn(async move {
                let _ = acceptor.accept(stream).await;
            });
        }
    });
    url
}

fn target(service: &'static str, url: &str) -> Target {
    let host = Url::parse(url).unwrap().host_str().unwrap().to_string();
    Target { service, host, url: url.into() }
}

fn local(targets: Vec<Target>) -> Setup {
    Setup { targets, resolver: system_resolver(), private_ok: true }
}

async fn run(setup: &Setup, proxy: Option<&str>) -> NetCheck {
    let core = common::core();
    let proxy = proxy.map(|p| Url::parse(p).unwrap());
    core.state.set_proxy(proxy.clone());
    netcheck::run(setup, proxy.as_ref(), core.state.proxy_hook(), now_ms()).await
}

fn https_code(check: &NetCheck, host: &str) -> Option<&'static str> {
    check.rows.iter().find(|r| r.check == "https" && r.host.as_deref() == Some(host)).unwrap().code
}

#[test]
fn statuses_and_dates_map_to_causes() {
    for (status, code) in [(200, None), (301, None), (404, None), (403, Some("blocked")), (451, Some("blocked")), (407, Some("proxy_failed")), (429, Some("rate_limited")), (503, Some("server_error"))] {
        assert_eq!(status_code(status), code, "{status}");
    }
    assert_eq!(http_date_ms("Sun, 06 Nov 1994 08:49:37 GMT"), ms_from_iso("1994-11-06T08:49:37Z"));
    assert_eq!(http_date_ms("Tue, 7 Oct 2026 01:02:03 GMT"), ms_from_iso("2026-10-07T01:02:03Z"));
    assert_eq!(http_date_ms("yesterday"), None);
}

fn row(check: &'static str, service: &'static str, host: &str, code: Option<&'static str>) -> NetCheckRow {
    NetCheckRow { check, host: Some(host.into()), service: Some(service), ok: code.is_none(), code, ms: 1, detail: None }
}

#[test]
fn the_summary_names_the_most_specific_cause() {
    let all_fine = [row("dns", "YouTube", "y", None), row("https", "YouTube", "y", None), row("https", "Lyrics", "l", None)];
    assert_eq!(summarize(&all_fine), ("Everything is reachable.".into(), None, None));

    let youtube_reset = [
        row("dns", "YouTube", "y", None),
        row("tcp", "YouTube", "y", Some("blocked")),
        row("https", "YouTube", "y", Some("blocked")),
        row("https", "SoundCloud", "s", None),
        row("https", "Lyrics", "l", None),
    ];
    assert_eq!(
        summarize(&youtube_reset),
        ("YouTube looks blocked on this network. A proxy can help. SoundCloud and Lyrics work.".into(), Some("blocked"), Some("YouTube"))
    );

    let sinkhole = [row("dns", "SoundCloud", "s", Some("dns_failed")), row("https", "SoundCloud", "s", Some("blocked")), row("https", "Lyrics", "l", None)];
    assert_eq!(summarize(&sinkhole).1, Some("dns_failed"), "DNS is more specific than the failed request");

    let direct_blocked_proxy_fine = [row("tcp", "YouTube", "y", Some("blocked")), row("https", "YouTube", "y", None)];
    assert_eq!(summarize(&direct_blocked_proxy_fine).1, None, "the proxy path works, so YouTube works");

    let offline = [row("dns", "YouTube", "y", Some("dns_failed")), row("https", "YouTube", "y", Some("dns_failed")), row("dns", "Lyrics", "l", Some("dns_failed")), row("https", "Lyrics", "l", Some("dns_failed"))];
    assert_eq!(summarize(&offline), ("You are offline.".into(), Some("offline"), None));

    let mut login = row("https", "YouTube", "y", Some("proxy_failed"));
    login.detail = Some("HTTP 407".into());
    assert_eq!(summarize(&[login]).0, "The proxy rejected the login.");

    let clock = NetCheckRow { check: "clock", host: None, service: None, ok: false, code: Some("clock"), ms: 0, detail: Some("off by 12 min".into()) };
    assert_eq!(summarize(&[row("https", "Lyrics", "l", None), clock]).0, "Your clock is off by 12 min. Secure connections and sign-ins can fail.");
}

#[tokio::test]
async fn local_servers_give_each_cause() {
    let (ok, limited, legal, broken) = (http_status(200).await, http_status(429).await, http_status(451).await, http_status(503).await);
    let (reset, intercepted) = (resetting().await, self_signed().await);
    // Production order: the summary names the first failing service.
    let setup = local(vec![
        target("YouTube", &reset),
        Target { host: "intercepted".into(), ..target("YouTube", &intercepted) },
        Target { host: "limited".into(), ..target("SoundCloud", &limited) },
        Target { host: "legal".into(), ..target("SoundCloud", &legal) },
        Target { host: "broken".into(), ..target("SoundCloud", &broken) },
        target("Lyrics", &ok),
    ]);
    // The renamed hosts resolve through the real resolver as their URL host would.
    let resolver: Resolver = Arc::new(|_host: String, port: u16| Box::pin(async move { Ok(vec![std::net::SocketAddr::from(([127, 0, 0, 1], port))]) }));
    let setup = Setup { resolver, ..setup };
    let started = std::time::Instant::now();
    let check = run(&setup, None).await;
    assert!(started.elapsed() < Duration::from_secs(10));

    assert_eq!(https_code(&check, "127.0.0.1"), None);
    assert_eq!(https_code(&check, "limited"), Some("rate_limited"));
    assert_eq!(https_code(&check, "legal"), Some("blocked"));
    assert_eq!(https_code(&check, "broken"), Some("server_error"));
    assert_eq!(https_code(&check, "localhost"), Some("blocked"), "reset during the handshake");
    assert_eq!(https_code(&check, "intercepted"), Some("tls_intercepted"));
    let clock = check.rows.iter().find(|r| r.check == "clock").expect("a Date header was seen");
    assert!(clock.ok);
    assert_eq!((check.code, check.service), (Some("tls_intercepted"), Some("YouTube")));
    assert_eq!(check.summary, "Something on this network intercepts secure connections to YouTube. Lyrics works.");
}

#[tokio::test]
async fn sinkholes_and_offline_are_dns_causes() {
    let resolver: Resolver = Arc::new(|host: String, _port: u16| {
        Box::pin(async move {
            match host.as_str() {
                "sinkhole.test" => Ok(vec![std::net::SocketAddr::from(([0, 0, 0, 0], 443))]),
                _ => Err(std::io::Error::other("no such host")),
            }
        })
    });
    let setup = Setup { targets: vec![target("YouTube", "https://sinkhole.test/")], resolver: resolver.clone(), private_ok: false };
    let check = run(&setup, None).await;
    let dns = check.rows.iter().find(|r| r.check == "dns").unwrap();
    assert_eq!((dns.code, dns.detail.as_deref()), (Some("dns_failed"), Some("resolves to 0.0.0.0")));
    assert!(check.rows.iter().all(|r| r.check != "tcp"), "no connect to a sinkhole");

    let setup = Setup { targets: vec![target("YouTube", "https://nothing.invalid/"), target("Lyrics", "https://nowhere.invalid/")], resolver, private_ok: false };
    assert_eq!(run(&setup, None).await.summary, "You are offline.");
}

#[tokio::test]
async fn proxy_problems_come_first() {
    let ok = http_status(200).await;
    let setup = local(vec![target("Lyrics", &ok)]);
    let closed = run(&setup, Some("http://127.0.0.1:9")).await;
    assert_eq!(closed.rows[0].check, "proxy");
    // the row says a proxy is set and its scheme, never where it is
    assert_eq!(closed.rows[0].host.as_deref(), Some("http proxy"));
    let socks = run(&setup, Some("socks5://user:pw@proxy.internal.example:1080")).await;
    assert_eq!(socks.rows[0].host.as_deref(), Some("socks5 proxy"));
    let shown = serde_json::to_string(&socks).unwrap();
    for hidden in ["proxy.internal", "1080", "user", "pw"] {
        assert!(!shown.contains(hidden), "{hidden}");
    }
    assert_eq!((closed.summary.as_str(), closed.code), ("The proxy is not reachable.", Some("proxy_failed")));

    let (proxy, _) = common::proxy::answering(b"", Some(common::proxy::USER_PASS_B64)).await;
    let refused = run(&setup, Some(&proxy)).await;
    assert_eq!(refused.summary, "The proxy rejected the login.");
    let with_login = proxy.replace("http://", "http://user:pass@");
    let through = run(&setup, Some(&with_login)).await;
    assert_eq!(through.summary, "Everything is reachable.");
    assert!(through.rows.iter().all(|r| !r.host.as_deref().unwrap_or_default().contains("pass")), "no credentials in rows");
}

#[tokio::test]
async fn https_target_with_407_proxy_says_login_rejected() {
    let (proxy, _) = common::proxy::answering(b"", Some(common::proxy::USER_PASS_B64)).await;
    let setup = local(vec![Target { service: "YouTube", host: "music.youtube.com".into(), url: "https://music.youtube.com/".into() }]);
    let refused = run(&setup, Some(&proxy)).await;
    assert_eq!(refused.summary, "The proxy rejected the login.");
    assert!(refused.rows.iter().all(|r| {
        let host = r.host.as_deref().unwrap_or_default();
        let detail = r.detail.as_deref().unwrap_or_default();
        !host.contains("user") && !host.contains("pass") && !detail.contains("user") && !detail.contains("pass")
    }), "no credentials in rows or summary");
}

#[tokio::test]
async fn the_route_runs_without_a_library_and_keeps_the_result() {
    let ok = http_status(200).await;
    let net = local(vec![target("Lyrics", &ok)]);
    let core = common::boot_config(tempfile::tempdir().unwrap(), MemoryKeyStore::default(), |config| config.test.net = Some(net));
    let (status, body) = common::call(&core.app, "POST", "/v1/system/network-check", None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["summary"], "Everything is reachable.");
    assert!(body.get("code").is_none());
    let tools: Vec<_> = body["rows"].as_array().unwrap().iter().filter(|r| r["check"] == "tools").collect();
    assert_eq!(tools.len(), 2, "yt-dlp and ffmpeg, missing in the empty test environment");
    assert_eq!(tools[0]["code"], "tool_missing");
    assert_eq!(core.state.last_network_check.read().unwrap().as_ref().unwrap().summary, "Everything is reachable.");
}

/// An HTTP proxy that reads the request head and then runs `reply`.
async fn proxy_that(reply: &'static [u8]) -> String {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(async move {
        while let Ok((mut stream, _)) = listener.accept().await {
            let mut buf = [0u8; 1024];
            let _ = stream.read(&mut buf).await;
            let _ = tokio::io::AsyncWriteExt::write_all(&mut stream, reply).await;
        }
    });
    url
}

#[tokio::test]
async fn only_a_real_407_reads_as_login_rejected() {
    let setup = local(vec![Target { service: "YouTube", host: "music.youtube.com".into(), url: "https://music.youtube.com/".into() }]);
    let https_row = |check: &NetCheck| check.rows.iter().find(|r| r.check == "https").unwrap().clone();

    // Accepts the connection and drops it without an answer.
    let closing = proxy_that(b"").await;
    let check = run(&setup, Some(&closing)).await;
    assert_eq!(check.summary, "The proxy is not reachable.");
    assert_ne!(https_row(&check).detail.as_deref(), Some("HTTP 407"));

    // Answers CONNECT with a gateway error.
    let bad_gateway = proxy_that(b"HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n").await;
    let check = run(&setup, Some(&bad_gateway)).await;
    assert_eq!(check.summary, "The proxy is not reachable.");
    assert_eq!(https_row(&check).code, Some("proxy_failed"));
    assert_ne!(https_row(&check).detail.as_deref(), Some("HTTP 407"));

    // Nothing listens on the proxy port.
    let check = run(&setup, Some("http://127.0.0.1:9")).await;
    assert_eq!(check.summary, "The proxy is not reachable.");

    let answered = proxy_that(b"HTTP/1.1 407 Proxy Authentication Required\r\nContent-Length: 0\r\n\r\n").await;
    let check = run(&setup, Some(&answered)).await;
    assert_eq!(https_row(&check).detail.as_deref(), Some("HTTP 407"));
    assert_eq!(check.summary, "The proxy rejected the login.");
}

#[tokio::test]
async fn concurrent_calls_share_one_run() {
    let ok = http_status(200).await;
    let net = local(vec![target("Lyrics", &ok)]);
    let core = common::boot_config(tempfile::tempdir().unwrap(), MemoryKeyStore::default(), |config| config.test.net = Some(net));
    let calls = (0..3).map(|_| common::call(&core.app, "POST", "/v1/system/network-check", None));
    let results = futures::future::join_all(calls).await;
    let stamps: Vec<_> = results.iter().map(|(_, body)| body["checkedAt"].clone()).collect();
    assert!(stamps.windows(2).all(|w| w[0] == w[1]), "{stamps:?}");
}
