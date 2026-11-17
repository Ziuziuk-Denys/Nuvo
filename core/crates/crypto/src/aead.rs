use chacha20poly1305::aead::{Aead, KeyInit};
use chacha20poly1305::{Key, XChaCha20Poly1305, XNonce};

pub const CHUNK_PLAIN: usize = 64 * 1024;
pub const TAG_LEN: usize = 16;
pub const CHUNK_CIPHER: usize = CHUNK_PLAIN + TAG_LEN;
pub const NONCE_PREFIX_LEN: usize = 16;

#[derive(Debug, thiserror::Error)]
#[error("chunk failed authentication")]
pub struct ChunkError;

// Chunks seal independently for random access; nonce = 16-byte file prefix || u64 BE index
pub struct ChunkCipher {
    cipher: XChaCha20Poly1305,
}

impl ChunkCipher {
    pub fn new(key: &[u8; 32]) -> Self {
        Self { cipher: XChaCha20Poly1305::new(&Key::from(*key)) }
    }

    fn nonce(prefix: &[u8; NONCE_PREFIX_LEN], index: u64) -> XNonce {
        let mut nonce = [0u8; 24];
        nonce[..NONCE_PREFIX_LEN].copy_from_slice(prefix);
        nonce[NONCE_PREFIX_LEN..].copy_from_slice(&index.to_be_bytes());
        XNonce::from(nonce)
    }

    pub fn seal(&self, prefix: &[u8; NONCE_PREFIX_LEN], index: u64, plain: &[u8]) -> Vec<u8> {
        self.cipher
            .encrypt(&Self::nonce(prefix, index), plain)
            .expect("in-memory encryption does not fail")
    }

    pub fn open(&self, prefix: &[u8; NONCE_PREFIX_LEN], index: u64, sealed: &[u8]) -> Result<Vec<u8>, ChunkError> {
        self.cipher
            .decrypt(&Self::nonce(prefix, index), sealed)
            .map_err(|_| ChunkError)
    }
}

pub fn plain_len(sealed_len: u64) -> u64 {
    let full = sealed_len / CHUNK_CIPHER as u64;
    let rest = sealed_len % CHUNK_CIPHER as u64;
    full * CHUNK_PLAIN as u64 + rest.saturating_sub(TAG_LEN as u64)
}

const VALUE_NONCE_LEN: usize = 24;

// Small values seal whole under a random nonce stored in front
pub fn seal_value(key: &[u8; 32], plain: &[u8]) -> Vec<u8> {
    let nonce: [u8; VALUE_NONCE_LEN] = crate::random_bytes();
    let mut out = nonce.to_vec();
    out.extend(XChaCha20Poly1305::new(&Key::from(*key)).encrypt(&XNonce::from(nonce), plain).expect("in-memory encryption does not fail"));
    out
}

pub fn open_value(key: &[u8; 32], sealed: &[u8]) -> Result<Vec<u8>, ChunkError> {
    if sealed.len() < VALUE_NONCE_LEN {
        return Err(ChunkError);
    }
    let (nonce, body) = sealed.split_at(VALUE_NONCE_LEN);
    let nonce: [u8; VALUE_NONCE_LEN] = nonce.try_into().expect("nonce length");
    XChaCha20Poly1305::new(&Key::from(*key)).decrypt(&XNonce::from(nonce), body).map_err(|_| ChunkError)
}
