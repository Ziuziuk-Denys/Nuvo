#[derive(Debug, PartialEq)]
pub enum Link {
    Short(String),
    Canonical(String),
}

fn strip_ci<'a>(text: &'a str, prefix: &str) -> Option<&'a str> {
    let head = text.get(..prefix.len())?;
    head.eq_ignore_ascii_case(prefix).then(|| &text[prefix.len()..])
}

pub fn parse(input: &str) -> Option<Link> {
    let mut rest = input.trim();
    rest = strip_ci(rest, "https://").or_else(|| strip_ci(rest, "http://")).unwrap_or(rest);
    let mut short = false;
    for prefix in ["www.", "m.", "on."] {
        if let Some(after) = strip_ci(rest, prefix) {
            short = prefix == "on.";
            rest = after;
            break;
        }
    }
    let path = strip_ci(rest, "soundcloud.com/")?;
    if path.trim().is_empty() {
        return None;
    }
    if short {
        return Some(Link::Short(format!("https://on.soundcloud.com/{path}")));
    }
    let end = path.find(['?', '#']).unwrap_or(path.len());
    Some(Link::Canonical(format!("https://soundcloud.com/{}", &path[..end])))
}

pub fn is_link(input: &str) -> bool {
    parse(input).is_some()
}
