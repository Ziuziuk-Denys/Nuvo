#![cfg(unix)]
use std::os::unix::fs::PermissionsExt;

use nuvo_fetch::ytdlp::{MediaTags, Resolved, args, parse_info, parse_tags, resolve, resolve_full};
use nuvo_fetch::{FetchError, Remote};
use serde_json::json;

#[test]
fn argument_list_is_fixed_and_the_url_comes_last_after_a_separator() {
    assert_eq!(
        args("https://youtu.be/abc", None),
        [
            "--ignore-config",
            "--use-extractors",
            "default,-generic",
            "--no-playlist",
            "--no-exec",
            "--no-warnings",
            "--socket-timeout",
            "20",
            "--extractor-args",
            "youtube:player_client=tv_simply,web_safari,mweb,default",
            "-f",
            "bestaudio[ext=m4a]/bestaudio/best",
            "-J",
            "--",
            "https://youtu.be/abc",
        ]
    );
    let hostile = args("--exec=rm -rf ~", Some(std::path::Path::new("/opt/deno")));
    assert_eq!(hostile[hostile.len() - 2..], ["--", "--exec=rm -rf ~"]);
    let proxied = args("https://youtu.be/abc", None);
    assert!(!proxied.iter().any(|arg| arg.contains("user") || arg.contains("pw")), "no credentials in argv");
}

#[test]
fn the_found_js_runtime_is_the_only_one_yt_dlp_may_use() {
    let with = args("https://youtu.be/abc", Some(std::path::Path::new("/usr/bin/node")));
    let at = with.iter().position(|arg| arg == "--no-js-runtimes").unwrap();
    assert_eq!(with[at..at + 3], ["--no-js-runtimes", "--js-runtimes", "node:/usr/bin/node"]);
    assert!(at < with.iter().position(|arg| arg == "--").unwrap());
    assert!(!args("https://youtu.be/abc", None).iter().any(|arg| arg.contains("js-runtimes")));
}

#[test]
fn parses_the_selected_format() {
    let info = json!({
        "title": " I Will Survive ", "duration": 198.4, "is_live": false,
        "url": "https://rr1.googlevideo.com/videoplayback?id=1",
        "http_headers": {"User-Agent": "Mozilla/5.0", "Accept": "*/*", "Weird": 3}
    });
    let resolved = parse_info(info.to_string().as_bytes()).unwrap();
    assert_eq!(
        resolved,
        Resolved {
            title: Some("I Will Survive".into()),
            duration_ms: Some(198_400),
            remote: Remote {
                url: "https://rr1.googlevideo.com/videoplayback?id=1".into(),
                headers: vec![("Accept".into(), "*/*".into()), ("User-Agent".into(), "Mozilla/5.0".into())],
            },
        }
    );

    let merged = json!({"duration": 10, "requested_formats": [{"url": "https://cdn/a.m4a", "http_headers": {}}]});
    assert_eq!(parse_info(merged.to_string().as_bytes()).unwrap().remote.url, "https://cdn/a.m4a");

    let live = json!({"is_live": true, "duration": 5, "url": "https://cdn/live.m3u8"});
    assert_eq!(parse_info(live.to_string().as_bytes()).unwrap().duration_ms, None);
}

#[test]
fn refuses_playlists_local_urls_and_garbage() {
    assert_eq!(parse_info(json!({"_type": "playlist", "entries": []}).to_string().as_bytes()), Err(FetchError::Unsupported));
    assert_eq!(parse_info(json!({"title": "x"}).to_string().as_bytes()), Err(FetchError::Unsupported));
    assert_eq!(parse_info(json!({"url": "file:///etc/passwd"}).to_string().as_bytes()), Err(FetchError::Unsupported));
    assert_eq!(parse_info(b"not json"), Err(FetchError::Unavailable));
}

#[tokio::test]
async fn drives_the_binary_and_classifies_its_errors() {
    let dir = tempfile::tempdir().unwrap();
    let fake = dir.path().join("yt-dlp");
    let args_file = dir.path().join("args");
    let body = format!(
        "#!/bin/sh\nprintf '%s\\n' \"$@\" > {}\ncase \"$*\" in\n  *blocked*) echo \"ERROR: [youtube] x: Sign in to confirm you're not a bot\" >&2; exit 1;;\n  *) echo '{{\"title\":\"T\",\"duration\":12,\"url\":\"https://cdn/a.m4a\"}}';;\nesac\n",
        args_file.display()
    );
    std::fs::write(&fake, body).unwrap();
    std::fs::set_permissions(&fake, std::fs::Permissions::from_mode(0o755)).unwrap();

    let resolved = resolve(&fake, None, "https://youtu.be/ok", Some("socks5h://127.0.0.1:1080")).await.unwrap();
    assert_eq!((resolved.title.as_deref(), resolved.duration_ms), (Some("T"), Some(12_000)));
    let passed: Vec<String> = std::fs::read_to_string(&args_file).unwrap().lines().map(String::from).collect();
    assert_eq!(passed, args("https://youtu.be/ok", None));
    assert!(passed.windows(2).any(|pair| pair == ["--use-extractors", "default,-generic"]), "recognize runs without the generic extractor");

    resolve_full(&fake, Some(&dir.path().join("deno")), "https://youtu.be/full", None).await.unwrap();
    let passed: Vec<String> = std::fs::read_to_string(&args_file).unwrap().lines().map(String::from).collect();
    assert!(passed.windows(2).any(|pair| pair == ["--use-extractors", "default,-generic"]), "inspect runs without the generic extractor");
    assert!(passed.contains(&format!("deno:{}", dir.path().join("deno").display())));

    assert_eq!(resolve(&fake, None, "https://youtu.be/blocked", None).await, Err(FetchError::Blocked));
}

#[test]
fn reads_song_tags_when_the_site_gives_them() {
    let tagged = parse_tags(include_bytes!("fixtures/ytdlp-tagged.json")).unwrap();
    assert_eq!(
        tagged,
        MediaTags {
            title: Some("Rick Astley - Never Gonna Give You Up (Official Video)".into()),
            uploader: Some("Rick Astley".into()),
            track: Some("Never Gonna Give You Up".into()),
            artist: Some("Rick Astley".into()),
            album: Some("Whenever You Need Somebody".into()),
            duration_ms: Some(213_000),
            is_live: false,
        }
    );
    let untagged = parse_tags(include_bytes!("fixtures/ytdlp-untagged.json")).unwrap();
    assert_eq!((untagged.track, untagged.artist, untagged.duration_ms), (None, None, Some(31_500)));
    let live = parse_tags(br#"{"title":"Radio","is_live":true,"duration":12.0,"creator":"DJ"}"#).unwrap();
    assert_eq!((live.is_live, live.duration_ms, live.artist.as_deref()), (true, None, Some("DJ")));
    assert_eq!(parse_tags(b"not json"), Err(FetchError::Unavailable));
}

#[test]
fn a_recorded_youtube_answer_resolves_to_its_stream() {
    let resolved = parse_info(include_bytes!("fixtures/ytdlp-youtube.json")).unwrap();
    assert_eq!(resolved.title.as_deref(), Some("Queen \u{2013} Bohemian Rhapsody (Official Video Remastered)"));
    assert_eq!(resolved.duration_ms, Some(359_000));
    assert!(resolved.remote.url.starts_with("https://rr1---sn-uigxx03-45ce.googlevideo.com/videoplayback?"));
    assert!(resolved.remote.headers.iter().any(|(name, _)| name == "User-Agent"));
}
