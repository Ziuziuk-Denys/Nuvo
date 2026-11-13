use nuvo_fetch::{FetchError, ensure_public, parse_link};

#[test]
fn accepts_public_http_links_and_normalises_them() {
    let link = parse_link("  https://www.YouTube.com/watch?v=abc#t=10 ").unwrap();
    assert_eq!(link.url, "https://www.youtube.com/watch?v=abc");
    assert_eq!(link.host, "www.youtube.com");
    assert!(!link.tiktok);

    for tiktok in ["https://vm.tiktok.com/ZSabc/", "https://www.tiktok.com/@a/video/7234567890123456789", "http://tiktok.com/t/x"] {
        assert!(parse_link(tiktok).unwrap().tiktok, "{tiktok}");
    }
    assert!(!parse_link("https://nottiktok.com/x").unwrap().tiktok);
    assert!(parse_link("https://www.tiktok.com./x").unwrap().tiktok, "trailing dot is trimmed");
    assert!(parse_link("https://1.1.1.1/x").is_ok());
    assert!(parse_link("https://example.com:443/x").is_ok(), "port 443 is allowed");
    assert!(parse_link("http://example.com:80/x").is_ok(), "port 80 is allowed");
}

#[test]
fn refuses_everything_else() {
    let long = format!("https://example.com/{}", "a".repeat(2048));
    let refused = [
        "",
        "hello",
        "example.com/watch",
        "ftp://example.com/a",
        "file:///etc/passwd",
        "javascript:alert(1)",
        "data:text/html,hi",
        "https://user:pw@example.com/",
        "https://user@example.com/",
        "https://example.com:8080/",
        "http://127.0.0.1/",
        "http://127.1.2.3/",
        "http://10.1.2.3/",
        "http://172.16.0.1/",
        "http://192.168.0.1/",
        "http://192.0.0.1/",
        "http://198.18.0.1/",
        "http://198.19.255.255/",
        "http://169.254.169.254/latest/meta-data",
        "http://100.64.0.1/",
        "http://0.0.0.0/",
        "http://[::1]/",
        "http://[fe80::1]/",
        "http://[fd00::1]/",
        "http://[fec0::1]/",
        "http://[64:ff9b::7f00:1]/",
        "http://[2002:7f00:1::]/",
        "http://[::7f00:1]/",
        "http://[2001:db8::1]/",
        "http://[100::1]/",
        "http://[::ffff:127.0.0.1]/",
        "http://[::ffff:10.0.0.1]/",
        long.as_str(),
    ];
    for text in refused {
        assert_eq!(parse_link(text), Err(FetchError::InvalidLink), "{text}");
    }
}

#[tokio::test]
async fn names_that_resolve_to_private_addresses_are_refused() {
    assert_eq!(ensure_public("http://localhost/x").await, Err(FetchError::InvalidLink));
    assert_eq!(ensure_public("https://127.0.0.1:8443/x").await, Err(FetchError::InvalidLink));
    assert_eq!(ensure_public("ftp://1.1.1.1/x").await, Err(FetchError::InvalidLink));
    assert_eq!(ensure_public("not a url").await, Err(FetchError::InvalidLink));
    assert_eq!(ensure_public("https://1.1.1.1/x").await, Ok(()), "a public literal needs no lookup");
    assert_eq!(ensure_public("https://[2606:4700:4700::1111]/x").await, Ok(()));
}

mod redirects {
    use axum::Router;
    use axum::http::{HeaderMap, StatusCode, header};
    use axum::routing::get;
    use std::net::SocketAddr;

    use nuvo_fetch::link::follow_checked;
    use nuvo_fetch::{FetchError, Remote};

    async fn serve() -> u16 {
        let app = Router::new()
            .route("/a", get(|| async { (StatusCode::FOUND, [(header::LOCATION, "/b")]) }))
            .route("/b", get(|headers: HeaderMap| async move { format!("cookie={}", headers.contains_key(header::COOKIE)) }))
            .route("/to-private", get(|| async { (StatusCode::FOUND, [(header::LOCATION, "/private/x")]) }))
            .route("/private/x", get(|| async { "secret" }))
            .route("/loop", get(|| async { (StatusCode::FOUND, [(header::LOCATION, "/loop")]) }));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        port
    }

    fn remote(url: String) -> Remote {
        Remote { url, headers: vec![("Cookie".into(), "s=1".into()), ("Referer".into(), "https://x/".into())] }
    }

