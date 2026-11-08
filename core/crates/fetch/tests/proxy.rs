use nuvo_fetch::proxy::{ffmpeg_proxy, parse_proxy};

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
fn ffmpeg_gets_only_http_proxies() {
    assert_eq!(ffmpeg_proxy("http://10.0.0.2:3128"), Some("http://10.0.0.2:3128"));
    assert_eq!(ffmpeg_proxy("https://10.0.0.2:3128"), None);
    assert_eq!(ffmpeg_proxy("socks5h://10.0.0.2:1080"), None);
}
