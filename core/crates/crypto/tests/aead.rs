use nuvo_crypto::*;

#[test]
fn chunk_round_trip() {
    let cipher = ChunkCipher::new(&[1u8; 32]);
    let prefix = [2u8; NONCE_PREFIX_LEN];
    let sealed = cipher.seal(&prefix, 0, b"hello");
    assert_eq!(sealed.len(), 5 + TAG_LEN);
    assert_eq!(cipher.open(&prefix, 0, &sealed).unwrap(), b"hello");
}

#[test]
fn chunk_is_bound_to_its_index_prefix_and_key() {
    let cipher = ChunkCipher::new(&[1u8; 32]);
    let prefix = [2u8; NONCE_PREFIX_LEN];
    let sealed = cipher.seal(&prefix, 3, b"data");
    assert!(cipher.open(&prefix, 4, &sealed).is_err(), "reordered chunk must fail");
    assert!(cipher.open(&[9u8; NONCE_PREFIX_LEN], 3, &sealed).is_err());
    assert!(ChunkCipher::new(&[8u8; 32]).open(&prefix, 3, &sealed).is_err());
    let mut tampered = sealed.clone();
    tampered[0] ^= 1;
    assert!(cipher.open(&prefix, 3, &tampered).is_err());
}

#[test]
fn plain_len_inverts_the_chunk_layout() {
    let full = CHUNK_CIPHER as u64;
    assert_eq!(plain_len(0), 0);
    assert_eq!(plain_len(10 + TAG_LEN as u64), 10);
    assert_eq!(plain_len(full), CHUNK_PLAIN as u64);
    assert_eq!(plain_len(2 * full + 1 + TAG_LEN as u64), 2 * CHUNK_PLAIN as u64 + 1);
}
