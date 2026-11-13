// Word boundaries are Unicode aware, so Cyrillic words work like Latin ones

use unicode_normalization::UnicodeNormalization;

pub const MAX_TEXT_CHARS: usize = 300;

const AUDIO_EXTENSIONS: [&str; 6] = ["flac", "ogg", "m4a", "aac", "wav", "mp3"];
const SOCIAL_TAGS: [&str; 9] = ["tg", "tgk", "vk", "soundcloud", "instagram", "insta", "inst", "twitter", "x"];
const LINK_PREFIXES: [&str; 6] = ["t.me/", "vk.com/", "instagram.com/", "soundcloud.com/", "twitter.com/", "x.com/"];
const PRODUCER: [&[&str]; 3] = [&["prod"], &["produced", "by"], &["beat", "by"]];
/// A "beat by" after one of these is an ordinary title ("Feel the Beat by Beat").
const DETERMINERS: [&str; 10] = ["the", "a", "an", "my", "your", "our", "his", "her", "their", "this"];
const FEATURING: [&str; 3] = ["feat", "ft", "featuring"];

const BRACKET_JUNK: &[&[&str]] = &[
    &["free", "download"],
    &["free", "dl"],
    &["download", "link"],
    &["free", "beat"],
    &["link", "in", "bio"],
    &["link", "in", "description"],
    &["out", "now"],
    &["stream", "now"],
    &["buy", "now"],
    &["premiere"],
    &["exclusive"],
    &["official", "video"],
    &["official", "audio"],
    &["official", "music", "video"],
    &["music", "video"],
    &["lyric", "video"],
    &["lyrics", "video"],
    &["visualizer"],
    &["visualiser"],
    &["visualisation"],
    &["visualization"],
    &["og", "version"],
    &["og", "beat"],
    &["full", "version"],
    &["hq"],
    &["hd"],
    &["4k"],
    &["clip", "officiel"],
    &["remaster"],
    &["remastered"],
    &["deluxe", "edition"],
    &["anniversary", "edition"],
    &["original", "mix"],
    &["original", "song"],
    &["album", "version"],
    &["single", "version"],
    &["ost"],
    &["soundtrack"],
    &["из", "сериала"],
    &["из", "фильма"],
];

const TRAILING_PROMO: &[&[&str]] = &[
    &["out", "now"],
    &["premiere"],
    &["exclusive"],
    &["free", "dl"],
    &["free", "download"],
    &["official", "video"],
    &["official", "audio"],
    &["official", "music", "video"],
    &["visualizer"],
    &["audio"],
    &["remaster"],
    &["remastered"],
    &["prod"],
    &["produced", "by"],
    &["original", "song"],
];

const DASH_QUALIFIERS: [&[&str]; 12] = [
    &["mono"],
    &["stereo"],
    &["remaster"],
    &["remastered"],
    &["live"],
    &["acoustic"],
    &["instrumental"],
    &["radio", "edit"],
    &["single", "version"],
    &["original", "mix"],
    &["album", "version"],
    &["ремастеринг"],
];

/// Versions that are not the record. Search sinks them and import matches them only to the same version.
pub const MARKERS: [(&str, &[&[&str]]); 27] = [
    ("remix", &[&["remix"], &["remixed"], &["rmx"], &["ремикс"]]),
    ("vip", &[&["vip"], &["v", "i", "p"]]),
    ("flip", &[&["flip"], &["флип"]]),
    ("bootleg", &[&["bootleg"], &["бутлег"]]),
    ("mashup", &[&["mashup"], &["mash", "up"], &["мэшап"], &["мешап"]]),
    ("edit", &[&["edit"], &["эдит"]]),
    ("slowed", &[&["slowed"], &["слоу"], &["замедлен"]]),
    ("reverb", &[&["reverb"], &["реверб"]]),
    ("sped-up", &[&["sped", "up"], &["speed", "up"], &["spedup"], &["speedup"], &["спид", "ап"], &["спидап"], &["ускорен"], &["speed", "song"]]),
    ("nightcore", &[&["nightcore"], &["найткор"]]),
    ("instrumental", &[&["instrumental"], &["inst"], &["инструментал"], &["минус"]]),
    ("acoustic", &[&["acoustic"], &["акустика"]]),
    ("live", &[&["live"], &["лайв"], &["концерт"]]),
    ("cover", &[&["cover"], &["кавер"], &["remake"]]),
    ("bass-boost", &[&["bass", "boost"], &["bass", "boosted"], &["bassboosted"], &["басс", "буст"]]),
    ("8d", &[&["8d"]]),
    ("karaoke", &[&["karaoke"], &["караоке"], &["in", "the", "style", "of"], &["originally", "performed"], &["backing", "track"], &["play", "along"]]),
    ("tribute", &[&["tribute"]]),
    ("lullaby", &[&["lullaby"], &["колыбельная"]]),
    ("voice-swap", &[&["женская", "версия"], &["мужская", "версия"]]),
    ("piano", &[&["piano", "version"]]),
    ("fan-made", &[&["fan", "made"]]),
    ("chiptune", &[&["soundfont"], &["sega"], &["8", "bit"]]),
    ("footage", &[&["footage"]]),
    ("translated", &[&["translated"], &["traducida"], &["sub", "espanol"]]),
    ("reaction", &[&["reaction"], &["реакция"]]),
    ("tutorial", &[&["tutorial"], &["урок"]]),
];

