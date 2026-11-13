mod common;

use std::sync::atomic::Ordering;

use axum::http::StatusCode;
use nuvo_fetch::ffmpeg::{Input, decode};
use nuvo_fetch::{FetchError, Remote};
use nuvo_lyrics::{Lookup, Query};
use serde_json::json;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

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
    assert_eq!(status, StatusCode::OK);
    assert_eq!(core.state.proxy_url().as_deref(), Some("socks5h://user:pw@127.0.0.1:1080"));
    let (status, applied) = common::call(&core.app, "PUT", "/v1/system/network", Some(json!({"proxyUrl": null}))).await;
    assert_eq!((status, applied), (StatusCode::OK, json!({"bridgeUrl": null})));
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
async fn daemon_clients_reach_a_blocked_site_through_socks5h_by_name() {
    let core = common::core();
    let port = common::proxy::serving(b"origin".to_vec(), false).await;
    let (proxy, targets) = common::proxy::socks5(Some("me:p@ss")).await;
    let with_login = proxy.replace("socks5h://", "socks5h://me:p%40ss@");
    common::call(&core.app, "PUT", "/v1/system/network", Some(json!({"proxyUrl": with_login}))).await;

    // `.proxy.test` names resolve only inside the proxy: an answer proves the name went there unresolved.
    let body = core.state.http.get(format!("http://music.proxy.test:{port}/x")).send().await.unwrap().text().await.unwrap();
    assert_eq!(body, "origin");
    assert_eq!(*targets.lock().unwrap(), [format!("music.proxy.test:{port}")]);
}

async fn bridge_for(core: &common::TestCore, proxy: &str) -> String {
    let (status, applied) = common::call(&core.app, "PUT", "/v1/system/network", Some(json!({"proxyUrl": proxy}))).await;
    assert_eq!(status, StatusCode::OK);
    applied["bridgeUrl"].as_str().expect("a SOCKS proxy gets a bridge").to_string()
}

fn through(proxy: &str) -> reqwest::Client {
    reqwest::Client::builder().proxy(reqwest::Proxy::all(proxy).unwrap()).build().unwrap()
}

#[tokio::test]
async fn a_socks_proxy_gets_a_loopback_bridge_with_its_own_login() {
    let core = common::core();
    let port = common::proxy::serving(b"origin".to_vec(), false).await;
    let (proxy, targets) = common::proxy::socks5(Some("me:p@ss")).await;
    let bridge = bridge_for(&core, &proxy.replace("socks5h://", "socks5h://me:p%40ss@")).await;
    assert!(bridge.starts_with("http://nuvo:") && bridge.contains("@127.0.0.1:"), "{bridge}");
    assert!(!bridge.contains("me") && !bridge.contains("p%40ss"), "the upstream login stays in the daemon");

    let url = format!("http://music.proxy.test:{port}/x");
    assert_eq!(through(&bridge).get(&url).send().await.unwrap().text().await.unwrap(), "origin");

    let mut tunnel = tokio::net::TcpStream::connect(bridge.rsplit('@').next().unwrap()).await.unwrap();
    let login = nuvo_crypto::base64_encode(&bridge.as_bytes()["http://".len()..bridge.rfind('@').unwrap()]);
    let connect = format!("CONNECT music.proxy.test:{port} HTTP/1.1\r\nProxy-Authorization: Basic {login}\r\n\r\nGET /x HTTP/1.1\r\nHost: music.proxy.test\r\n\r\n");
    tunnel.write_all(connect.as_bytes()).await.unwrap();
    let mut answer = String::new();
    tunnel.read_to_string(&mut answer).await.unwrap();
    assert!(answer.starts_with("HTTP/1.1 200 Connection established\r\n\r\nHTTP/1.1 200 OK"), "{answer}");
    assert!(answer.ends_with("origin"), "{answer}");

    let without_login = bridge.replace(&bridge["http://".len()..=bridge.rfind('@').unwrap()], "");
    assert_eq!(through(&without_login).get(&url).send().await.unwrap().status(), 407);
    let wrong_login = bridge.replace("http://nuvo:", "http://nuvo:0");
    assert_eq!(through(&wrong_login).get(&url).send().await.unwrap().status(), 407);
    assert_eq!(targets.lock().unwrap().len(), 2, "a caller without the bridge login never reaches the proxy");

    let (_, applied) = common::call(&core.app, "PUT", "/v1/system/network", Some(json!({"proxyUrl": "http://127.0.0.1:3128"}))).await;
    assert_eq!(applied, json!({"bridgeUrl": null}));
    assert!(tokio::net::TcpStream::connect(bridge.rsplit('@').next().unwrap()).await.is_err(), "the old bridge is closed");
}

