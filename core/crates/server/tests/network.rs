mod common;

use std::sync::atomic::Ordering;

use axum::http::StatusCode;
use axum::routing::get;
use nuvo_lyrics::{Lookup, Query};
use serde_json::json;

const RECORD: &[u8] = br#"{"id":1,"trackName":"Song","artistName":"Artist","albumName":"A","duration":200,"instrumental":false,"plainLyrics":"line","syncedLyrics":"[00:01.00] line"}"#;

#[tokio::test]
async fn the_proxy_setting_is_validated() {
    let core = common::core();
    for body in [json!({"proxyUrl": "ftp://h:21"}), json!({"proxyUrl": "http://h"}), json!({"proxy": null}), json!({"mode": "manual", "url": "http://h:1", "username": null})] {
        let (status, error) = common::call(&core.app, "PUT", "/v1/system/network", Some(body.clone())).await;
        assert_eq!((status, error["code"].as_str()), (StatusCode::BAD_REQUEST, Some("INVALID_INPUT")), "{body}");
    }
    assert_eq!(core.state.proxy_url(), None);
    let (status, _) = common::call(&core.app, "PUT", "/v1/system/network", Some(json!({"proxyUrl": "socks5h://user:pw@127.0.0.1:1080"}))).await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    assert_eq!(core.state.proxy_url().as_deref(), Some("socks5h://user:pw@127.0.0.1:1080"));
    let (status, _) = common::call(&core.app, "PUT", "/v1/system/network", Some(json!({"proxyUrl": null}))).await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    assert_eq!(core.state.proxy_url(), None);
}

#[tokio::test]
async fn a_percent_encoded_password_reaches_the_proxy_decoded() {
    let core = common::core();
    // base64 of `me:p@ss`
    let (proxy, count) = common::proxy::answering(RECORD, Some("bWU6cEBzcw==")).await;
    let with_login = proxy.replace("http://", "http://me:p%40ss@");
    common::call(&core.app, "PUT", "/v1/system/network", Some(json!({"proxyUrl": with_login}))).await;
    let response = core.state.http.get("http://127.0.0.1:9/x").send().await.unwrap();
    assert_eq!(response.status(), 200);
    assert_eq!(count.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn a_tunnel_through_the_proxy_carries_the_login() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://me:p%40ss@{}", listener.local_addr().unwrap());
    let (heads, mut seen) = tokio::sync::mpsc::unbounded_channel();
    tokio::spawn(async move {
        while let Ok((mut stream, _)) = listener.accept().await {
            use tokio::io::{AsyncReadExt, AsyncWriteExt};
            let mut buffer = vec![0; 2048];
            let read = stream.read(&mut buffer).await.unwrap_or(0);
            let _ = heads.send(String::from_utf8_lossy(&buffer[..read]).into_owned());
            let _ = stream.write_all(b"HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n").await;
        }
    });
    let core = common::core();
    common::call(&core.app, "PUT", "/v1/system/network", Some(json!({"proxyUrl": url}))).await;
    let _ = core.state.http.get("https://music.youtube.com/").send().await;
    let head = seen.recv().await.unwrap();
    assert!(head.starts_with("CONNECT music.youtube.com:443"), "{head}");
    assert!(head.to_lowercase().contains("proxy-authorization: basic bwu6cebzcw=="), "{head}");
}

#[tokio::test]
async fn daemon_clients_follow_an_http_proxy_with_credentials() {
    let core = common::core();
    let (proxy, count) = common::proxy::answering(RECORD, Some(common::proxy::USER_PASS_B64)).await;
    let with_login = proxy.replace("http://", "http://user:pass@");
    common::call(&core.app, "PUT", "/v1/system/network", Some(json!({"proxyUrl": with_login}))).await;

    // LRCLIB points at a closed port: an answer can only come from the proxy.
    let query = Query { title: "Song".into(), artist: "Artist".into(), duration_ms: Some(200_000) };
    assert!(matches!(core.state.lrclib.lookup(&query).await, Ok(Lookup::Found(_))));
    let response = core.state.http.get("http://127.0.0.1:9/x").send().await.unwrap();
    assert_eq!(response.status(), 200);
    assert_eq!(count.load(Ordering::SeqCst), 2);

    common::call(&core.app, "PUT", "/v1/system/network", Some(json!({"proxyUrl": proxy}))).await;
    assert_eq!(core.state.http.get("http://127.0.0.1:9/x").send().await.unwrap().status(), 407, "no login, no entry");

    common::call(&core.app, "PUT", "/v1/system/network", Some(json!({"proxyUrl": null}))).await;
    assert!(core.state.http.get("http://127.0.0.1:9/x").send().await.is_err(), "direct again: the closed port refuses");
}

#[tokio::test]
async fn daemon_clients_tunnel_through_socks5() {
    let core = common::core();
    let app = axum::Router::new().route("/x", get(|| async { "direct-mock" }));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let target = format!("http://localhost:{}/x", listener.local_addr().unwrap().port());
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    let (proxy, count) = common::proxy::socks5().await;
    common::call(&core.app, "PUT", "/v1/system/network", Some(json!({"proxyUrl": proxy}))).await;

    let body = core.state.http.get(&target).send().await.unwrap().text().await.unwrap();
    assert_eq!(body, "direct-mock");
    assert_eq!(count.load(Ordering::SeqCst), 1);
}
