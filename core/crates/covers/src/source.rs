use nuvo_net::Url;

pub const BUCKETS: [u32; 5] = [64, 128, 256, 512, 1024];
pub const DEFAULT_BUCKET: u32 = 512;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Cdn {
    SoundCloud,
    Google,
    YouTube,
    Apple,
}

/// Deny by default: only the artwork CDNs of the catalogs Nuvo uses.
pub fn host_allowed(host: &str) -> bool {
    cdn(host).is_some()
}

/// URL must be https, have no userinfo, use default port, and have an allowed host (no IP literals).
pub fn allowed(url: &Url) -> bool {
    url.scheme() == "https"
        && url.username().is_empty()
        && url.password().is_none()
        && (url.port().is_none() || url.port().is_some_and(|p| p == 443))
        && host_allowed(url.host_str().unwrap_or(""))
}

pub fn cdn(host: &str) -> Option<Cdn> {
    match host {
        "i1.sndcdn.com" | "i2.sndcdn.com" | "i3.sndcdn.com" | "i4.sndcdn.com" | "img.sndcdn.com" | "a1.sndcdn.com" => Some(Cdn::SoundCloud),
        "yt3.ggpht.com" => Some(Cdn::Google),
        "i.ytimg.com" => Some(Cdn::YouTube),
        "is1-ssl.mzstatic.com" | "is2-ssl.mzstatic.com" | "is3-ssl.mzstatic.com" | "is4-ssl.mzstatic.com" | "is5-ssl.mzstatic.com" => Some(Cdn::Apple),
        _ if host.ends_with(".googleusercontent.com") => Some(Cdn::Google),
        _ => None,
    }
}

pub fn bucket(size: Option<&str>) -> Option<u32> {
    let size = match size.map(str::trim) {
        None | Some("") => return Some(DEFAULT_BUCKET),
        Some(text) => text.parse::<f64>().ok().filter(|v| v.is_finite() && *v >= 0.0)?,
    };
    if size == 0.0 {
        return Some(DEFAULT_BUCKET);
    }
    Some(BUCKETS.into_iter().find(|b| f64::from(*b) >= size).unwrap_or(1024))
}

#[derive(Debug, Clone, PartialEq)]
pub struct Plan {
    pub canonical: String,
    pub variants: Vec<Url>,
    pub cdn: Cdn,
}

fn soundcloud_token(file: &str) -> Option<(usize, usize)> {
    let dot = file.rfind('.')?;
    let dash = file[..dot].rfind('-')?;
    let token = &file[dash + 1..dot];
    let sized = token.strip_prefix('t').and_then(|wh| wh.split_once('x')).is_some_and(|(w, h)| !w.is_empty() && !h.is_empty() && w.bytes().chain(h.bytes()).all(|b| b.is_ascii_digit()));
    (sized || matches!(token, "large" | "crop" | "original" | "small" | "tiny" | "mini" | "badge")).then_some((dash, dot))
}

fn with_path(url: &Url, path: &str) -> Url {
    let mut out = url.clone();
    out.set_path(path);
    out
}

fn push(list: &mut Vec<Url>, url: Url) {
    if !list.contains(&url) {
        list.push(url);
    }
}

pub fn plan(src: &Url, alt: Option<&Url>, bucket: u32) -> Option<Plan> {
    if !allowed(src) {
        return None;
    }
    let cdn = cdn(src.host_str()?)?;
    let path = src.path();
    let file_start = path.rfind('/').map_or(0, |i| i + 1);
    let mut variants = Vec::new();
    let canonical;
    match cdn {
        Cdn::SoundCloud => match soundcloud_token(&path[file_start..]) {
            Some((dash, dot)) => {
                let (dash, dot) = (file_start + dash, file_start + dot);
                let sized = |token: &str| with_path(src, &format!("{}-{token}{}", &path[..dash], &path[dot..]));
                let token = match bucket {
                    64 => "large",
                    128 | 256 => "t300x300",
                    512 => "t500x500",
                    _ => "original",
                };
                push(&mut variants, sized(token));
                push(&mut variants, sized("t500x500"));
                canonical = format!("{}{}{}", src.host_str()?, &path[..dash], &path[dot..]);
            }
            None => canonical = format!("{}{}", src.host_str()?, path),
        },
        Cdn::Google => {
            let base = path.rfind('=').map_or(path, |i| &path[..i]);
            push(&mut variants, with_path(src, &format!("{base}=w{bucket}-h{bucket}-l90-rj")));
            canonical = format!("{}{}", src.host_str()?, base);
        }
        Cdn::Apple => {
            // The last segment names the size: `.../600x600cc.jpg`.
            let dir = &path[..file_start];
            push(&mut variants, with_path(src, &format!("{dir}{bucket}x{bucket}cc.jpg")));
            canonical = format!("{}{}", src.host_str()?, dir);
        }
        Cdn::YouTube => {
            let segments: Vec<&str> = path.trim_start_matches('/').split('/').collect();
            match segments[..] {
                ["vi", id, _file] if !id.is_empty() => {
                    let names: &[&str] = match bucket {
                        64 | 128 => &["mqdefault"],
                        256 => &["hqdefault"],
                        512 => &["sddefault"],
                        _ => &["maxresdefault", "sddefault", "hqdefault"],
                    };
                    for name in names {
                        push(&mut variants, with_path(src, &format!("/vi/{id}/{name}.jpg")));
                    }
                    canonical = format!("{}/vi/{id}", src.host_str()?);
                }
                _ => canonical = format!("{}{}", src.host_str()?, path),
            }
        }
    }
    if let Some(alt) = alt {
        push(&mut variants, alt.clone());
    }
    push(&mut variants, src.clone());
    Some(Plan { canonical, variants, cdn })
}
