use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};
use std::path::Path;

use nuvo_fetch::link::is_public;

pub const LOG_TAIL_BYTES: usize = 200 * 1024;
const SECRET_HEADERS: [&str; 4] = ["proxy-authorization:", "authorization:", "set-cookie:", "cookie:"];

pub fn redact(text: &str, home: Option<&str>, token: &str) -> String {
    text.split_inclusive('\n').map(|line| redact_line(line, home, token)).collect()
}

fn redact_line(line: &str, home: Option<&str>, token: &str) -> String {
    let (body, newline) = match line.strip_suffix('\n') {
        Some(body) => (body, "\n"),
        None => (line, ""),
    };
    let mut body = body.to_string();
    if token.len() >= 16 {
        body = body.replace(token, "<token>");
    }
    if let Some(home) = home.map(|h| h.trim_end_matches('/')).filter(|h| h.len() > 1) {
        body = replace_path(&body, home);
        body = replace_path(&body, &percent_encode_path(home, true));
        body = replace_path(&body, &percent_encode_path(home, false));
    }
    let lower = body.to_ascii_lowercase();
    if let Some((at, header)) = SECRET_HEADERS.iter().find_map(|h| lower.find(h).map(|at| (at, h))) {
        body.truncate(at + header.len());
        body.push_str(" <redacted>");
    }
    let body = redact_bearer(&body);
    let body = redact_urls(&body);
    let body = map_words(&body, |c| c.is_whitespace() || "\"'<>(),;[]{}:=|".contains(c), |w| if is_email(w) { "<email>".into() } else { w.into() });
    let body = map_words(&body, |c| !(c.is_ascii_digit() || c == '.'), replace_ipv4);
    let body = map_words(&body, |c| !(c.is_ascii_hexdigit() || c == ':' || c == '.'), replace_ipv6);
    body + newline
}

// Only where it ends a path component: /home/user2 is another user
fn replace_path(text: &str, path: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(at) = rest.find(path) {
        let after = &rest[at + path.len()..];
        let continues = after.chars().next().is_some_and(|c| c.is_alphanumeric() || c == '_' || c == '-');
        out.push_str(&rest[..at]);
        out.push_str(if continues { path } else { "~" });
        rest = after;
    }
    out.push_str(rest);
    out
}

fn percent_encode_path(path: &str, upper: bool) -> String {
    let mut out = String::new();
    for byte in path.bytes() {
        if byte.is_ascii_alphanumeric() || b"/-_.~".contains(&byte) {
            out.push(byte as char);
        } else if upper {
            out.push_str(&format!("%{byte:02X}"));
        } else {
            out.push_str(&format!("%{byte:02x}"));
        }
    }
    out
}

fn redact_bearer(line: &str) -> String {
    let lower = line.to_ascii_lowercase();
    let mut out = String::with_capacity(line.len());
    let mut done = 0;
    while let Some(at) = lower[done..].find("bearer ") {
        let token_start = done + at + "bearer ".len();
        let token_len = line[token_start..].find(|c: char| c.is_whitespace() || ",;\"'".contains(c)).unwrap_or(line.len() - token_start);
        out.push_str(&line[done..token_start]);
        if token_len > 0 {
            out.push_str("<redacted>");
        }
        done = token_start + token_len;
    }
    out.push_str(&line[done..]);
    out
}

fn replace_ipv4(word: &str) -> String {
    let core = word.trim_matches('.');
    let lead = word.len() - word.trim_start_matches('.').len();
    let octets: Vec<&str> = core.split('.').collect();
    let valid = octets.len() == 4 && octets.iter().all(|o| (1..=3).contains(&o.len()) && o.bytes().all(|b| b.is_ascii_digit()));
    if valid {
        let n: Vec<Option<u8>> = octets.iter().map(|o| o.parse().ok()).collect();
        if let [Some(a), Some(b), Some(c), Some(d)] = n[..]
            && is_public(IpAddr::V4(Ipv4Addr::new(a, b, c, d)))
        {
            return format!("{}<ip>{}", &word[..lead], &word[lead + core.len()..]);
        }
    }
    word.to_string()
}

fn replace_ipv6(word: &str) -> String {
    let end = word.trim_end_matches(['.', ':']).len();
    let start = end - word[..end].trim_start_matches(':').len();
    for (from, to) in [(0, word.len()), (0, end), (start, end)] {
        let candidate = &word[from..to];
        if let Ok(ip) = candidate.parse::<Ipv6Addr>()
            && candidate.contains(':')
            && ip.to_ipv4_mapped().map_or_else(|| is_public(IpAddr::V6(ip)), |v4| is_public(IpAddr::V4(v4)))
        {
            return format!("{}<ip>{}", &word[..from], &word[to..]);
        }
    }
    word.to_string()
}

fn redact_urls(line: &str) -> String {
    let mut out = String::with_capacity(line.len());
    let mut rest = line;
    while let Some(at) = rest.find("://") {
        let start = rest[..at].rfind(|c: char| !(c.is_ascii_alphanumeric() || "+-.".contains(c))).map_or(0, |i| i + 1);
        let end = rest[at..].find(|c: char| c.is_whitespace() || "\"'<>\\`".contains(c)).map_or(rest.len(), |i| at + i);
        out.push_str(&rest[..start]);
        let (scheme, after) = rest[start..end].split_at(at - start + 3);
        let kept = after.find(['?', '#']).map_or(after, |i| &after[..i]);
        let (authority, path) = kept.split_at(kept.find('/').unwrap_or(kept.len()));
        out.push_str(scheme);
        match authority.rsplit_once('@') {
            Some((_, host)) => out.push_str(&format!("***@{host}")),
            None => out.push_str(authority),
        }
        out.push_str(path);
        rest = &rest[end..];
    }
    out.push_str(rest);
    out
}

fn map_words(text: &str, is_separator: impl Fn(char) -> bool, f: impl Fn(&str) -> String) -> String {
    let mut out = String::with_capacity(text.len());
    let mut word = String::new();
    for c in text.chars() {
        if is_separator(c) {
            out.push_str(&f(&word));
            word.clear();
            out.push(c);
        } else {
            word.push(c);
        }
    }
    out.push_str(&f(&word));
    out
}

fn is_email(word: &str) -> bool {
    let Some((local, domain)) = word.split_once('@') else { return false };
    !local.is_empty()
        && local.chars().all(|c| c.is_ascii_alphanumeric() || "._%+-".contains(c))
        && domain.contains('.')
        && !domain.starts_with('.')
        && domain.chars().all(|c| c.is_ascii_alphanumeric() || ".-".contains(c))
}

pub fn log_tail(log: &Path) -> String {
    let mut rotated = log.as_os_str().to_owned();
    rotated.push(".1");
    let mut bytes = std::fs::read(rotated).unwrap_or_default();
    bytes.extend(std::fs::read(log).unwrap_or_default());
    if bytes.len() > LOG_TAIL_BYTES {
        let cut = bytes.len() - LOG_TAIL_BYTES;
        let line_start = if bytes[cut - 1] == b'\n' {
            cut
        } else if let Some(i) = bytes[cut..].iter().position(|b| *b == b'\n') {
            cut + i + 1
        } else {
            // One huge line: at least do not start inside a UTF-8 character.
            cut + bytes[cut..].iter().take_while(|b| (**b & 0xC0) == 0x80).count()
        };
        bytes.drain(..line_start);
    }
    String::from_utf8_lossy(&bytes).into_owned()
}
