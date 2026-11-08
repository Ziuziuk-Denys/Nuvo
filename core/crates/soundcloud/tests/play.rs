mod common;

use std::time::Duration;

use common::{ID_A, api, setup, track};
use nuvo_contracts::iso_from_ms;
use nuvo_net::fixture::{Fixture, Reply};
use nuvo_soundcloud::hls::{self, HlsError, Playlist};
use nuvo_soundcloud::play::{self, Playable, expiry_ms};
use nuvo_soundcloud::{Limits, Reason, ScError, SoundCloud};
use serde_json::{Value, json};

const CDN: &str = "https://cf-media.sndcdn.com";
const HLS: &str = "https://cf-hls-media.sndcdn.com";
const POLICY_2000000000: &str = "eyJTdGF0ZW1lbnQiOlt7IlJlc291cmNlIjoiaHR0cHM6Ly9jZi1tZWRpYS5zbmRjZG4uY29tL3guMTI4Lm1wMyoiLCJDb25kaXRpb24iOnsiRGF0ZUxlc3NUaGFuIjp7IkFXUzpFcG9jaFRpbWUiOjIwMDAwMDAwMDB9fX1dfQ__";

fn tc(name: &str, protocol: &str, mime: &str, preset: &str) -> Value {
    json!({"url": api(&format!("media/1/{name}")), "preset": preset, "snipped": false, "format": {"protocol": protocol, "mime_type": mime}})
}

fn record(transcodings: Vec<Value>) -> Value {
    let mut record = track(1, "Song", 200_000);
    record["media"] = json!({"transcodings": transcodings});
    record
}

async fn ready(record: Value) -> (Fixture, SoundCloud) {
    let (fx, sc) = setup().await;
    sc.set_client_id(Some(ID_A.into()));
    fx.on(&api("tracks/1"), Reply::json(record));
    (fx, sc)
}

/// Media URL answer for transcoding `name`.
fn media(fx: &Fixture, name: &str, url: &str) {
    fx.on(&api(&format!("media/1/{name}")), Reply::json(json!({"url": url})));
}

fn playlist(fx: &Fixture, path: &str, body: &str) {
    fx.on(&format!("{HLS}{path}"), Reply::bytes("application/vnd.apple.mpegurl", body.to_string()));
}

fn segment(fx: &Fixture, path: &str, bytes: &[u8]) {
    fx.on(&format!("{HLS}{path}"), Reply::bytes("audio/mp4", bytes.to_vec()));
}

#[test]
fn formats_follow_mime_and_preset() {
    let f = play::format_of("aac_160k", "audio/mp4; codecs=\"mp4a.40.2\"");
    assert_eq!((f.codec, f.mime, f.bitrate), ("aac", "audio/mp4", 160_000));
    let f = play::format_of("opus_0_0", "audio/ogg; codecs=\"opus\"");
    assert_eq!((f.codec, f.mime, f.bitrate), ("opus", "audio/ogg; codecs=\"opus\"", 64_000));
    let f = play::format_of("mp3_1_0", "audio/mpeg");
    assert_eq!((f.codec, f.bitrate), ("mp3", 128_000));
    assert_eq!(play::format_of("abr_sq", "audio/mpegurl").codec, "mp3");
}

/// The parsing level.
#[test]
fn signed_url_expiry() {
    let now = 1_800_000_000_000;
    assert_eq!(expiry_ms("https://cf-media.sndcdn.com/a.mp3?Expires=1900000000&Signature=x", now), 1_900_000_000_000);
    assert_eq!(expiry_ms("https://cf-media.sndcdn.com/a.mp3?expires=1900000000", now), 1_900_000_000_000);
    assert_eq!(expiry_ms(&format!("https://cf-media.sndcdn.com/a.mp3?Policy={POLICY_2000000000}&Key-Pair-Id=k"), now), 2_000_000_000_000);
    assert_eq!(expiry_ms("https://cf-media.sndcdn.com/a.mp3", now), now + 240_000);
    assert_eq!(expiry_ms("https://cf-media.sndcdn.com/a.mp3?Expires=1000", now), now + 240_000, "past expiry");
    assert_eq!(expiry_ms("https://cf-media.sndcdn.com/a.mp3?Policy=%%%", now), now + 240_000);
    assert_eq!(expiry_ms("not a url", now), now + 240_000);
}