    async fn no_private(url: String) -> Result<Vec<SocketAddr>, FetchError> {
        if url.contains("/private") {
            return Err(FetchError::InvalidLink);
        }
        let port = reqwest::Url::parse(&url).unwrap().port().unwrap();
        Ok(vec![SocketAddr::from(([127, 0, 0, 1], port))])
    }

    #[tokio::test]
    async fn a_hop_connects_only_to_the_checked_address() {
        let port = serve().await;
        // `.invalid` never resolves: the request can only land where the check pointed it.
        let done = follow_checked(&remote(format!("http://pinned.invalid:{port}/b")), None, no_private).await.unwrap();
        assert_eq!(done.url, format!("http://pinned.invalid:{port}/b"));
    }

    #[tokio::test]
    async fn every_hop_is_checked_and_the_final_url_is_returned() {
        let port = serve().await;
        let done = follow_checked(&remote(format!("http://127.0.0.1:{port}/a")), None, no_private).await.unwrap();
        assert_eq!(done.url, format!("http://127.0.0.1:{port}/b"));
        assert_eq!(done.headers.len(), 2, "same host keeps its headers");

        let refused = follow_checked(&remote(format!("http://127.0.0.1:{port}/to-private")), None, no_private).await;
        assert_eq!(refused, Err(FetchError::InvalidLink));
        let refused = follow_checked(&remote(format!("http://127.0.0.1:{port}/loop")), None, no_private).await;
        assert_eq!(refused, Err(FetchError::InvalidLink), "redirect loops end");
    }

    #[tokio::test]
    async fn credentials_do_not_follow_a_redirect_to_another_host() {
        let port = serve().await;
        let app = Router::new().route(
            "/hop",
            get(move || async move { (StatusCode::FOUND, [(header::LOCATION, format!("http://localhost:{port}/b"))]) }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let hop_port = listener.local_addr().unwrap().port();
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let done = follow_checked(&remote(format!("http://127.0.0.1:{hop_port}/hop")), None, no_private).await.unwrap();
        assert_eq!(done.url, format!("http://localhost:{port}/b"));
        assert_eq!(done.headers, [("Referer".to_string(), "https://x/".to_string())]);
    }
}

#[test]
fn bare_url_drops_credentials_query_and_fragment() {
    assert_eq!(nuvo_fetch::link::bare_url("https://user:pw@example.com/watch?v=abc&token=s#t=1"), "https://example.com/watch");
    assert_eq!(nuvo_fetch::link::bare_url("not a url"), "");
}

#[tokio::test]
async fn a_failing_media_response_is_unavailable() {
    use axum::http::StatusCode;
    use axum::routing::get;
    let app = axum::Router::new().route("/gone", get(|| async { StatusCode::NOT_FOUND }));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    let remote = nuvo_fetch::Remote { url: format!("http://127.0.0.1:{port}/gone"), headers: vec![] };
    let result = nuvo_fetch::link::follow_checked(&remote, None, |_| async move { Ok(vec![std::net::SocketAddr::from(([127, 0, 0, 1], port))]) }).await;
    assert_eq!(result, Err(FetchError::Unavailable));
}

#[tokio::test]
async fn a_fresh_youtube_stream_url_is_retried_until_the_cdn_accepts_it() {
    use axum::extract::State;
    use axum::http::StatusCode;
    use axum::routing::get;
    use std::sync::Arc;
    use std::sync::atomic::{AtomicUsize, Ordering};
    let hits = Arc::new(AtomicUsize::new(0));
    let app = axum::Router::new()
        .route(
            "/videoplayback",
            get(|State(hits): State<Arc<AtomicUsize>>| async move {
                if hits.fetch_add(1, Ordering::SeqCst) < 2 { StatusCode::FORBIDDEN } else { StatusCode::PARTIAL_CONTENT }
            }),
        )
        .with_state(hits.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    let fixture: serde_json::Value = serde_json::from_str(include_str!("fixtures/ytdlp-youtube.json")).unwrap();
    let resolved = nuvo_fetch::ytdlp::parse_info(fixture.to_string().as_bytes()).unwrap();
    let query = resolved.remote.url.split_once('?').unwrap().1;
    let remote = nuvo_fetch::Remote { url: format!("http://127.0.0.1:{port}/videoplayback?{query}"), headers: resolved.remote.headers };
    let done = nuvo_fetch::link::follow_checked(&remote, None, |_| async move { Ok(vec![std::net::SocketAddr::from(([127, 0, 0, 1], port))]) }).await;
    assert_eq!(done.map(|r| r.url), Ok(remote.url.clone()));
    assert_eq!(hits.load(Ordering::SeqCst), 3);
}
