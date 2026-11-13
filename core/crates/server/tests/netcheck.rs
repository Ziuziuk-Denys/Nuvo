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

async fn http_status(status: u16) -> String {
    let app = axum::Router::new().fallback(get(move || async move { StatusCode::from_u16(status).unwrap() }));
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://127.0.0.1:{}/", listener.local_addr().unwrap().port());
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    url
}

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

async fn self_signed() -> String {
    let acceptor = common::proxy::tls_acceptor();
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
    Target::new(service, url, false)
}

fn local(targets: Vec<Target>) -> Setup {
    Setup { targets, resolver: system_resolver(), private_ok: true }
}

async fn run(setup: &Setup, proxy: Option<&str>) -> NetCheck {
    run_scoped(setup, proxy, true).await
}

async fn run_scoped(setup: &Setup, proxy: Option<&str>, full: bool) -> NetCheck {
    let core = common::core();
    let proxy = proxy.map(|p| Url::parse(p).unwrap());
    core.state.set_proxy(proxy.clone());
    netcheck::run(setup, proxy.as_ref(), core.state.proxy_hook(), now_ms(), full).await
}

fn verdicts(check: &NetCheck) -> Vec<(&'static str, &'static str)> {
    check.services.iter().map(|s| (s.service, s.state)).collect()
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
    let setup = local(vec![
        target("YouTube", &reset),
        Target { host: "intercepted".into(), ..target("YouTube", &intercepted) },
        Target { host: "limited".into(), ..target("SoundCloud", &limited) },
        Target { host: "legal".into(), ..target("SoundCloud", &legal) },
        Target { host: "broken".into(), ..target("SoundCloud", &broken) },
        target("Lyrics", &ok),
    ]);
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
    let offline = run(&setup, None).await;
    assert_eq!(offline.summary, "You are offline.");
    assert!(offline.services.iter().all(|s| s.state == "offline"), "offline is not blocked: {:?}", offline.services);
}

#[tokio::test]
async fn proxy_problems_come_first() {
    let ok = http_status(200).await;
    let setup = local(vec![target("Lyrics", &ok)]);
    let closed = run(&setup, Some("http://127.0.0.1:9")).await;
    assert_eq!(closed.rows[0].check, "proxy");
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
    let setup = local(vec![Target { service: "YouTube", host: "music.youtube.com".into(), url: "https://music.youtube.com/".into(), on_demand: false }]);
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
    let setup = local(vec![Target { service: "YouTube", host: "music.youtube.com".into(), url: "https://music.youtube.com/".into(), on_demand: false }]);
    let https_row = |check: &NetCheck| check.rows.iter().find(|r| r.check == "https").unwrap().clone();

    let closing = proxy_that(b"").await;
    let check = run(&setup, Some(&closing)).await;
    assert_eq!(check.summary, "The proxy is not reachable.");
    assert_ne!(https_row(&check).detail.as_deref(), Some("HTTP 407"));

    let bad_gateway = proxy_that(b"HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n").await;
    let check = run(&setup, Some(&bad_gateway)).await;
    assert_eq!(check.summary, "The proxy is not reachable.");
    assert_eq!(https_row(&check).code, Some("proxy_failed"));
    assert_ne!(https_row(&check).detail.as_deref(), Some("HTTP 407"));

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

#[test]
fn each_service_gets_one_plain_verdict() {
    let timed = |service, host, code, ms| NetCheckRow { ms, ..row("https", service, host, code) };
    let rows = [
        row("dns", "YouTube", "y1", None),
        timed("YouTube", "y1", None, 120),
        timed("YouTube", "y2", None, 340),
        timed("SoundCloud", "s1", None, netcheck::SLOW_MS + 1),
        timed("Lyrics", "l1", None, 90),
        timed("Lyrics", "l2", Some("timeout"), 5000),
        timed("Recognition", "r", Some("server_error"), 80),
        timed("Last.fm", "f", Some("rate_limited"), 80),
        timed("Tools", "t1", Some("blocked"), 30),
        timed("Tools", "t2", Some("proxy_failed"), 30),
    ];
    let services = netcheck::services(&rows);
    assert_eq!(
        services.iter().map(|s| (s.service, s.state, s.ms)).collect::<Vec<_>>(),
        [
            ("YouTube", "works", 340),
            ("SoundCloud", "slow", netcheck::SLOW_MS + 1),
            ("Lyrics", "blocked", 5000),
            ("Recognition", "down", 80),
            ("Last.fm", "down", 80),
            ("Tools", "proxy_error", 30),
        ]
    );
}

#[test]
fn production_checks_every_service_and_playback_ones_by_default() {
    let setup = Setup::production();
    let names = |on_demand: bool| {
        let mut names: Vec<&str> = setup.targets.iter().filter(|t| t.on_demand == on_demand).map(|t| t.service).collect();
        names.dedup();
        names
    };
    assert_eq!(names(false), ["YouTube", "SoundCloud", "Lyrics"]);
    assert_eq!(names(true), ["Recognition", "Last.fm", "Tools", "Updates"]);
    assert!(setup.targets.iter().all(|t| t.url.starts_with("https://") && !t.host.is_empty()), "{:?}", setup.targets);
}

#[tokio::test]
async fn the_automatic_check_leaves_on_demand_services_out() {
    let ok = http_status(200).await;
    let setup = local(vec![target("YouTube", &ok), Target { host: "updates".into(), ..Target::new("Updates", &ok, true) }]);
    assert_eq!(verdicts(&run_scoped(&setup, None, false).await), [("YouTube", "works")]);
    assert_eq!(verdicts(&run_scoped(&setup, None, true).await), [("YouTube", "works"), ("Updates", "works")]);
}

#[tokio::test]
async fn through_a_proxy_only_the_service_itself_is_asked_by_name() {
    let port = common::proxy::serving(b"ok".to_vec(), false).await;
    let (proxy, targets) = common::proxy::socks5(Some("me:pw")).await;
    let setup = local(vec![target("YouTube", &format!("http://music.proxy.test:{port}/"))]);
    let check = run(&setup, Some(&proxy.replace("socks5h://", "socks5h://me:pw@"))).await;
    assert_eq!(verdicts(&check), [("YouTube", "works")], "{:?}", check.rows);
    assert!(check.rows.iter().all(|r| r.check != "dns" && r.check != "tcp"), "no local lookup or direct connect: {:?}", check.rows);
    assert_eq!(*targets.lock().unwrap(), [format!("music.proxy.test:{port}")]);
    assert_eq!(check.code, None);

    let refused = run(&setup, Some(&proxy.replace("socks5h://", "socks5h://me:wrong@"))).await;
    assert_eq!(verdicts(&refused), [("YouTube", "proxy_error")], "{:?}", refused.rows);
}

#[test]
fn behind_a_working_proxy_nothing_reachable_is_not_offline() {
    let proxy = NetCheckRow { check: "proxy", host: Some("socks5h proxy".into()), service: None, ok: true, code: None, ms: 3, detail: None };
    let rows = [proxy, row("https", "YouTube", "y", Some("blocked")), row("https", "Lyrics", "l", Some("blocked"))];
    assert_eq!(summarize(&rows), ("YouTube looks blocked even through the proxy.".into(), Some("blocked"), Some("YouTube")));
}