#[test]
fn playlists_parse() {
    let base = nuvo_net::Url::parse("https://cf-hls-media.sndcdn.com/playlist/a/list.m3u8?sig=1").unwrap();
    let media = "#EXTM3U\r\n#EXT-X-VERSION:6\r\n\r\n#EXT-X-MAP:URI=\"init.mp4\"\r\n#EXTINF:10,\r\nseg0.m4s\r\n#EXTINF:10,\r\n/media/seg1.m4s\r\n";
    assert_eq!(
        hls::parse(media, &base).unwrap(),
        Playlist::Media {
            init: Some(base.join("init.mp4").unwrap()),
            segments: vec![base.join("seg0.m4s").unwrap(), nuvo_net::Url::parse("https://cf-hls-media.sndcdn.com/media/seg1.m4s").unwrap()],
        }
    );
    assert_eq!(hls::parse("#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nv.m3u8\n", &base).unwrap(), Playlist::Master(base.join("v.m3u8").unwrap()));
    assert_eq!(hls::parse("#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\n", &base).unwrap_err(), HlsError::NoVariant);
    assert_eq!(hls::parse("#EXTM3U\n#EXT-X-ENDLIST\n", &base).unwrap_err(), HlsError::NoSegments);
    assert_eq!(hls::parse("<html>", &base).unwrap_err(), HlsError::NotAPlaylist);
    assert_eq!(hls::parse("#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI=\"k\"\na.ts\n", &base).unwrap_err(), HlsError::Encrypted);
    assert!(hls::parse("#EXTM3U\n#EXT-X-KEY:METHOD=NONE\na.ts\n", &base).is_ok());
}

#[tokio::test]
async fn candidates_are_tried_in_preference_order_and_unusable_ones_never() {
    let (fx, sc) = ready(record(vec![
        tc("hls-aac", "hls", "audio/mp4; codecs=\"mp4a.40.2\"", "aac_160k"),
        tc("prog-mp3", "progressive", "audio/mpeg", "mp3_1_0"),
        tc("hls-mp3", "hls", "audio/mpeg", "mp3_1_0"),
        tc("hls-opus", "hls", "audio/ogg; codecs=\"opus\"", "opus_0_0"),
        tc("enc-mp3", "ctr-encrypted-hls", "audio/mpeg", "mp3_1_0"),
        tc("hls-url", "hls", "audio/mpegurl", "abr_sq"),
    ]))
    .await;
    let mut sink = Vec::new();
    let err = sc.resolve("sc:1", &mut sink).await.unwrap_err();
    assert!(matches!(err, ScError::NotFound), "expected NotFound (from media requests), got {err:?}");
    let tried: Vec<String> = fx.log().into_iter().filter(|p| p.contains("/media/")).collect();
    assert_eq!(tried, ["api-v2.soundcloud.com/media/1/prog-mp3", "api-v2.soundcloud.com/media/1/hls-mp3", "api-v2.soundcloud.com/media/1/hls-aac", "api-v2.soundcloud.com/media/1/hls-opus"]);
}

/// Reuse of a `direct` answer.
#[tokio::test]
async fn progressive_resolves_to_a_direct_url() {
    let mut rec = record(vec![tc("prog", "progressive", "audio/mpeg", "mp3_1_0")]);
    rec["track_authorization"] = json!("tok-1");
    let (fx, sc) = ready(rec).await;
    media(&fx, "prog", &format!("{CDN}/a.128.mp3?Expires=1900000000&Signature=s"));
    let Playable::Direct { url, expires_ms, format } = sc.resolve("sc:1", &mut Vec::new()).await.unwrap() else { panic!("direct expected") };
    assert!(url.starts_with("https://cf-media.sndcdn.com/a.128.mp3"));
    assert_eq!((format.codec, format.mime, format.bitrate), ("mp3", "audio/mpeg", 128_000));
    assert_eq!(iso_from_ms(expires_ms), "2030-03-17T17:46:40.000Z");
    let hit = &fx.hits(&api("media/1/prog"))[0];
    assert_eq!((hit.query["track_authorization"].as_str(), hit.query["client_id"].as_str()), ("tok-1", ID_A));
    let before = fx.total();
    sc.resolve("sc:1", &mut Vec::new()).await.unwrap();
    assert_eq!(fx.total(), before, "a direct answer is reused until shortly before it expires");
}

