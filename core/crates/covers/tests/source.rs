use nuvo_covers::source::{Cdn, allowed, bucket, host_allowed, plan};
use nuvo_net::Url;

fn url(s: &str) -> Url {
    Url::parse(s).unwrap()
}

fn tries(src: &str, alt: Option<&str>, size: u32) -> Vec<String> {
    let alt = alt.map(url);
    plan(&url(src), alt.as_ref(), size).unwrap().variants.iter().map(Url::to_string).collect()
}

#[test]
fn sizes_round_up_to_buckets() {
    assert_eq!(bucket(Some("40")), Some(64));
    assert_eq!(bucket(Some("300")), Some(512));
    assert_eq!(bucket(Some("5000")), Some(1024));
    assert_eq!(bucket(None), Some(512));
    assert_eq!(bucket(Some("0")), Some(512));
    assert_eq!(bucket(Some("128")), Some(128));
    assert_eq!(bucket(Some("80.5")), Some(128));
    assert_eq!(bucket(Some("-1")), None);
    assert_eq!(bucket(Some("abc")), None);
}

#[test]
fn only_artwork_hosts_are_allowed() {
    for host in ["i1.sndcdn.com", "i4.sndcdn.com", "img.sndcdn.com", "a1.sndcdn.com", "lh3.googleusercontent.com", "yt3.googleusercontent.com", "yt3.ggpht.com", "i.ytimg.com"] {
        assert!(host_allowed(host), "{host}");
    }
    for host in ["evil.example", "i5.sndcdn.com", "googleusercontent.com.evil.example", "i.pinimg.com", "i.scdn.co"] {
        assert!(!host_allowed(host), "{host}");
    }
}

#[test]
fn soundcloud_tokens_follow_the_bucket() {
    assert_eq!(tries("https://i1.sndcdn.com/artworks-1-large.jpg", None, 512), ["https://i1.sndcdn.com/artworks-1-t500x500.jpg", "https://i1.sndcdn.com/artworks-1-large.jpg"]);
    assert_eq!(tries("https://i1.sndcdn.com/artworks-1-t500x500.jpg", None, 64), ["https://i1.sndcdn.com/artworks-1-large.jpg", "https://i1.sndcdn.com/artworks-1-t500x500.jpg"]);
    assert_eq!(
        tries("https://i1.sndcdn.com/artworks-1-large.jpg", Some("https://i1.sndcdn.com/artworks-1-original.png"), 128),
        ["https://i1.sndcdn.com/artworks-1-t300x300.jpg", "https://i1.sndcdn.com/artworks-1-t500x500.jpg", "https://i1.sndcdn.com/artworks-1-original.png", "https://i1.sndcdn.com/artworks-1-large.jpg"]
    );
    assert_eq!(tries("https://i1.sndcdn.com/artworks-1-large.jpg", None, 1024)[0], "https://i1.sndcdn.com/artworks-1-original.jpg");
}

#[test]
fn google_options_are_replaced_or_appended() {
    assert_eq!(tries("https://lh3.googleusercontent.com/abc=w120-h120-l90-rj", None, 256)[0], "https://lh3.googleusercontent.com/abc=w256-h256-l90-rj");
    assert_eq!(tries("https://lh3.googleusercontent.com/abc=s60", None, 256)[0], "https://lh3.googleusercontent.com/abc=w256-h256-l90-rj");
    assert_eq!(tries("https://lh3.googleusercontent.com/abc", None, 256)[0], "https://lh3.googleusercontent.com/abc=w256-h256-l90-rj");
}

#[test]
fn youtube_file_names_follow_the_bucket() {
    assert_eq!(
        tries("https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg", None, 1024),
        ["https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg", "https://i.ytimg.com/vi/dQw4w9WgXcQ/sddefault.jpg", "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg"]
    );
    assert_eq!(tries("https://i.ytimg.com/vi/x/hqdefault.jpg", None, 64)[0], "https://i.ytimg.com/vi/x/mqdefault.jpg");
    assert_eq!(tries("https://i.ytimg.com/vi/x/default.jpg", None, 512)[0], "https://i.ytimg.com/vi/x/sddefault.jpg");
}

/// Review focus 4: SoundCloud artwork without a size token (default avatars) is fetched as given.
#[test]
fn tokenless_soundcloud_artwork_is_fetched_as_given() {
    let src = "https://a1.sndcdn.com/images/default_avatar_large.png";
    let plan = plan(&url(src), None, 64).unwrap();
    assert_eq!(plan.variants.iter().map(Url::to_string).collect::<Vec<_>>(), [src]);
    assert_eq!(plan.canonical, "a1.sndcdn.com/images/default_avatar_large.png");
}

#[test]
fn every_bucket_of_a_cover_shares_its_canonical_source() {
    let canonical = |src: &str, size: u32| plan(&url(src), None, size).unwrap().canonical;
    assert_eq!(canonical("https://i1.sndcdn.com/artworks-1-large.jpg", 64), canonical("https://i1.sndcdn.com/artworks-1-t500x500.jpg", 1024));
    assert_eq!(canonical("https://i1.sndcdn.com/artworks-1-large.jpg", 64), "i1.sndcdn.com/artworks-1.jpg");
    assert_eq!(canonical("https://lh3.googleusercontent.com/abc=s60", 64), "lh3.googleusercontent.com/abc");
    assert_eq!(canonical("https://i.ytimg.com/vi/x/hqdefault.jpg", 64), "i.ytimg.com/vi/x");
    assert_eq!(plan(&url("https://i.ytimg.com/vi/x/hqdefault.jpg"), None, 64).unwrap().cdn, Cdn::YouTube);
    assert!(plan(&url("https://evil.example/a.jpg"), None, 64).is_none());
}

#[test]
fn only_https_urls_are_allowed() {
    assert!(allowed(&url("https://i1.sndcdn.com/a.jpg")));
    assert!(!allowed(&url("http://i1.sndcdn.com/a.jpg")));
}

#[test]
fn urls_with_userinfo_are_rejected() {
    assert!(!allowed(&url("https://user:pass@i1.sndcdn.com/a.jpg")));
    assert!(!allowed(&url("https://user@i1.sndcdn.com/a.jpg")));
}

#[test]
fn urls_with_non_default_port_are_rejected() {
    assert!(!allowed(&url("https://i1.sndcdn.com:8443/a.jpg")));
    assert!(allowed(&url("https://i1.sndcdn.com:443/a.jpg")));
}

#[test]
fn ip_literal_urls_are_rejected() {
    assert!(!allowed(&url("https://127.0.0.1/a.jpg")));
    assert!(!allowed(&url("https://[::1]/a.jpg")));
}

#[test]
fn apple_artwork_is_asked_for_at_the_bucket_and_shares_one_identity() {
    let src = Url::parse("https://is1-ssl.mzstatic.com/image/thumb/Music/a.jpg/600x600cc.jpg").unwrap();
    let small = plan(&src, None, 256).unwrap();
    let large = plan(&src, None, 1024).unwrap();
    assert_eq!(small.variants[0].as_str(), "https://is1-ssl.mzstatic.com/image/thumb/Music/a.jpg/256x256cc.jpg");
    assert_eq!(small.canonical, large.canonical);
    assert!(!host_allowed("mzstatic.com") && !host_allowed("evil.mzstatic.com"));
}
