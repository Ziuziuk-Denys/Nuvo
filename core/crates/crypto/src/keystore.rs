use std::fs::OpenOptions;
use std::io::Write;
use std::os::unix::fs::OpenOptionsExt;
use std::path::PathBuf;
use std::sync::Mutex;

use chacha20poly1305::aead::{Aead, KeyInit};
use chacha20poly1305::{ChaCha20Poly1305, Key, Nonce};
use sha2::{Digest, Sha256};

use crate::{MasterKey, random_bytes};

#[derive(Debug, thiserror::Error)]
pub enum KeyStoreError {
    #[error("secret service unavailable: {0}")]
    Unavailable(String),
    #[error("stored key has the wrong length")]
    Malformed,
    #[error("the key file is protected by a passphrase")]
    NeedsPassphrase,
    #[error("wrong passphrase")]
    WrongPassphrase,
    #[error("this key store keeps the key in the system keyring")]
    NoFile,
}

/// Where the master key lives, from the weakest protection to the strongest.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Protection {
    /// The system keyring.
    Keyring,
    /// A private file, because there is no keyring: anyone who can read the user's files can read it.
    File,
    /// A private file sealed with a passphrase only the user knows.
    Passphrase,
}

pub trait KeyStore: Send + Sync {
    fn load(&self) -> Result<Option<MasterKey>, KeyStoreError>;
    fn save(&self, key: &MasterKey) -> Result<(), KeyStoreError>;

    fn protection(&self) -> Protection {
        Protection::Keyring
    }

    /// Opens a passphrase-sealed key file; later saves keep it sealed with the same passphrase.
    fn unlock_with_passphrase(&self, _passphrase: &str) -> Result<MasterKey, KeyStoreError> {
        Err(KeyStoreError::NoFile)
    }

    /// Seals the key file with `passphrase`, or writes it plain again for `None`.
    fn set_passphrase(&self, _key: &MasterKey, _passphrase: Option<&str>) -> Result<(), KeyStoreError> {
        Err(KeyStoreError::NoFile)
    }
}

const SEALED_MAGIC: &[u8; 4] = b"NKP1";
/// PBKDF2-HMAC-SHA256 rounds for a new sealed file; the count is stored in the file.
pub const KDF_ROUNDS: u32 = 300_000;
const SEALED_LEN: usize = 4 + 4 + 16 + 12 + 32 + 16;

/// PBKDF2-HMAC-SHA256 for one 32-byte block, with the padded keys hashed once.
fn pbkdf2(passphrase: &[u8], salt: &[u8], rounds: u32) -> [u8; 32] {
    let mut block = [0u8; 64];
    if passphrase.len() > 64 {
        block[..32].copy_from_slice(&Sha256::digest(passphrase));
    } else {
        block[..passphrase.len()].copy_from_slice(passphrase);
    }
    let pad = |byte: u8| Sha256::new_with_prefix(block.map(|b| b ^ byte));
    let (inner, outer) = (pad(0x36), pad(0x5c));
    let mac = |data: &[u8]| -> [u8; 32] {
        let mut first = inner.clone();
        first.update(data);
        let mut second = outer.clone();
        second.update(first.finalize());
        second.finalize().into()
    };
    let mut seed = salt.to_vec();
    seed.extend_from_slice(&1u32.to_be_bytes());
    let mut last = mac(&seed);
    let mut out = last;
    for _ in 1..rounds {
        last = mac(&last);
        for (o, l) in out.iter_mut().zip(last) {
            *o ^= l;
        }
    }
    out
}

fn seal(key: &MasterKey, passphrase: &str, rounds: u32) -> Vec<u8> {
    let salt: [u8; 16] = random_bytes();
    let nonce: [u8; 12] = random_bytes();
    let cipher = ChaCha20Poly1305::new(&Key::from(pbkdf2(passphrase.as_bytes(), &salt, rounds)));
    let sealed = cipher.encrypt(&Nonce::from(nonce), key.as_slice()).expect("in-memory encryption does not fail");
    let mut out = Vec::with_capacity(SEALED_LEN);
    out.extend_from_slice(SEALED_MAGIC);
    out.extend_from_slice(&rounds.to_be_bytes());
    out.extend_from_slice(&salt);
    out.extend_from_slice(&nonce);
    out.extend_from_slice(&sealed);
    out
}