#[tokio::test]
async fn unsigned_progressive_urls_live_four_minutes() {
    let (fx, sc) = ready(record(vec![tc("prog", "progressive", "audio/mpeg", "mp3_1_0")])).await;
    media(&fx, "prog", &format!("{CDN}/a.mp3"));
    let before = play::now_ms();
    let Playable::Direct { expires_ms, .. } = sc.resolve("sc:1", &mut Vec::new()).await.unwrap() else { panic!() };
    assert!(expires_ms >= before + 240_000 && expires_ms <= play::now_ms() + 240_000);
}

#[tokio::test]
async fn cloudfront_policies_give_the_expiry() {
    let (fx, sc) = ready(record(vec![tc("prog", "progressive", "audio/mpeg", "mp3_1_0")])).await;
    media(&fx, "prog", &format!("{CDN}/x.128.mp3?Policy={POLICY_2000000000}&Signature=s&Key-Pair-Id=k"));
    let Playable::Direct { expires_ms, .. } = sc.resolve("sc:1", &mut Vec::new()).await.unwrap() else { panic!() };
    assert_eq!(expires_ms, 2_000_000_000_000);
}

#[tokio::test]
async fn hls_is_assembled_in_order_after_a_failed_progressive() {
    let (fx, sc) = ready(record(vec![tc("prog", "progressive", "audio/mpeg", "mp3_1_0"), tc("hls-aac", "hls", "audio/mp4; codecs=\"mp4a.40.2\"", "aac_160k")])).await;
    fx.on(&api("media/1/prog"), Reply::status(500));
    media(&fx, "hls-aac", &format!("{HLS}/a/list.m3u8?sig=1"));
    playlist(&fx, "/a/list.m3u8", "#EXTM3U\n#EXT-X-MAP:URI=\"init.mp4\"\n#EXTINF:1,\ns0.m4s\n#EXTINF:1,\ns1.m4s\n#EXTINF:1,\ns2.m4s\n#EXT-X-ENDLIST\n");
    segment(&fx, "/a/init.mp4", b"II");
    segment(&fx, "/a/s0.m4s", b"a");
    segment(&fx, "/a/s1.m4s", b"bb");
    segment(&fx, "/a/s2.m4s", b"c");
    let mut sink = Vec::new();
    let Playable::Assembled { bytes, format } = sc.resolve("sc:1", &mut sink).await.unwrap() else { panic!("assembled expected") };
    assert_eq!(sink, b"IIabbc");
    assert_eq!((bytes, format.codec, format.bitrate), (6, "aac", 160_000));
}

fn hls_only(n: usize, delay: impl Fn(usize) -> Duration) -> (Value, Vec<(String, Reply)>) {
    let list: String = (0..n).map(|i| format!("#EXTINF:1,\ns{i}.ts\n")).collect();
    let mut routes = vec![(format!("{HLS}/b/list.m3u8"), Reply::bytes("application/vnd.apple.mpegurl", format!("#EXTM3U\n{list}")))];
    routes.extend((0..n).map(|i| (format!("{HLS}/b/s{i}.ts"), Reply::bytes("audio/mpeg", vec![i as u8]).after(delay(i)))));
    (record(vec![tc("hls-mp3", "hls", "audio/mpeg", "mp3_1_0")]), routes)
}

async fn ready_hls(n: usize, delay: impl Fn(usize) -> Duration) -> (Fixture, SoundCloud) {
    let (rec, routes) = hls_only(n, delay);
    let (fx, sc) = ready(rec).await;
    media(&fx, "hls-mp3", &format!("{HLS}/b/list.m3u8"));
    for (url, reply) in routes {
        fx.on(&url, reply);
    }
    (fx, sc)
}