const ALIASES: [&[&str]; 4] = [
    &["кино", "виктор цой", "в цой", "цой"],
    &["король и шут", "горшок", "михаил горшенев", "князь", "андрей князев"],
    &["скриптонит", "scriptonite"],
    &["pharaoh", "фараон"],
];

// Every public entry point starts here, so helpers only see NFC text of bounded length
fn prepare(text: &str) -> String {
    text.nfc().take(MAX_TEXT_CHARS).collect()
}

pub fn normalize(text: &str) -> String {
    let text = prepare(text);
    let mut out = String::with_capacity(text.len());
    let mut gap = false;
    for c in text.chars() {
        if c.is_alphanumeric() {
            if gap && !out.is_empty() {
                out.push(' ');
            }
            gap = false;
            out.extend(c.to_lowercase());
        } else {
            gap = true;
        }
    }
    out
}

pub fn compare_form(text: &str) -> String {
    normalize(&strip_extensions(&prepare(text))).replace('ё', "е")
}

fn words(text: &str) -> Vec<String> {
    normalize(text).split(' ').filter(|w| !w.is_empty()).map(str::to_string).collect()
}

struct Token {
    text: String,
    start: usize,
    end: usize,
}

fn tokens(raw: &str) -> Vec<Token> {
    let mut out: Vec<Token> = Vec::new();
    let mut current: Option<Token> = None;
    for (i, c) in raw.char_indices() {
        if c.is_alphanumeric() {
            let token = current.get_or_insert(Token { text: String::new(), start: i, end: i });
            token.text.extend(c.to_lowercase());
            token.end = i + c.len_utf8();
        } else if let Some(token) = current.take() {
            out.push(token);
        }
    }
    out.extend(current);
    out
}

fn starts_with_phrase(list: &[String], phrase: &[&str]) -> bool {
    list.len() >= phrase.len() && list.iter().zip(phrase).all(|(w, p)| w == p)
}

fn contains_phrase(list: &[String], phrase: &[&str]) -> bool {
    (0..list.len()).any(|i| starts_with_phrase(&list[i..], phrase))
}

fn token_phrase_at(toks: &[Token], i: usize, phrase: &[&str]) -> bool {
    toks.len() >= i + phrase.len() && phrase.iter().enumerate().all(|(k, p)| toks[i + k].text == *p)
}

fn is_year(word: &str) -> bool {
    word.len() == 4 && word.bytes().all(|b| b.is_ascii_digit()) && (word.starts_with("19") || word.starts_with("20"))
}

fn strip_extensions(raw: &str) -> String {
    let mut out = raw.to_string();
    for token in tokens(raw).iter().rev() {
        let dotted = token.start > 0 && raw.as_bytes()[token.start - 1] == b'.';
        if dotted && AUDIO_EXTENSIONS.contains(&token.text.as_str()) {
            out.replace_range(token.start - 1..token.end, "");
        }
    }
    out
}