#[tokio::test]
async fn a_refused_socks_login_is_a_bad_gateway() {
    let core = common::core();
    let (proxy, targets) = common::proxy::socks5(Some("me:right")).await;
    let bridge = bridge_for(&core, &proxy.replace("socks5h://", "socks5h://me:wrong@")).await;
    assert_eq!(through(&bridge).get("http://music.proxy.test:9/x").send().await.unwrap().status(), 502);
    assert!(targets.lock().unwrap().is_empty());
}

#[tokio::test]
async fn ffmpeg_listens_through_a_socks_proxy() {
    let Some(ffmpeg) = nuvo_fetch::Tools::discover().ffmpeg else {
        eprintln!("ffmpeg is not installed; skipped");
        return;
    };
    // Remote reads pass -max_redirects, which ffmpeg has since 7.0 (Nuvo downloads 7.0.2).
    let help = std::process::Command::new(&ffmpeg).args(["-hide_banner", "-h", "protocol=http"]).output().unwrap();
    if !String::from_utf8_lossy(&help.stdout).contains("max_redirects") {
        eprintln!("this ffmpeg is older than 7.0; skipped");
        return;
    }
    let core = common::core();
    let (proxy, targets) = common::proxy::socks5(Some("me:pw")).await;
    bridge_for(&core, &proxy.replace("socks5h://", "socks5h://me:pw@")).await;
    let ffmpeg_proxy = core.state.ffmpeg_proxy().unwrap();
    for tls in [false, true] {
        let port = common::proxy::serving(wav_second(), tls).await;
        let scheme = if tls { "https" } else { "http" };
        let remote = Remote { url: format!("{scheme}://audio.proxy.test:{port}/a.wav"), headers: vec![] };
        let samples = decode(&ffmpeg, &Input::Remote(&remote), 0, Some(500), ffmpeg_proxy.as_deref()).await.unwrap();
        assert!(samples.len() > 10_000, "{scheme}: {} samples", samples.len());
        assert!(targets.lock().unwrap().contains(&format!("audio.proxy.test:{port}")), "{scheme} went through the proxy by name");
    }
}

#[tokio::test]
async fn ffmpeg_cannot_use_an_https_proxy() {
    let core = common::core();
    common::call(&core.app, "PUT", "/v1/system/network", Some(json!({"proxyUrl": "https://127.0.0.1:8443"}))).await;
    assert_eq!(core.state.ffmpeg_proxy(), Err(FetchError::ProxyUnsupported));
    common::call(&core.app, "PUT", "/v1/system/network", Some(json!({"proxyUrl": "http://u:p@127.0.0.1:3128"}))).await;
    assert_eq!(core.state.ffmpeg_proxy().unwrap().as_deref(), Some("http://u:p@127.0.0.1:3128/"));
}

/// One second of a 16 kHz mono tone, as a WAV file.
fn wav_second() -> Vec<u8> {
    let samples: Vec<i16> = (0..16_000).map(|i| ((i as f32 * 0.1).sin() * 8000.0) as i16).collect();
    let data_len = samples.len() as u32 * 2;
    let mut wav = Vec::new();
    wav.extend_from_slice(b"RIFF");
    wav.extend_from_slice(&(36 + data_len).to_le_bytes());
    wav.extend_from_slice(b"WAVEfmt ");
    for field in [16u32.to_le_bytes(), [1, 0, 1, 0], 16_000u32.to_le_bytes(), 32_000u32.to_le_bytes(), [2, 0, 16, 0]] {
        wav.extend_from_slice(&field);
    }
    wav.extend_from_slice(b"data");
    wav.extend_from_slice(&data_len.to_le_bytes());
    for sample in samples {
        wav.extend_from_slice(&sample.to_le_bytes());
    }
    wav
}
