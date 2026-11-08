use std::time::Duration;

use nuvo_net::fixture::{Fixture, Reply};
use nuvo_net::{Fetch, NetError, Url};

fn allow(host: &str) -> bool {
    host == "img.example" || host == "cdn.example"
}

const FETCH: Fetch = Fetch { allow, max_bytes: 16, timeout: Duration::from_millis(300), max_redirects: 2, accept: "image/*" };

fn url(s: &str) -> Url {
    Url::parse(s).unwrap()
}

#[tokio::test]
async fn fetches_through_the_fixture_and_reports_the_service_url() {
    let fx = Fixture::start().await;
    fx.on("https://img.example/a.jpg", Reply::bytes("image/jpeg", b"abc".to_vec()));
    let got = fx.net().get(&url("https://img.example/a.jpg?x=1"), &FETCH).await.unwrap();
    assert_eq!((got.status, got.body.as_slice()), (200, b"abc".as_slice()));
    assert_eq!(got.url.as_str(), "https://img.example/a.jpg?x=1");
    assert_eq!(got.header("content-type"), Some("image/jpeg"));
    let hit = &fx.hits("https://img.example/a.jpg")[0];
    assert_eq!(hit.query["x"], "1");
    assert_eq!(hit.headers["accept"], "image/*");
    assert!(hit.headers.get("cookie").is_none() && hit.headers.get("referer").is_none());
}

#[tokio::test]
async fn hosts_off_the_list_and_plain_http_are_refused_without_a_request() {
    let fx = Fixture::start().await;
    let net = fx.net();
    assert_eq!(net.get(&url("https://evil.example/a"), &FETCH).await.unwrap_err(), NetError::Forbidden("evil.example".into()));
    assert!(matches!(net.get(&url("http://img.example/a"), &FETCH).await, Err(NetError::Forbidden(_))));
    assert!(matches!(net.get(&url("https://img.example:8443/a"), &FETCH).await, Err(NetError::Forbidden(_))));
    assert_eq!(fx.total(), 0);
}

#[tokio::test]
async fn redirects_are_checked_hop_by_hop_and_capped() {
    let fx = Fixture::start().await;
    fx.on("https://img.example/r", Reply::redirect("https://cdn.example/final?sig=1"));
    fx.on("https://cdn.example/final", Reply::text("ok"));
    fx.on("https://img.example/evil", Reply::redirect("https://evil.example/x"));
    fx.on("https://img.example/loop", Reply::redirect("/loop"));
    let net = fx.net();
    let got = net.get(&url("https://img.example/r"), &FETCH).await.unwrap();
    assert_eq!(got.url.as_str(), "https://cdn.example/final?sig=1");
    assert_eq!(net.get(&url("https://img.example/evil"), &FETCH).await.unwrap_err(), NetError::Forbidden("evil.example".into()));
    assert!(!fx.hosts().contains(&"evil.example".to_string()));
    assert_eq!(net.get(&url("https://img.example/loop"), &FETCH).await.unwrap_err(), NetError::Redirects);
}

#[tokio::test]
async fn bodies_over_the_cap_and_slow_answers_fail() {
    let fx = Fixture::start().await;
    fx.on("https://img.example/big", Reply::bytes("image/jpeg", vec![0u8; 17]));
    fx.on("https://img.example/slow", Reply::text("late").after(Duration::from_secs(5)));
    let net = fx.net();
    assert_eq!(net.get(&url("https://img.example/big"), &FETCH).await.unwrap_err(), NetError::TooLarge);
    let started = std::time::Instant::now();
    assert_eq!(net.get(&url("https://img.example/slow"), &FETCH).await.unwrap_err(), NetError::Timeout);
    assert!(started.elapsed() < Duration::from_secs(2));
}

#[tokio::test]
async fn error_statuses_are_returned_not_raised() {
    let fx = Fixture::start().await;
    fx.on_seq("https://img.example/flaky", vec![Reply::status(503), Reply::text("fine")]);
    let net = fx.net();
    assert_eq!(net.get(&url("https://img.example/flaky"), &FETCH).await.unwrap().status, 503);
    assert!(net.get(&url("https://img.example/flaky"), &FETCH).await.unwrap().ok());
    assert_eq!(net.get(&url("https://img.example/unknown"), &FETCH).await.unwrap().status, 404);
}

#[tokio::test]
async fn ip_literals_are_refused() {
    let fx = Fixture::start().await;
    let net = fx.net();
    assert!(matches!(net.get(&url("https://127.0.0.1/a"), &FETCH).await, Err(NetError::Forbidden(_))));
    assert!(matches!(net.get(&url("https://[::1]/a"), &FETCH).await, Err(NetError::Forbidden(_))));
    assert!(matches!(net.get(&url("https://192.168.1.1/a"), &FETCH).await, Err(NetError::Forbidden(_))));
    assert_eq!(fx.total(), 0);
}

#[tokio::test]
async fn credentials_in_url_are_refused() {
    let fx = Fixture::start().await;
    let net = fx.net();
    assert!(matches!(net.get(&url("https://user@img.example/a"), &FETCH).await, Err(NetError::Forbidden(_))));
    assert!(matches!(net.get(&url("https://user:pass@img.example/a"), &FETCH).await, Err(NetError::Forbidden(_))));
    assert_eq!(fx.total(), 0);
}

#[tokio::test]
async fn fixture_loopback_is_allowed_in_test_mode() {
    let fx = Fixture::start().await;
    fx.on("https://img.example/test", Reply::text("ok"));
    let net = fx.net();
    let got = net.get(&url("https://img.example/test"), &FETCH).await.unwrap();
    assert_eq!(got.status, 200);
    assert_eq!(got.body.as_slice(), b"ok");
}