fn strip_asterisks(raw: &str) -> String {
    let mut out = String::new();
    let mut rest = raw;
    while let Some(open) = rest.find('*') {
        let Some(close) = rest[open + 1..].find('*') else { break };
        out.push_str(&rest[..open]);
        out.push(' ');
        rest = &rest[open + close + 2..];
    }
    out.push_str(rest);
    out
}

fn closer(open: char) -> Option<char> {
    match open {
        '(' => Some(')'),
        '[' => Some(']'),
        '{' => Some('}'),
        _ => None,
    }
}

enum Verdict {
    Keep,
    Drop,
    Replace(String),
}

fn matching_close(rest: &str, open_at: usize, open: char) -> Option<usize> {
    let from = open_at + open.len_utf8();
    let mut stack = vec![closer(open)?];
    for (k, c) in rest[from..].char_indices() {
        if let Some(want) = closer(c) {
            stack.push(want);
        } else if stack.last() == Some(&c) {
            stack.pop();
            if stack.is_empty() {
                return Some(from + k);
            }
        }
    }
    None
}

fn strip_brackets(raw: &str, judge: &dyn Fn(&str) -> Verdict) -> String {
    let mut out = String::new();
    let mut rest = raw;
    while let Some((open_at, open)) = rest.char_indices().find(|(_, c)| closer(*c).is_some()) {
        out.push_str(&rest[..open_at]);
        let after = open_at + open.len_utf8();
        let Some(close_at) = matching_close(rest, open_at, open) else {
            out.push(open);
            rest = &rest[after..];
            continue;
        };
        let close = closer(open).expect("opener has a closer");
        let inner = strip_brackets(&rest[after..close_at], judge);
        match judge(&inner) {
            Verdict::Keep => out.extend([open].into_iter().chain(inner.trim().chars()).chain([close])),
            Verdict::Drop => out.push(' '),
            Verdict::Replace(text) => out.extend([open].into_iter().chain(text.chars()).chain([close])),
        }
        rest = &rest[close_at + close.len_utf8()..];
    }
    out.push_str(rest);
    out
}

fn is_russian_remaster(word: &str) -> bool {
    word.starts_with("ремастер") || word.starts_with("ремастир")
}

fn without_promo_words(content: &str) -> String {
    let toks = tokens(content);
    let mut out = String::new();
    let mut from = 0;
    let mut i = 0;
    while i < toks.len() {
        let phrase = BRACKET_JUNK.iter().filter(|p| token_phrase_at(&toks, i, p)).map(|p| p.len()).max();
        let len = phrase.or(is_russian_remaster(&toks[i].text).then_some(1));
        let Some(len) = len else {
            i += 1;
            continue;
        };
        out.push_str(&content[from..toks[i].start]);
        from = toks[i + len - 1].end;
        i += len;
    }
    out.push_str(&content[from..]);
    out.trim_matches(|c: char| !c.is_alphanumeric()).to_string()
}

// A bracket with a version marker loses only its promo words: "Remastered Remix" keeps Remix
fn junk_verdict(content: &str) -> Verdict {
    let trimmed = content.trim();
    let list = words(trimmed);
    if list.is_empty() || trimmed.starts_with('@') {
        return Verdict::Drop;
    }
    let lower = trimmed.to_lowercase();
    let has_marker = without_markers(&list).len() != list.len();
    let separated = lower.contains(':') || lower.contains('/');
    let social = SOCIAL_TAGS.contains(&list[0].as_str()) && (separated || (list.len() >= 2 && !has_marker));
    if social || LINK_PREFIXES.iter().any(|p| lower.contains(p)) || PRODUCER.iter().any(|p| starts_with_phrase(&list, p)) {
        return Verdict::Drop;
    }
    let promo = BRACKET_JUNK.iter().any(|p| contains_phrase(&list, p)) || list.iter().any(|w| is_russian_remaster(w));
    if !promo {
        return Verdict::Keep;
    }
    let rest = if has_marker { without_promo_words(trimmed) } else { String::new() };
    if rest.is_empty() { Verdict::Drop } else { Verdict::Replace(rest) }
}

fn starts_with_ignore_case(text: &str, prefix: &str) -> bool {
    let mut chars = text.chars();
    prefix.chars().all(|p| chars.next().is_some_and(|c| c.eq_ignore_ascii_case(&p)))
}