fn open_sealed(bytes: &[u8], passphrase: &str) -> Result<MasterKey, KeyStoreError> {
    if bytes.len() != SEALED_LEN || &bytes[..4] != SEALED_MAGIC {
        return Err(KeyStoreError::Malformed);
    }
    let rounds = u32::from_be_bytes(bytes[4..8].try_into().expect("4 bytes"));
    // a damaged count must not turn into hours of hashing
    if !(1..=10_000_000).contains(&rounds) {
        return Err(KeyStoreError::Malformed);
    }
    let cipher = ChaCha20Poly1305::new(&Key::from(pbkdf2(passphrase.as_bytes(), &bytes[8..24], rounds)));
    let nonce: [u8; 12] = bytes[24..36].try_into().expect("12 bytes");
    let plain = cipher.decrypt(&Nonce::from(nonce), &bytes[36..]).map_err(|_| KeyStoreError::WrongPassphrase)?;
    plain.try_into().map_err(|_| KeyStoreError::Malformed)
}

/// Master key in the Secret Service (GNOME Keyring), item `service` / `master-key`.
pub struct KeyringStore {
    service: String,
}

impl KeyringStore {
    pub fn new(service: impl Into<String>) -> Self {
        Self { service: service.into() }
    }

    fn entry(&self) -> Result<keyring::Entry, KeyStoreError> {
        keyring::Entry::new(&self.service, "master-key").map_err(|e| KeyStoreError::Unavailable(e.to_string()))
    }

    pub fn delete(&self) -> Result<(), KeyStoreError> {
        self.entry()?
            .delete_credential()
            .map_err(|e| KeyStoreError::Unavailable(e.to_string()))
    }
}

impl KeyStore for KeyringStore {
    fn load(&self) -> Result<Option<MasterKey>, KeyStoreError> {
        match self.entry()?.get_secret() {
            Ok(bytes) => bytes.try_into().map(Some).map_err(|_| KeyStoreError::Malformed),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(KeyStoreError::Unavailable(e.to_string())),
        }
    }

    fn save(&self, key: &MasterKey) -> Result<(), KeyStoreError> {
        self.entry()?
            .set_secret(key)
            .map_err(|e| KeyStoreError::Unavailable(e.to_string()))
    }
}

/// The master key in a private file, for sessions with no Secret Service. Without a passphrase
/// nothing could encrypt it, so its protection is the 0600 file in the 0700 data directory: weaker
/// than a keyring, better than a player that cannot start. A passphrase the user sets seals it.
pub struct FileKeyStore {
    path: PathBuf,
    rounds: u32,
    /// The passphrase of a sealed file, kept in memory once it opened the file.
    passphrase: Mutex<Option<String>>,
}

impl FileKeyStore {
    pub fn new(path: impl Into<PathBuf>) -> Self {
        Self { path: path.into(), rounds: KDF_ROUNDS, passphrase: Mutex::new(None) }
    }

    /// Fewer rounds, for tests: the real count would make every case take seconds.
    pub fn with_rounds(mut self, rounds: u32) -> Self {
        self.rounds = rounds;
        self
    }

    fn remove(&self) {
        if let Err(err) = std::fs::remove_file(&self.path) {
            tracing::warn!(%err, "the key file could not be removed");
        }
    }

    fn read(&self) -> Result<Option<Vec<u8>>, KeyStoreError> {
        match std::fs::read(&self.path) {
            Ok(bytes) => Ok(Some(bytes)),
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(err) => Err(KeyStoreError::Unavailable(err.to_string())),
        }
    }

    fn write(&self, bytes: &[u8]) -> Result<(), KeyStoreError> {
        let failed = |err: std::io::Error| KeyStoreError::Unavailable(err.to_string());
        let dir = self.path.parent().ok_or_else(|| KeyStoreError::Unavailable("no directory".into()))?;
        std::fs::create_dir_all(dir).map_err(failed)?;
        let partial = self.path.with_extension("partial");
        let mut file = OpenOptions::new().write(true).create(true).truncate(true).mode(0o600).open(&partial).map_err(failed)?;
        file.write_all(bytes).and_then(|()| file.sync_all()).map_err(failed)?;
        std::fs::rename(&partial, &self.path).map_err(failed)
    }

    fn is_sealed(bytes: &[u8]) -> bool {
        bytes.starts_with(SEALED_MAGIC)
    }
}

impl KeyStore for FileKeyStore {
    fn load(&self) -> Result<Option<MasterKey>, KeyStoreError> {
        let Some(bytes) = self.read()? else { return Ok(None) };
        if !Self::is_sealed(&bytes) {
            return bytes.try_into().map(Some).map_err(|_| KeyStoreError::Malformed);
        }
        match self.passphrase.lock().expect("passphrase mutex").as_deref() {
            Some(passphrase) => open_sealed(&bytes, passphrase).map(Some),
            None => Err(KeyStoreError::NeedsPassphrase),
        }
    }

