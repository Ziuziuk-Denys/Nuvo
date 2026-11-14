// Byte-level BPE as in tiktoken: a token's id is its merge rank

use std::collections::HashMap;

pub const EOT: u32 = 50257;
pub const SOT: u32 = 50258;
pub const FIRST_LANGUAGE: u32 = 50259;
pub const TRANSLATE: u32 = 50358;
pub const TRANSCRIBE: u32 = 50359;
pub const NO_SPEECH: u32 = 50362;
pub const NO_TIMESTAMPS: u32 = 50363;
/// `<|0.00|>`; each next token is 20 ms later.
pub const FIRST_TIMESTAMP: u32 = 50364;
/// In token order from `FIRST_LANGUAGE`.
pub const LANGUAGES: [&str; 99] = [
    "en", "zh", "de", "es", "ru", "ko", "fr", "ja", "pt", "tr", "pl", "ca", "nl", "ar", "sv", "it", "id", "hi", "fi", "vi", "he", "uk", "el", "ms", "cs", "ro", "da", "hu", "ta", "no", "th", "ur", "hr", "bg", "lt", "la", "mi", "ml", "cy", "sk", "te", "fa", "lv", "bn", "sr", "az", "sl", "kn", "et", "mk", "br", "eu", "is", "hy", "ne", "mn", "bs", "kk", "sq", "sw", "gl", "mr", "pa", "si", "km", "sn", "yo", "so", "af", "oc", "ka", "be", "tg", "sd", "gu", "am", "yi", "lo", "uz", "fo", "ht", "ps", "tk", "nn", "mt", "sa", "lb", "my", "bo", "tl", "mg", "as", "tt", "haw", "ln", "ha", "ba", "jw", "su",
];
/// Multilingual tiny, base and small; large-v3 adds a language and shifts every special token.
pub const MULTILINGUAL_VOCAB: usize = 51865;

pub struct Tokenizer {
    ranks: HashMap<Vec<u8>, u32>,
    vocab: Vec<Vec<u8>>,
}

impl Tokenizer {
    pub fn new(vocab: &[Vec<u8>]) -> Self {
        Self { ranks: vocab.iter().enumerate().map(|(rank, bytes)| (bytes.clone(), rank as u32)).collect(), vocab: vocab.to_vec() }
    }

    pub fn decode(&self, tokens: &[u32]) -> String {
        let bytes: Vec<u8> = tokens.iter().filter(|t| **t < EOT).filter_map(|t| self.vocab.get(*t as usize)).flatten().copied().collect();
        String::from_utf8_lossy(&bytes).into_owned()
    }

    pub fn encode(&self, text: &str) -> Vec<u32> {
        pieces(text).into_iter().flat_map(|piece| self.merge(piece.as_bytes())).collect()
    }

    fn merge(&self, bytes: &[u8]) -> Vec<u32> {
        if let Some(rank) = self.ranks.get(bytes) {
            return vec![*rank];
        }
        let mut parts: Vec<Vec<u8>> = bytes.iter().map(|b| vec![*b]).collect();
        loop {
            let best = parts
                .windows(2)
                .enumerate()
                .filter_map(|(at, pair)| self.ranks.get(&[pair[0].as_slice(), pair[1].as_slice()].concat()).map(|rank| (*rank, at)))
                .min();
            let Some((_, at)) = best else { break };
            let next = parts.remove(at + 1);
            parts[at].extend(next);
        }
        parts.iter().filter_map(|part| self.ranks.get(part).copied()).collect()
    }
}

#[derive(PartialEq, Clone, Copy)]
enum Class {
    Letter,
    Number,
    Other,
    Space,
}

fn class(c: char) -> Class {
    if c.is_alphabetic() {
        Class::Letter
    } else if c.is_numeric() {
        Class::Number
    } else if c.is_whitespace() {
        Class::Space
    } else {
        Class::Other
    }
}

const CONTRACTIONS: [&str; 7] = ["'s", "'t", "'re", "'ve", "'m", "'ll", "'d"];

/// The GPT-2 split: contractions, then runs of letters, digits or symbols, each with at most one leading space.
fn pieces(text: &str) -> Vec<&str> {
    let mut out = Vec::new();
    let mut rest = text;
    while let Some(first) = rest.chars().next() {
        if let Some(contraction) = CONTRACTIONS.iter().find(|c| rest.starts_with(**c)) {
            out.push(&rest[..contraction.len()]);
            rest = &rest[contraction.len()..];
            continue;
        }
        let lead = if first == ' ' && rest[1..].chars().next().is_some_and(|c| class(c) != Class::Space) { 1 } else { 0 };
        let kind = class(rest[lead..].chars().next().expect("a char follows"));
        let length = lead + rest[lead..].chars().take_while(|c| class(*c) == kind).map(char::len_utf8).sum::<usize>();
        out.push(&rest[..length]);
        rest = &rest[length..];
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_like_gpt2() {
        assert_eq!(pieces(" don't stop,"), [" don", "'t", " stop", ","]);
        assert_eq!(pieces("Слёзы — это"), ["Слёзы", " —", " это"]);
        assert_eq!(pieces(" 1999!"), [" 1999", "!"]);
    }

    #[test]
    fn merges_the_lowest_rank_first() {
        let vocab: Vec<Vec<u8>> = [&b"a"[..], b"b", b"c", b"ab", b"bc", b"abc"].iter().map(|t| t.to_vec()).collect();
        let tokenizer = Tokenizer::new(&vocab);
        assert_eq!(tokenizer.encode("abc"), [5]);
        assert_eq!(tokenizer.encode("cab"), [2, 3]);
        assert_eq!(tokenizer.decode(&[2, 3, EOT, 5]), "cababc");
    }
}