#[tokio::test]
async fn output_follows_playlist_order_whatever_the_answer_order() {
    let (_fx, sc) = ready_hls(5, |i| Duration::from_millis(100 - 20 * i as u64)).await;
    let mut sink = Vec::new();
    sc.resolve("sc:1", &mut sink).await.unwrap();
    assert_eq!(sink, [0, 1, 2, 3, 4]);
}

#[tokio::test]
async fn at_most_six_segment_requests_are_open() {
    let (fx, sc) = ready_hls(12, |_| Duration::from_millis(80)).await;
    let mut sink = Vec::new();
    sc.resolve("sc:1", &mut sink).await.unwrap();
    assert_eq!(sink.len(), 12);
    assert_eq!(fx.max_in_flight(), 6);
}

/// A segment that fails twice moves on to the next transcoding.
#[tokio::test]
async fn a_segment_is_retried_once() {
    let (fx, sc) = ready_hls(3, |_| Duration::ZERO).await;
    fx.on_seq(&format!("{HLS}/b/s1.ts"), vec![Reply::status(503), Reply::bytes("audio/mpeg", vec![1])]);
    let mut sink = Vec::new();
    sc.resolve("sc:1", &mut sink).await.unwrap();
    assert_eq!((sink.as_slice(), fx.count(&format!("{HLS}/b/s1.ts"))), ([0u8, 1, 2].as_slice(), 2));

    let rec = record(vec![tc("hls-mp3", "hls", "audio/mpeg", "mp3_1_0"), tc("hls-opus", "hls", "audio/ogg; codecs=\"opus\"", "opus_0_0")]);
    let (fx, sc) = ready(rec).await;
    media(&fx, "hls-mp3", &format!("{HLS}/c/list.m3u8"));
    media(&fx, "hls-opus", &format!("{HLS}/d/list.m3u8"));
    playlist(&fx, "/c/list.m3u8", "#EXTM3U\na.ts\nb.ts\n");
    segment(&fx, "/c/a.ts", b"x");
    fx.on(&format!("{HLS}/c/b.ts"), Reply::status(500));
    playlist(&fx, "/d/list.m3u8", "#EXTM3U\no.opus\n");
    segment(&fx, "/d/o.opus", b"opus");
    let mut sink = Vec::new();
    let Playable::Assembled { format, .. } = sc.resolve("sc:1", &mut sink).await.unwrap() else { panic!() };
    assert_eq!((sink.as_slice(), format.codec), (b"opus".as_slice(), "opus"), "the half-written MP3 was discarded");
    assert_eq!(fx.count(&format!("{HLS}/c/b.ts")), 2);
}

#[tokio::test]
async fn master_playlists_nest_at_most_three_fetches_deep() {
    let (fx, sc) = ready(record(vec![tc("hls-mp3", "hls", "audio/mpeg", "mp3_1_0")])).await;
    media(&fx, "hls-mp3", &format!("{HLS}/m/1.m3u8"));
    playlist(&fx, "/m/1.m3u8", "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\n2.m3u8\n");
    playlist(&fx, "/m/2.m3u8", "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\n3.m3u8\n");
    playlist(&fx, "/m/3.m3u8", "#EXTM3U\nseg.ts\n");
    segment(&fx, "/m/seg.ts", b"z");
    let mut sink = Vec::new();
    sc.resolve("sc:1", &mut sink).await.unwrap();
    assert_eq!(sink, b"z");
    playlist(&fx, "/m/3.m3u8", "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\n4.m3u8\n");
    playlist(&fx, "/m/4.m3u8", "#EXTM3U\nseg.ts\n");
    assert!(matches!(sc.resolve("sc:1", &mut Vec::new()).await, Err(ScError::Upstream(_))));
    assert_eq!(fx.count(&format!("{HLS}/m/4.m3u8")), 0);
}