fn strip_handles_and_links(raw: &str) -> String {
    let mut out = String::new();
    let mut chars = raw.char_indices().peekable();
    while let Some((i, c)) = chars.next() {
        let at_word_start = i == 0 || !raw[..i].chars().next_back().is_some_and(char::is_alphanumeric);
        let link = at_word_start && LINK_PREFIXES.iter().any(|p| starts_with_ignore_case(&raw[i..], p));
        if (c == '@' && at_word_start) || link {
            while chars.peek().is_some_and(|(_, c)| !c.is_whitespace()) {
                chars.next();
            }
            out.push(' ');
        } else {
            out.push(c);
        }
    }
    out
}

// A separator is required outside brackets, so words like "Instant" or a lone "X" stay
fn strip_social(raw: &str) -> String {
    let toks = tokens(raw);
    let mut out = raw.to_string();
    for i in (0..toks.len().saturating_sub(1)).rev() {
        if !SOCIAL_TAGS.contains(&toks[i].text.as_str()) {
            continue;
        }
        let between = raw[toks[i].end..toks[i + 1].start].trim();
        if between == ":" || between == "/" {
            out.replace_range(toks[i].start..toks[i + 1].end, " ");
        }
    }
    out
}

fn strip_producer(raw: &str) -> String {
    let toks = tokens(raw);
    let credit = |i: usize| PRODUCER.iter().any(|p| token_phrase_at(&toks, i, p)) && !(i > 0 && toks[i].text == "beat" && DETERMINERS.contains(&toks[i - 1].text.as_str()));
    match (0..toks.len()).find(|&i| credit(i)) {
        Some(i) if i > 0 => raw[..toks[i].start].to_string(),
        _ => raw.to_string(),
    }
}

fn separators(raw: &str, all: bool) -> Vec<(usize, usize)> {
    let chars: Vec<(usize, char)> = raw.char_indices().collect();
    let mut found = Vec::new();
    for (k, &(i, c)) in chars.iter().enumerate() {
        let spaced = k > 0 && chars[k - 1].1.is_whitespace() || chars.get(k + 1).is_some_and(|(_, n)| n.is_whitespace());
        let dash = matches!(c, '-' | '–' | '—') && spaced;
        if dash || c == '|' || (all && matches!(c, ':' | '~')) {
            found.push((i, i + c.len_utf8()));
        }
    }
    found
}

fn strip_trailing_promo(raw: &str) -> String {
    for (start, end) in separators(raw, false) {
        let mut rest = words(&raw[end..]);
        if rest.first().is_some_and(|w| is_year(w)) {
            rest.remove(0);
        }
        if TRAILING_PROMO.iter().any(|p| starts_with_phrase(&rest, p)) || rest.first().is_some_and(|w| is_russian_remaster(w)) {
            return raw[..start].to_string();
        }
    }
    raw.to_string()
}

fn tidy(raw: &str) -> String {
    let collapsed = raw.split_whitespace().collect::<Vec<_>>().join(" ");
    collapsed.trim_matches(|c: char| c.is_whitespace() || matches!(c, '-' | '–' | '—' | '|' | '~' | ':')).to_string()
}

pub fn remove_junk(raw: &str) -> String {
    let text = strip_extensions(&prepare(raw));
    let text = strip_asterisks(&text);
    let text = strip_brackets(&text, &junk_verdict);
    let text = strip_handles_and_links(&text);
    let text = strip_social(&text);
    let text = strip_producer(&text);
    let text = strip_trailing_promo(&text);
    tidy(&text)
}

fn strip_featuring(raw: &str) -> String {
    let text = strip_brackets(raw, &|content| {
        let list = words(content);
        if list.first().is_some_and(|w| FEATURING.contains(&w.as_str()) || w == "with") { Verdict::Drop } else { Verdict::Keep }
    });
    let toks = tokens(&text);
    let Some(i) = toks.iter().position(|t| FEATURING.contains(&t.text.as_str())) else { return text };
    let from = toks[i].start;
    let stop = text[from..].find(['(', '[', '{']).map(|k| from + k);
    let dash = separators(&text, false).into_iter().map(|(s, _)| s).find(|s| *s > from);
    let to = [stop, dash].into_iter().flatten().min().unwrap_or(text.len());
    format!("{} {}", &text[..from], &text[to..])
}

