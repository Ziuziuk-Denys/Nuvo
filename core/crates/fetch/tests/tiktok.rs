use axum::Router;
use axum::extract::Path;
use axum::http::{HeaderMap, StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use nuvo_crypto::{base64_decode, base64_encode};
use nuvo_fetch::tiktok::{parse_post, post_id, rehydration, solve_challenge};
use nuvo_fetch::{FetchError, Remote, TikTok};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

const PAGE: &str = include_str!("fixtures/tiktok-post.html");
const POST: &str = "6718335390845095173";
const CHALLENGED: &str = "7000000000000000002";
const PREFIX: &[u8] = b"nuvo-test-prefix";
const ANSWER: u32 = 4321;

fn challenge_page() -> String {
    let digest = Sha256::digest([PREFIX, ANSWER.to_string().as_bytes()].concat());
    let puzzle = json!({"v": {"a": base64_encode(PREFIX), "c": base64_encode(&digest)}, "s": "server-state"});
    format!(
        r#"<html><body><p id="cs" class="{}"></p><p id="wci" class="_wafchallengeid"></p><p id="rci" class="waforiginalreid"></p><p id="rs" class="rs-value"></p><script>/* solver */</script></body></html>"#,
        base64_encode(puzzle.to_string().as_bytes())
    )
}

fn solved(headers: &HeaderMap) -> bool {
    let cookies = headers.get(header::COOKIE).and_then(|v| v.to_str().ok()).unwrap_or("");
    let Some(value) = cookies.split("; ").find_map(|c| c.strip_prefix("_wafchallengeid=")) else { return false };
    let answer: Value = serde_json::from_slice(&base64_decode(value).unwrap()).unwrap();
    answer["d"] == base64_encode(ANSWER.to_string().as_bytes()) && answer["s"] == "server-state" && cookies.contains("waforiginalreid=rs-value")
}

async fn page(Path((_user, id)): Path<(String, String)>, headers: HeaderMap) -> Response {
    let html = |body: String| ([(header::SET_COOKIE, "tt_chain_token=chain; Path=/; Secure")], [(header::CONTENT_TYPE, "text/html")], body).into_response();
    match id.as_str() {
        POST => html(PAGE.to_string()),
        CHALLENGED if solved(&headers) => html(PAGE.to_string()),
        CHALLENGED => html(challenge_page()),
        "7000000000000000003" => html("<html><body>Please wait...</body></html>".into()),
        "7000000000000000004" => html(PAGE.replace(r#""statusCode":0,"statusMsg":"""#, r#""statusCode":10204,"statusMsg":"item doesn't exist""#)),
        "7000000000000000006" => html("x".repeat(5 * 1024 * 1024)),
        _ => StatusCode::FORBIDDEN.into_response(),
    }
}

async fn mock() -> String {
    let app = Router::new()
        .route("/{user}/video/{id}", get(page))
        .route("/t/short/", get(|| async { (StatusCode::MOVED_PERMANENTLY, [(header::LOCATION, format!("/@scout2015/video/{POST}?lang=en"))]) }))
        .route("/t/elsewhere/", get(|| async { (StatusCode::FOUND, [(header::LOCATION, format!("http://example.invalid/@x/video/{POST}"))]) }));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    format!("http://{addr}")
}

#[test]
fn reads_post_ids_from_links() {
    assert_eq!(post_id("https://www.tiktok.com/@scout2015/video/6718335390845095173?is_from_webapp=1").as_deref(), Some(POST));
    assert_eq!(post_id("https://www.tiktok.com/@a/photo/7234567890123456789").as_deref(), Some("7234567890123456789"));
    assert_eq!(post_id("https://m.tiktok.com/v/7234567890123456789.html").as_deref(), Some("7234567890123456789"));
    assert_eq!(post_id("https://vm.tiktok.com/ZSabc123/"), None);
    assert_eq!(post_id("https://www.tiktok.com/@a/video/123"), None, "too short for a post id");
}

#[test]
fn parses_the_saved_page() {
    let data = rehydration(PAGE).unwrap();
    let post = parse_post(&data, POST, &[("tt_chain_token".into(), "chain".into())]).unwrap();
    assert_eq!(post.id, POST);
    assert_eq!(post.duration_ms, 10_000);
    assert!(post.title.starts_with("Scramble up ur name"));
    assert_eq!(
        post.video,
        Some(Remote {
            url: "https://v16-webapp-prime.tiktok.com/video/tos/alisg/a9d18e19/?mime_type=video_mp4".into(),
            headers: vec![("Referer".into(), "https://www.tiktok.com/".into()), ("Cookie".into(), "tt_chain_token=chain".into())],
        })
    );
    let sound = post.sound.unwrap();
    assert_eq!(sound.remote.url, "https://v45.tiktokcdn-eu.com/7890c6a2/video/tos/useast2a/music.mp3");
    assert_eq!(sound.remote.headers, vec![("Referer".to_string(), "https://www.tiktok.com/".to_string()), ("Cookie".to_string(), "tt_chain_token=chain".to_string())]);
    assert_eq!((sound.title.as_str(), sound.author.as_str(), sound.duration_ms, sound.original), ("original sound", "tiff", 10_000, true));
}

#[test]
fn named_sounds_photo_posts_and_restricted_posts() {
    let named = PAGE.replace(r#""title":"original sound","authorName":"tiff","original":true"#, r#""title":"I Will Survive","authorName":"Gloria Gaynor","original":false"#);
    let sound = parse_post(&rehydration(&named).unwrap(), POST, &[]).unwrap().sound.unwrap();
    assert!(!sound.original);
    assert_eq!((sound.title.as_str(), sound.author.as_str()), ("I Will Survive", "Gloria Gaynor"));

    let russian = PAGE.replace(r#""title":"original sound","authorName":"tiff","original":true"#, r#""title":"оригинальный звук - tiff","authorName":"tiff""#);
    assert!(parse_post(&rehydration(&russian).unwrap(), POST, &[]).unwrap().sound.unwrap().original);

    let mut photo = rehydration(PAGE).unwrap();
    let item = &mut photo["__DEFAULT_SCOPE__"]["webapp.video-detail"]["itemInfo"]["itemStruct"];
    item["video"] = json!({"duration": 0});
    let post = parse_post(&photo, POST, &[]).unwrap();
    assert!(post.video.is_none() && post.sound.is_some());

    let mut gated = rehydration(PAGE).unwrap();
    gated["__DEFAULT_SCOPE__"]["webapp.video-detail"]["itemInfo"]["itemStruct"]["isContentClassified"] = json!(true);
    assert_eq!(parse_post(&gated, POST, &[]), Err(FetchError::AgeGated));

    let mut empty = rehydration(PAGE).unwrap();
    empty["__DEFAULT_SCOPE__"]["webapp.video-detail"]["itemInfo"]["itemStruct"] = json!({"author": {}});
    assert_eq!(parse_post(&empty, POST, &[]), Err(FetchError::Unavailable));
}

#[test]
fn solves_a_generated_challenge() {
    let cookies = solve_challenge(&challenge_page());
    assert_eq!(cookies.len(), 2);
    let (name, value) = &cookies[0];
    assert_eq!(name, "_wafchallengeid");
    let answer: Value = serde_json::from_slice(&base64_decode(value).unwrap()).unwrap();
    assert_eq!(answer["d"], base64_encode(b"4321"));
    assert_eq!(cookies[1], ("waforiginalreid".to_string(), "rs-value".to_string()));
    assert!(solve_challenge(PAGE).is_empty(), "a normal page is no challenge");
    assert!(solve_challenge(r#"<p id="cs" class="!!!"></p>"#).is_empty());
}

#[tokio::test]
async fn fetches_posts_short_links_and_challenged_posts() {
    let base = mock().await;
    let tiktok = TikTok::new(&base);

    let post = tiktok.post(&format!("https://www.tiktok.com/@scout2015/video/{POST}")).await.unwrap();
    assert_eq!(post.video.unwrap().headers[1], ("Cookie".to_string(), "tt_chain_token=chain".to_string()));

    let short = tiktok.post(&format!("{base}/t/short/")).await.unwrap();
    assert_eq!(short.id, POST);

    let challenged = tiktok.post(&format!("https://www.tiktok.com/@a/video/{CHALLENGED}")).await.unwrap();
    let cookie = &challenged.video.unwrap().headers[1].1;
    assert!(cookie.contains("tt_chain_token=chain") && cookie.contains("_wafchallengeid="), "{cookie}");
}

#[tokio::test]
async fn failures_map_to_error_codes() {
    let base = mock().await;
    let tiktok = TikTok::new(&base);
    let post = |id: &str| format!("https://www.tiktok.com/@a/video/{id}");
    assert_eq!(tiktok.post(&post("7000000000000000003")).await, Err(FetchError::Blocked));
    assert_eq!(tiktok.post(&post("7000000000000000004")).await, Err(FetchError::Unavailable));
    assert_eq!(tiktok.post(&post("7000000000000000005")).await, Err(FetchError::Blocked));
    assert_eq!(tiktok.post(&format!("{base}/t/elsewhere/")).await, Err(FetchError::Unavailable), "redirects leave only to TikTok");
    assert!(matches!(TikTok::new("http://127.0.0.1:9").post(&post(POST)).await, Err(FetchError::Network(_))));
}

#[tokio::test]
async fn rejects_invalid_initial_urls_without_request() {
    let tiktok = TikTok::new("https://www.tiktok.com");
    assert_eq!(tiktok.post("http://127.0.0.1:8080/x").await, Err(FetchError::Unavailable), "http ip rejected");
    assert_eq!(tiktok.post("http://www.tiktok.com/@a/video/6718335390845095173").await, Err(FetchError::Unavailable), "http not https");
    assert_eq!(tiktok.post("https://evil.com/@a/video/6718335390845095173").await, Err(FetchError::Unavailable), "non-tiktok host rejected");
}

#[test]
fn attaches_cookies_only_to_tiktok_family_urls() {
    let data = rehydration(PAGE).unwrap();
    let cookies = [("tt_chain_token".into(), "chain".into())];

    let post = parse_post(&data, POST, &cookies).unwrap();
    let video_headers = post.video.unwrap().headers;
    assert!(video_headers.iter().any(|(k, v)| k == "Cookie" && v.contains("chain")), "tiktok video has cookie");

    let sound_headers = post.sound.unwrap().remote.headers;
    assert!(sound_headers.iter().any(|(k, v)| k == "Cookie" && v.contains("chain")), "tiktok cdn sound has cookie");

    let mut non_tiktok = rehydration(PAGE).unwrap();
    non_tiktok["__DEFAULT_SCOPE__"]["webapp.video-detail"]["itemInfo"]["itemStruct"]["video"]["playAddr"] = json!("https://evil.com/video.mp4");
    let post = parse_post(&non_tiktok, POST, &cookies).unwrap();
    let video_headers = post.video.unwrap().headers;
    assert!(!video_headers.iter().any(|(k, _)| k == "Cookie"), "non-tiktok video has no cookie");

    let mut non_tiktok_sound = rehydration(PAGE).unwrap();
    non_tiktok_sound["__DEFAULT_SCOPE__"]["webapp.video-detail"]["itemInfo"]["itemStruct"]["music"]["playUrl"] = json!("https://evil.com/audio.mp3");
    let post = parse_post(&non_tiktok_sound, POST, &cookies).unwrap();
    let sound_headers = post.sound.unwrap().remote.headers;
    assert!(!sound_headers.iter().any(|(k, _)| k == "Cookie"), "non-tiktok sound has no cookie");
}

#[test]
fn licensed_sounds_carry_their_album_and_foreign_original_sounds_are_original() {
    let page = include_str!("fixtures/tiktok-licensed.html");
    let sound = parse_post(&rehydration(page).unwrap(), "7000000000000000011", &[]).unwrap().sound.unwrap();
    assert_eq!((sound.title.as_str(), sound.author.as_str(), sound.album.as_deref(), sound.original), ("I Will Survive", "Gloria Gaynor", Some("Love Tracks"), false));
    assert_eq!(sound.duration_ms, 60_000, "the clip length, never the song's");

    let original = parse_post(&rehydration(PAGE).unwrap(), POST, &[]).unwrap().sound.unwrap();
    assert_eq!(original.album, None);
    for title in ["som original - tiff", "Sonido original - tiff", "оригінальний звук - tiff"] {
        let page = page.replace(r#""title":"I Will Survive""#, &format!(r#""title":"{title}""#));
        assert!(parse_post(&rehydration(&page).unwrap(), "7000000000000000011", &[]).unwrap().sound.unwrap().original, "{title}");
    }
}

#[tokio::test]
async fn an_oversized_page_is_refused() {
    let base = mock().await;
    let result = TikTok::new(&base).post(&format!("{base}/@a/video/7000000000000000006")).await;
    assert!(matches!(result, Err(FetchError::Network(message)) if message.contains("too large")));
}