#[tokio::test]
async fn encrypted_playlists_are_drm_and_html_is_a_failure() {
    let (fx, sc) = ready(record(vec![tc("hls-mp3", "hls", "audio/mpeg", "mp3_1_0")])).await;
    media(&fx, "hls-mp3", &format!("{HLS}/k/list.m3u8"));
    playlist(&fx, "/k/list.m3u8", "#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI=\"https://cf-hls-media.sndcdn.com/key\"\na.ts\n");
    assert_eq!(sc.resolve("sc:1", &mut Vec::new()).await.unwrap_err(), ScError::Unplayable(Reason::Drm));
    playlist(&fx, "/k/list.m3u8", "#EXTM3U\n#EXT-X-KEY:METHOD=NONE\na.ts\n");
    segment(&fx, "/k/a.ts", b"ok");
    assert!(sc.resolve("sc:1", &mut Vec::new()).await.is_ok());
    fx.on(&format!("{HLS}/k/list.m3u8"), Reply::bytes("text/html", "<!doctype html><html></html>"));
    assert!(matches!(sc.resolve("sc:1", &mut Vec::new()).await, Err(ScError::Upstream(_))));
}

async fn reason(rec: Value) -> Result<Playable, ScError> {
    let (_fx, sc) = ready(rec).await;
    sc.resolve("sc:1", &mut Vec::new()).await
}

#[tokio::test]
async fn availability_reasons() {
    let prog = || tc("prog", "progressive", "audio/mpeg", "mp3_1_0");
    let mut snip = record(vec![prog()]);
    snip["policy"] = json!("SNIP");
    assert_eq!(reason(snip).await.unwrap_err(), ScError::Unplayable(Reason::Preview));
    let mut snipped = prog();
    snipped["snipped"] = json!(true);
    assert_eq!(reason(record(vec![snipped.clone()])).await.unwrap_err(), ScError::Unplayable(Reason::Preview));
    let mut short = record(vec![prog()]);
    short["duration"] = json!(30_000);
    short["full_duration"] = json!(200_000);
    assert_eq!(reason(short).await.unwrap_err(), ScError::Unplayable(Reason::Preview));
    let mut nearly = record(vec![prog()]);
    nearly["duration"] = json!(198_000);
    nearly["full_duration"] = json!(200_000);
    assert_eq!(play::availability(&nearly), Ok(()));
    let mut blocked = record(vec![prog()]);
    blocked["policy"] = json!("block");
    assert_eq!(reason(blocked).await.unwrap_err(), ScError::Unplayable(Reason::RegionBlocked));
    let mut off = record(vec![prog()]);
    off["streamable"] = json!(false);
    assert_eq!(reason(off).await.unwrap_err(), ScError::Unplayable(Reason::StreamDisabled));
    let encrypted = tc("enc", "ctr-encrypted-hls", "audio/mpeg", "mp3_1_0");
    assert_eq!(reason(record(vec![snipped, encrypted])).await.unwrap_err(), ScError::Unplayable(Reason::NoFormat));
}

#[tokio::test]
async fn missing_tracks_and_foreign_ids_are_gone() {
    let (fx, sc) = setup().await;
    sc.set_client_id(Some(ID_A.into()));
    fx.on(&api("tracks/404"), Reply::status(404));
    fx.on(&api("tracks/410"), Reply::status(410));
    fx.on(&api("tracks/403"), Reply::status(403));
    fx.on(&api("tracks/5"), Reply::json(json!({"title": "no id"})));
    for id in ["sc:5", "Ab3dE_fG9hI", "sc_user_77"] {
        let err = sc.resolve(id, &mut Vec::new()).await.unwrap_err();
        assert!(matches!(err, ScError::Unplayable(Reason::Gone)), "expected Gone for {id}, got {err:?}");
    }
    for id in ["sc:404", "sc:410"] {
        let err = sc.resolve(id, &mut Vec::new()).await.unwrap_err();
        assert!(matches!(err, ScError::Unplayable(Reason::Gone)), "expected Gone for {id}, got {err:?}");
    }
    assert_eq!(sc.resolve("sc:403", &mut Vec::new()).await.unwrap_err(), ScError::Unplayable(Reason::RegionBlocked));
    assert_eq!(fx.count(&api("tracks/77")), 0);
    fx.on(&api("tracks/77"), Reply::json(record(vec![])));
    for id in ["sc:77", "soundcloud:tracks:77", "soundcloud:77", "77"] {
        sc.resolve(id, &mut Vec::new()).await.unwrap_err();
    }
    assert_eq!(fx.count(&api("tracks/77")), 1, "the record cache serves the repeats");
}