fn strip_dash_qualifier(raw: &str) -> String {
    let Some(&(start, end)) = separators(raw, false).last() else { return raw.to_string() };
    let mut rest = words(&raw[end..]);
    if rest.first().is_some_and(|w| is_year(w)) {
        rest.remove(0);
    }
    if rest.first().is_some_and(|w| is_russian_remaster(w)) || DASH_QUALIFIERS.iter().any(|p| starts_with_phrase(&rest, p)) {
        return raw[..start].to_string();
    }
    raw.to_string()
}

fn without_markers(list: &[String]) -> Vec<String> {
    let mut out = Vec::new();
    let mut i = 0;
    while i < list.len() {
        let skip = MARKERS.iter().flat_map(|(_, forms)| forms.iter()).filter(|p| starts_with_phrase(&list[i..], p)).map(|p| p.len()).max();
        match skip {
            Some(n) => i += n,
            None => {
                out.push(list[i].clone());
                i += 1;
            }
        }
    }
    out
}

pub fn base_title(raw: &str) -> String {
    let text = strip_dash_qualifier(&strip_featuring(&remove_junk(raw)));
    compare_form(&without_markers(&words(&text)).join(" "))
}

pub fn title_parts(cleaned: &str) -> Vec<String> {
    let cleaned = &prepare(cleaned);
    let mut parts = Vec::new();
    let mut from = 0;
    for (start, end) in separators(cleaned, true) {
        parts.push(cleaned[from..start].trim().to_string());
        from = end;
    }
    parts.push(cleaned[from..].trim().to_string());
    parts
}

pub fn clean_title(raw: &str) -> String {
    let cleaned = remove_junk(raw);
    if cleaned.is_empty() { tidy(&prepare(raw)) } else { cleaned }
}

pub fn artist_and_title(raw: &str) -> (Option<String>, String) {
    let cleaned = clean_title(raw);
    let parts = title_parts(&cleaned);
    let len = |s: &String| s.chars().count();
    if parts.len() >= 3 && len(&parts[1]) >= 2 && len(&parts[2]) >= 1 {
        return (Some(parts[1].clone()), parts[2..].join(" - "));
    }
    if parts.len() == 2 && len(&parts[0]) >= 2 && parts[0].chars().any(|c| !c.is_ascii_digit() && !c.is_whitespace()) && len(&parts[1]) >= 1 {
        return (Some(parts[0].clone()), parts[1].clone());
    }
    (None, cleaned)
}

pub fn markers(raw: &str) -> Vec<&'static str> {
    let list = words(&remove_junk(raw));
    MARKERS.iter().filter(|(_, forms)| forms.iter().any(|p| contains_phrase(&list, p))).map(|(name, _)| *name).collect()
}

pub struct Query {
    pub artist: String,
    pub title: String,
    pub query: String,
}

pub fn search_query(raw_title: &str, artists: &[String]) -> Query {
    let (parsed, title) = artist_and_title(raw_title);
    let artist = parsed.or_else(|| artists.first().map(|a| prepare(a.trim()))).unwrap_or_default();
    let title = tidy(&title);
    let query = if artist.is_empty() || title.to_lowercase().starts_with(&artist.to_lowercase()) { title.clone() } else { format!("{artist} {title}") };
    Query { artist, title, query: query.split_whitespace().collect::<Vec<_>>().join(" ") }
}

fn translit_char(c: char) -> Option<&'static str> {
    Some(match c {
        'а' => "a",
        'б' => "b",
        'в' => "v",
        'г' | 'ґ' => "g",
        'д' => "d",
        'е' | 'ё' | 'э' => "e",
        'є' => "ye",
        'ж' => "zh",
        'з' => "z",
        'и' | 'і' => "i",
        'ї' => "yi",
        'й' | 'ы' => "y",
        'к' => "k",
        'л' => "l",
        'м' => "m",
        'н' => "n",
        'о' => "o",
        'п' => "p",
        'р' => "r",
        'с' => "s",
        'т' => "t",
        'у' => "u",
        'ф' => "f",
        'х' => "kh",
        'ц' => "ts",
        'ч' => "ch",
        'ш' => "sh",
        'щ' => "shch",
        'ъ' | 'ь' => "",
        'ю' => "yu",
        'я' => "ya",
        _ => return None,
    })
}

