use hkdf::Hkdf;
use rand::RngExt;
use sha2::{Digest, Sha256};

pub type MasterKey = [u8; 32];

pub fn random_bytes<const N: usize>() -> [u8; N] {
    let mut out = [0u8; N];
    rand::rng().fill(&mut out);
    out
}

/// Subkey for one purpose. `info` strings carry a version so a new scheme can coexist with old data.
pub fn derive_key(master: &MasterKey, info: &str) -> [u8; 32] {
    let mut out = [0u8; 32];
    Hkdf::<Sha256>::new(None, master)
        .expand(info.as_bytes(), &mut out)
        .expect("32 bytes is a valid HKDF-SHA256 output length");
    out
}

pub fn phrase_from_key(master: &MasterKey) -> String {
    bip39::Mnemonic::from_entropy(master)
        .expect("32 bytes is valid BIP39 entropy")
        .to_string()
}

#[derive(Debug, thiserror::Error)]
#[error("invalid recovery phrase")]
pub struct InvalidPhrase;

pub fn key_from_phrase(phrase: &str) -> Result<MasterKey, InvalidPhrase> {
    let normalized = phrase
        .split_whitespace()
        .map(str::to_lowercase)
        .collect::<Vec<_>>()
        .join(" ");
    let mnemonic = bip39::Mnemonic::parse_normalized(&normalized).map_err(|_| InvalidPhrase)?;
    mnemonic.to_entropy().try_into().map_err(|_| InvalidPhrase)
}

pub fn to_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

pub fn sha256_hex(data: &[u8]) -> String {
    to_hex(&Sha256::digest(data))
}