#[tokio::test]
async fn cancelling_aborts_segment_downloads_and_tries_nothing_else() {
    let rec = record(vec![tc("hls-mp3", "hls", "audio/mpeg", "mp3_1_0"), tc("hls-opus", "hls", "audio/ogg; codecs=\"opus\"", "opus_0_0")]);
    let (fx, sc) = ready(rec).await;
    media(&fx, "hls-mp3", &format!("{HLS}/b/list.m3u8"));
    let list: String = (0..12).map(|i| format!("s{i}.ts\n")).collect();
    playlist(&fx, "/b/list.m3u8", &format!("#EXTM3U\n{list}"));
    for i in 0..12 {
        fx.on(&format!("{HLS}/b/s{i}.ts"), Reply::bytes("audio/mpeg", vec![1]).after(Duration::from_secs(30)));
    }
    let job = tokio::spawn(async move { sc.resolve("sc:1", &mut Vec::new()).await });
    while fx.max_in_flight() < 6 {
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    job.abort();
    assert!(job.await.unwrap_err().is_cancelled());
    tokio::time::sleep(Duration::from_millis(200)).await;
    let segments = fx.log().iter().filter(|p| p.ends_with(".ts")).count();
    assert_eq!(segments, 6, "nothing new starts after cancellation");
    assert_eq!(fx.count(&api("media/1/hls-opus")), 0);
}

#[tokio::test]
async fn assembled_size_cap_and_timeouts_are_enforced() {
    let limits = Limits { segment_timeout: Duration::from_millis(100), ..common::FAST };
    let (fx, _) = ready_hls(2, |i| if i == 1 { Duration::from_secs(2) } else { Duration::ZERO }).await;
    let sc = SoundCloud::new(fx.net(), limits);
    sc.set_client_id(Some(ID_A.into()));
    assert!(matches!(sc.resolve("sc:1", &mut Vec::new()).await, Err(ScError::Timeout)));
    assert_eq!(fx.count(&format!("{HLS}/b/s1.ts")), 2);
    assert_eq!(hls::MAX_ASSEMBLED_BYTES, 300 * 1024 * 1024);
}

/// Segment retry policy: 5xx and 429 retry once, 404 fails at once.
#[tokio::test]
async fn segment_retry_policy_respects_status_codes() {
    let (fx, sc) = ready(record(vec![tc("hls-mp3", "hls", "audio/mpeg", "mp3_1_0")])).await;
    media(&fx, "hls-mp3", &format!("{HLS}/a/list.m3u8?sig=1"));
    playlist(&fx, "/a/list.m3u8", "#EXTM3U\n#EXT-X-MAP:URI=\"init.mp4\"\n#EXTINF:1,\ns0.m4s\n#EXT-X-ENDLIST\n");
    segment(&fx, "/a/init.mp4", b"II");

    fx.on_seq(&format!("{HLS}/a/s0.m4s"), vec![Reply::status(503), Reply::bytes("audio/mp4", b"ok")]);
    let mut sink = Vec::new();
    sc.resolve("sc:1", &mut sink).await.unwrap();
    assert_eq!(fx.count(&format!("{HLS}/a/s0.m4s")), 2, "5xx status retries once");

    let (fx2, sc2) = ready(record(vec![tc("hls-mp3", "hls", "audio/mpeg", "mp3_1_0")])).await;
    media(&fx2, "hls-mp3", &format!("{HLS}/b/list.m3u8?sig=1"));
    playlist(&fx2, "/b/list.m3u8", "#EXTM3U\n#EXT-X-MAP:URI=\"init.mp4\"\n#EXTINF:1,\ns0.m4s\n#EXT-X-ENDLIST\n");
    segment(&fx2, "/b/init.mp4", b"II");
    fx2.on_seq(&format!("{HLS}/b/s0.m4s"), vec![Reply::status(429), Reply::bytes("audio/mp4", b"ok")]);
    let mut sink = Vec::new();
    sc2.resolve("sc:1", &mut sink).await.unwrap();
    assert_eq!(fx2.count(&format!("{HLS}/b/s0.m4s")), 2, "429 status retries once");

    let (fx3, sc3) = ready(record(vec![tc("hls-mp3", "hls", "audio/mpeg", "mp3_1_0")])).await;
    media(&fx3, "hls-mp3", &format!("{HLS}/c/list.m3u8?sig=1"));
    playlist(&fx3, "/c/list.m3u8", "#EXTM3U\n#EXT-X-MAP:URI=\"init.mp4\"\n#EXTINF:1,\ns0.m4s\n#EXT-X-ENDLIST\n");
    segment(&fx3, "/c/init.mp4", b"II");
    fx3.on(&format!("{HLS}/c/s0.m4s"), Reply::status(404));
    let mut sink = Vec::new();
    assert!(sc3.resolve("sc:1", &mut sink).await.is_err());
    assert_eq!(fx3.count(&format!("{HLS}/c/s0.m4s")), 1, "404 fails at once without retry");
}

/// Progressive URL must be https from an allowed host.
#[tokio::test]
async fn progressive_urls_must_be_https_from_allowed_hosts() {
    let (fx, sc) = ready(record(vec![tc("prog", "progressive", "audio/mpeg", "mp3_1_0")])).await;
    media(&fx, "prog", "http://cf-media.sndcdn.com/a.mp3");
    assert_eq!(sc.resolve("sc:1", &mut Vec::new()).await.unwrap_err(), ScError::Upstream("progressive URL is not https or not from an allowed host".into()));

    media(&fx, "prog", "https://evil.com/a.mp3");
    assert_eq!(sc.resolve("sc:1", &mut Vec::new()).await.unwrap_err(), ScError::Upstream("progressive URL is not https or not from an allowed host".into()));
}

/// Byte range segments are unsupported.
#[test]
fn byte_range_segments_are_rejected() {
    let base = nuvo_net::Url::parse("https://cf-hls-media.sndcdn.com/p/a/list.m3u8").unwrap();
    assert_eq!(hls::parse("#EXTM3U\na.m4s\n#EXT-X-BYTERANGE:1024@0\nb.m4s\n", &base).unwrap_err(), HlsError::Unsupported("byte range segments not supported".into()));
}

/// #EXT-X-KEY with no METHOD is treated as encrypted (fail closed).
#[test]
fn ext_x_key_without_method_is_encrypted() {
    let base = nuvo_net::Url::parse("https://cf-hls-media.sndcdn.com/p/a/list.m3u8").unwrap();
    assert_eq!(hls::parse("#EXTM3U\n#EXT-X-KEY:URI=\"k\"\na.ts\n", &base).unwrap_err(), HlsError::Encrypted);
    assert!(hls::parse("#EXTM3U\n#EXT-X-KEY:METHOD=NONE\na.ts\n", &base).is_ok());
    assert_eq!(hls::parse("#EXTM3U\n#EXT-X-KEY:URI=\"x?METHOD=NONE\",METHOD=AES-128\na.ts\n", &base).unwrap_err(), HlsError::Encrypted, "quoted METHOD in URI does not bypass real METHOD");
    assert_eq!(hls::parse("#EXTM3U\n#EXT-X-KEY:URI=\"ключ\",METHOD=AES-128\na.ts\n", &base).unwrap_err(), HlsError::Encrypted, "multibyte text before METHOD neither panics nor hides it");
}

/// #EXT-X-SESSION-KEY with METHOD other than NONE is rejected.
#[test]
fn ext_x_session_key_must_be_none() {
    let base = nuvo_net::Url::parse("https://cf-hls-media.sndcdn.com/p/a/list.m3u8").unwrap();
    assert_eq!(hls::parse("#EXTM3U\n#EXT-X-SESSION-KEY:METHOD=AES-128\n#EXT-X-STREAM-INF:BANDWIDTH=1\nv.m3u8\n", &base).unwrap_err(), HlsError::Encrypted);
}

/// HLS playlists with too many segments are rejected.
#[test]
fn too_many_segments_are_rejected() {
    let base = nuvo_net::Url::parse("https://cf-hls-media.sndcdn.com/p/a/list.m3u8").unwrap();
    let segments: String = (0..5001).map(|i| format!("s{i}.m4s\n")).collect();
    assert_eq!(hls::parse(&format!("#EXTM3U\n{segments}"), &base).unwrap_err(), HlsError::TooManySegments);
    let segments: String = (0..5000).map(|i| format!("s{i}.m4s\n")).collect();
    assert!(hls::parse(&format!("#EXTM3U\n{segments}"), &base).is_ok());
}

/// Direct answer within 30 s before expiry is not reused.
#[tokio::test]
async fn direct_reuse_respects_margin() {
    let (fx, sc) = ready(record(vec![tc("prog", "progressive", "audio/mpeg", "mp3_1_0")])).await;
    let now_s = (play::now_ms() / 1000) as u64;
    let expires_s = now_s + 60;
    media(&fx, "prog", &format!("{CDN}/a.128.mp3?Expires={expires_s}"));
    sc.resolve("sc:1", &mut Vec::new()).await.unwrap();
    let count_before = fx.total();
    std::thread::sleep(Duration::from_millis(50));
    sc.resolve("sc:1", &mut Vec::new()).await.unwrap();
    assert_eq!(fx.total(), count_before, "cached answer reused when 60 s until expiry");

    let (fx2, sc2) = ready(record(vec![tc("prog", "progressive", "audio/mpeg", "mp3_1_0")])).await;
    let now_s = (play::now_ms() / 1000) as u64;
    let expires_s = now_s + 20;
    media(&fx2, "prog", &format!("{CDN}/a.128.mp3?Expires={expires_s}"));
    sc2.resolve("sc:1", &mut Vec::new()).await.unwrap();
    let count_before = fx2.total();
    std::thread::sleep(Duration::from_millis(50));
    sc2.resolve("sc:1", &mut Vec::new()).await.unwrap();
    assert!(fx2.total() > count_before, "cached answer not reused when 20 s until expiry (within 30 s margin)");
}

/// Direct cache is bounded at 500 entries.
#[tokio::test]
async fn direct_cache_is_bounded() {
    let (fx, sc) = setup().await;
    sc.set_client_id(Some(ID_A.into()));
    for id in 1..=501 {
        let mut rec = track(id, "Song", 200_000);
        rec["media"] = json!({"transcodings": vec![tc("prog", "progressive", "audio/mpeg", "mp3_1_0")]});
        rec["track_authorization"] = json!("tok");
        fx.on(&api(&format!("tracks/{id}")), Reply::json(rec));
        media(&fx, "prog", &format!("{CDN}/a{id}.mp3?Expires=1900000000"));
    }
    for id in 1..=501 {
        sc.resolve(&format!("sc:{id}"), &mut Vec::new()).await.unwrap();
    }
    let before = fx.total();
    sc.resolve("sc:1", &mut Vec::new()).await.unwrap();
    assert!(fx.total() > before, "cache was cleared when full, so entry 1 required a new request");
}

/// Talks to the real SoundCloud. Run with `cargo test -p nuvo-soundcloud --test play -- --ignored`.
#[tokio::test]
#[ignore = "network: real SoundCloud"]
async fn live_soundcloud_discovery_lookup_and_stream() {
    let sc = SoundCloud::new(nuvo_net::Net::new(None), Limits::SOUNDCLOUD);
    let found = sc.lookup("https://soundcloud.com/forss/flickermood", nuvo_soundcloud::TypeFilter::Track).await;
    let Some(nuvo_contracts::catalog::SearchResult::Track(track)) = found.first() else { panic!("lookup found nothing: {found:?}") };
    assert!(sc.client_id().is_some());
    let mut sink = Vec::new();
    match sc.resolve(&track.id, &mut sink).await.unwrap() {
        Playable::Direct { url, .. } => assert!(url.starts_with("https://")),
        Playable::Assembled { bytes, .. } => assert!(bytes > 10_000),
    }
}
