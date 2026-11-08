mod common;

use nuvo_recognize::signature::generate;
use nuvo_recognize::{Reply, Shazam, ShazamError, Song};

fn signature() -> nuvo_recognize::signature::Signature {
    generate(&common::pulsed_tone(1000.0, 192_000))
}

fn is_upper_uuid(text: &str) -> bool {
    let parts: Vec<&str> = text.split('-').collect();
    parts.iter().map(|p| p.len()).collect::<Vec<_>>() == [8, 4, 4, 4, 12]
        && text.chars().all(|c| c == '-' || c.is_ascii_digit() || c.is_ascii_uppercase())
        && &parts[2][..1] == "4"
}

#[tokio::test]
async fn sends_the_iphone_request_shape() {
    let mock = common::mock_shazam(vec![]).await;
    let shazam = Shazam::new(&mock.url, common::FAST);
    assert_eq!(shazam.send(&signature()).await.unwrap(), Reply::NotFound);

    let seen = mock.seen.lock().unwrap();
    let request = &seen[0];
    let (path, query) = request.uri.split_once('?').unwrap();
    let tag = path.strip_prefix("/discovery/v5/en-US/GB/iphone/-/tag/").unwrap();
    let (first, second) = tag.split_once('/').unwrap();
    assert!(is_upper_uuid(first) && is_upper_uuid(second), "{tag}");
    assert_ne!(first, second);
    assert_eq!(
        query,
        "sync=true&webv3=true&sampling=true&connected=&shazamapiversion=v3&sharehub=true&hubv5minorversion=v5.1&hidelb=true&video=v3"
    );
    assert_eq!(request.headers["x-shazam-platform"], "IPHONE");
    assert_eq!(request.headers["x-shazam-appversion"], "14.1.0");
    assert!(request.headers["user-agent"].to_str().unwrap().starts_with("Dalvik/"));
    let body = &request.body;
    assert_eq!(body["signature"]["samplems"], 12_000);
    assert!(body["signature"]["uri"].as_str().unwrap().starts_with("data:audio/vnd.shazam.sig;base64,gCX+"));
    assert!(body["timestamp"].as_u64().unwrap() > 1_700_000_000_000);
    assert_eq!(body["geolocation"], serde_json::json!({}));
    assert_eq!(body["context"], serde_json::json!({}));
}

#[tokio::test]
async fn parses_a_match() {
    let mock = common::mock_shazam(vec![(200, common::found())]).await;
    let reply = Shazam::new(&mock.url, common::FAST).send(&signature()).await.unwrap();
    let expected = Song {
        title: "I Will Survive".into(),
        artist: "Gloria Gaynor".into(),
        album: Some("Love Tracks".into()),
        released: Some("1978".into()),
        genre: Some("Pop".into()),
        isrc: Some("USUR10200634".into()),
        cover_url: Some("https://is1-ssl.mzstatic.com/image/thumb/Music123/v4/0c/72/a1/19UMGIM66006.rgb.jpg/600x600cc.jpg".into()),
        apple_music_url: Some("https://music.apple.com/gb/album/i-will-survive/1475006468?i=1475006475".into()),
        preview_url: Some("https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview221/mzaf_1.plus.aac.ep.m4a".into()),
        shazam_key: "53982678".into(),
        offset_ms: 92_905,
    };
    assert_eq!(reply, Reply::Found(Box::new(expected)));
}

#[tokio::test]
async fn a_track_without_its_key_fields_is_no_match() {
    let mut partial = common::found();
    partial["track"].as_object_mut().unwrap().remove("key");
    let mock = common::mock_shazam(vec![(200, partial)]).await;
    assert_eq!(Shazam::new(&mock.url, common::FAST).send(&signature()).await.unwrap(), Reply::NotFound);
}

#[tokio::test]
async fn rate_limits_and_server_errors_are_told_apart() {
    let mock = common::mock_shazam(vec![(429, serde_json::json!({})), (500, serde_json::json!({}))]).await;
    let shazam = Shazam::new(&mock.url, common::FAST);
    assert_eq!(shazam.send(&signature()).await.unwrap(), Reply::RateLimited);
    assert!(matches!(shazam.send(&signature()).await, Err(ShazamError::Status(500))));
    assert!(matches!(Shazam::new("http://127.0.0.1:9", common::FAST).send(&signature()).await, Err(ShazamError::Http(_))));
}

#[test]
fn recognized_tracks_serialize_flat_and_camel_case() {
    use nuvo_recognize::{InputInfo, InputKind, RecognizedTrack, Via};
    let track = RecognizedTrack {
        song: Song {
            title: "T".into(), artist: "A".into(), album: None, released: None, genre: None, isrc: None,
            cover_url: Some("c".into()), apple_music_url: None, preview_url: None, shazam_key: "1".into(), offset_ms: 5,
        },
        via: Via::Side,
        input: InputInfo { kind: InputKind::File, label: "clip.mp4".into() },
    };
    let json = serde_json::to_value(&track).unwrap();
    assert_eq!(
        json,
        serde_json::json!({"title": "T", "artist": "A", "coverUrl": "c", "shazamKey": "1", "offsetMs": 5,
                           "via": "side", "input": {"kind": "file", "label": "clip.mp4"}})
    );
    assert_eq!(serde_json::from_value::<RecognizedTrack>(json).unwrap(), track);
}
