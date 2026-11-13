use nuvo_fetch::proxy::{ffmpeg_proxy, parse_proxy, without_login};
use nuvo_fetch::{FetchError, classify};
use reqwest::Url;

#[test]
fn proxy_urls_are_validated() {
    for good in ["http://10.0.0.2:3128", "https://proxy.example:443/", "socks5://127.0.0.1:1080", "socks5h://user:p%40ss@[::1]:9050", "http://host:80"] {
        assert!(parse_proxy(good).is_ok(), "{good}");
    }
    let cases = [
        ("ftp://h:21", "must start with"),
        ("http://h", "port"),
        ("http://h:0", "port"),
        ("http://h:70000", "valid URL"),
        ("http://h:8080/path", "end after the port"),
        ("http://h:8080/?q=1", "end after the port"),
        ("not a url", "valid URL"),
        ("socks4://h:1080", "must start with"),
    ];
    for (bad, reason) in cases {
        let err = parse_proxy(bad).unwrap_err();
        assert!(err.contains(reason), "{bad}: {err}");
    }
}

#[test]
fn ffmpeg_gets_a_plain_http_proxy_or_the_bridge() {
    let url = |text: &str| Url::parse(text).unwrap();
    let bridge = Some("http://nuvo:t@127.0.0.1:4000");
    assert_eq!(ffmpeg_proxy(None, None), Ok(None));
    assert_eq!(ffmpeg_proxy(Some(&url("http://u:p@10.0.0.2:3128")), None), Ok(Some("http://u:p@10.0.0.2:3128/".into())));
    for socks in ["socks5://10.0.0.2:1080", "socks5h://u:p@10.0.0.2:1080"] {
        assert_eq!(ffmpeg_proxy(Some(&url(socks)), bridge), Ok(bridge.map(String::from)), "{socks}");
        assert_eq!(ffmpeg_proxy(Some(&url(socks)), None), Err(FetchError::ProxyUnsupported), "{socks} without a bridge");
    }
    assert_eq!(ffmpeg_proxy(Some(&url("https://10.0.0.2:443")), bridge), Err(FetchError::ProxyUnsupported));
}

#[test]
fn proxy_logins_never_reach_messages() {
    assert_eq!(
        without_login("Unable to connect to proxy socks5h://me:s3cret@10.0.0.2:1080 (refused)"),
        "Unable to connect to proxy socks5h://***@10.0.0.2:1080 (refused)"
    );
    assert_eq!(without_login("mail me@host.com at https://x.y/a"), "mail me@host.com at https://x.y/a");
    assert!(matches!(classify("ERROR: connection refused by http://u:pw@h:1/"), FetchError::Network(text) if !text.contains("pw")));
}