    fn save(&self, key: &MasterKey) -> Result<(), KeyStoreError> {
        match self.passphrase.lock().expect("passphrase mutex").as_deref() {
            Some(passphrase) => self.write(&seal(key, passphrase, self.rounds)),
            None => self.write(key),
        }
    }

    fn protection(&self) -> Protection {
        match self.read() {
            Ok(Some(bytes)) if Self::is_sealed(&bytes) => Protection::Passphrase,
            Ok(Some(_)) => Protection::File,
            _ => Protection::Keyring,
        }
    }

    fn unlock_with_passphrase(&self, passphrase: &str) -> Result<MasterKey, KeyStoreError> {
        let bytes = self.read()?.ok_or(KeyStoreError::NoFile)?;
        if !Self::is_sealed(&bytes) {
            return Err(KeyStoreError::NoFile);
        }
        let key = open_sealed(&bytes, passphrase)?;
        *self.passphrase.lock().expect("passphrase mutex") = Some(passphrase.to_string());
        Ok(key)
    }

    fn set_passphrase(&self, key: &MasterKey, passphrase: Option<&str>) -> Result<(), KeyStoreError> {
        if self.read()?.is_none() {
            return Err(KeyStoreError::NoFile);
        }
        match passphrase {
            Some(passphrase) => self.write(&seal(key, passphrase, self.rounds))?,
            None => self.write(key)?,
        }
        *self.passphrase.lock().expect("passphrase mutex") = passphrase.map(str::to_string);
        Ok(())
    }
}

/// The keyring while it answers, the file when it does not. A key that had to live in the file
/// moves into the keyring as soon as one is there.
pub struct FallbackKeyStore<P> {
    primary: P,
    file: FileKeyStore,
}

impl<P: KeyStore> FallbackKeyStore<P> {
    pub fn new(primary: P, file: FileKeyStore) -> Self {
        Self { primary, file }
    }
}

impl<P: KeyStore> KeyStore for FallbackKeyStore<P> {
    fn load(&self) -> Result<Option<MasterKey>, KeyStoreError> {
        match self.primary.load() {
            Ok(Some(key)) => Ok(Some(key)),
            Ok(None) => {
                let key = self.file.load()?;
                if let Some(key) = &key
                    && self.primary.save(key).is_ok()
                {
                    self.file.remove();
                }
                Ok(key)
            }
            Err(KeyStoreError::Unavailable(reason)) => {
                tracing::warn!(reason, "no secret service, using the key file");
                self.file.load()
            }
            Err(err) => Err(err),
        }
    }

    fn save(&self, key: &MasterKey) -> Result<(), KeyStoreError> {
        match self.primary.save(key) {
            Ok(()) => Ok(()),
            Err(err) => {
                tracing::warn!(%err, "no secret service, keeping the key in a private file");
                self.file.save(key)
            }
        }
    }

    fn protection(&self) -> Protection {
        self.file.protection()
    }

    fn unlock_with_passphrase(&self, passphrase: &str) -> Result<MasterKey, KeyStoreError> {
        self.file.unlock_with_passphrase(passphrase)
    }

    fn set_passphrase(&self, key: &MasterKey, passphrase: Option<&str>) -> Result<(), KeyStoreError> {
        self.file.set_passphrase(key, passphrase)
    }
}

/// Test double; `unavailable()` behaves like a session without a Secret Service.
#[derive(Default)]
pub struct MemoryKeyStore {
    key: Mutex<Option<MasterKey>>,
    unavailable: bool,
}

impl MemoryKeyStore {
    pub fn with_key(key: MasterKey) -> Self {
        Self { key: Mutex::new(Some(key)), unavailable: false }
    }

    pub fn unavailable() -> Self {
        Self { key: Mutex::new(None), unavailable: true }
    }
}

impl KeyStore for MemoryKeyStore {
    fn load(&self) -> Result<Option<MasterKey>, KeyStoreError> {
        if self.unavailable {
            return Err(KeyStoreError::Unavailable("test".into()));
        }
        Ok(*self.key.lock().expect("keystore mutex"))
    }

    fn save(&self, key: &MasterKey) -> Result<(), KeyStoreError> {
        if self.unavailable {
            return Err(KeyStoreError::Unavailable("test".into()));
        }
        *self.key.lock().expect("keystore mutex") = Some(*key);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pbkdf2_matches_the_rfc_7914_vector() {
        let key = pbkdf2(b"passwd", b"salt", 1);
        assert_eq!(crate::to_hex(&key), "55ac046e56e3089fec1691c22544b605f94185216dde0465e68b9d57c20dacbc");
    }
}