pub fn translit(text: &str) -> String {
    let mut latin = String::new();
    for c in compare_form(text).chars() {
        match translit_char(c) {
            Some(s) => latin.push_str(s),
            None => latin.push(c),
        }
    }
    let folded = latin.replace("kh", "h").replace("ph", "f").replace("ck", "k").replace('w', "v").replace('q', "k").replace('x', "ks").replace(['y', 'j'], "i");
    let mut out = String::with_capacity(folded.len());
    for c in folded.chars() {
        if out.ends_with(c) && c != ' ' && !c.is_ascii_digit() {
            continue;
        }
        out.push(c);
    }
    out
}

fn levenshtein(a: &[char], b: &[char]) -> usize {
    let mut row: Vec<usize> = (0..=b.len()).collect();
    for (i, ca) in a.iter().enumerate() {
        let mut prev = row[0];
        row[0] = i + 1;
        for (j, cb) in b.iter().enumerate() {
            let next = (prev + usize::from(ca != cb)).min(row[j] + 1).min(row[j + 1] + 1);
            prev = row[j + 1];
            row[j + 1] = next;
        }
    }
    row[b.len()]
}

fn word_similarity(a: &str, b: &str) -> f64 {
    if a == b {
        return 1.0;
    }
    let (a, b): (Vec<char>, Vec<char>) = (a.chars().collect(), b.chars().collect());
    1.0 - levenshtein(&a, &b) as f64 / a.len().max(b.len()) as f64
}

// Inputs must already be in comparison form (see compare_form or translit)
pub fn similarity_of_forms(a: &str, b: &str) -> f64 {
    let capped = |s: &str| s.char_indices().nth(MAX_TEXT_CHARS).map_or(s.to_string(), |(i, _)| s[..i].to_string());
    let (a, b) = (capped(a), capped(b));
    let mut a: Vec<&str> = a.split(' ').filter(|w| !w.is_empty()).collect();
    let mut b: Vec<&str> = b.split(' ').filter(|w| !w.is_empty()).collect();
    if a.is_empty() || b.is_empty() {
        return 0.0;
    }
    a.sort_unstable();
    b.sort_unstable();
    if a == b {
        return 100.0;
    }
    let (short, long) = if a.len() <= b.len() { (&a, &b) } else { (&b, &a) };
    let mut quality = covered_quality(short, long);
    if short.len() == long.len() {
        quality = quality.min(covered_quality(long, short));
    }
    let coverage = short.len() as f64 / long.len() as f64;
    let mut score = 100.0 * quality * (0.4 + 0.6 * coverage);
    if short.len() == 1 && short[0].chars().count() >= 5 && long.len() <= 2 && long.contains(&short[0]) {
        score = score.max(72.0);
    }
    score.min(100.0)
}

fn covered_quality(from: &[&str], to: &[&str]) -> f64 {
    from.iter().map(|w| to.iter().map(|l| word_similarity(w, l)).fold(0.0, f64::max)).filter(|best| *best >= 0.8).sum::<f64>() / from.len() as f64
}

pub fn similarity(a: &str, b: &str) -> f64 {
    similarity_of_forms(&compare_form(a), &compare_form(b))
}

fn alias_group(form: &str) -> Option<usize> {
    ALIASES.iter().position(|group| group.contains(&form))
}

pub fn same_artist(a: &str, b: &str) -> bool {
    let (fa, fb) = (compare_form(a), compare_form(b));
    if fa.is_empty() || fb.is_empty() {
        return false;
    }
    let (sa, sb) = (fa.replace(' ', ""), fb.replace(' ', ""));
    let contains = |x: &str, y: &str, min: usize| x.chars().count() >= min && y.chars().count() >= min && (x.contains(y) || y.contains(x));
    if fa == fb || sa == sb || contains(&sa, &sb, 3) {
        return true;
    }
    if let (Some(ga), Some(gb)) = (alias_group(&fa), alias_group(&fb))
        && ga == gb
    {
        return true;
    }
    let (ta, tb) = (translit(a).replace(' ', ""), translit(b).replace(' ', ""));
    !ta.is_empty() && (ta == tb || contains(&ta, &tb, 4))
}
