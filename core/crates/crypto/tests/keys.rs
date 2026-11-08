use nuvo_crypto::*;

#[test]
fn derived_keys_are_stable_and_domain_separated() {
    let master = [7u8; 32];
    assert_eq!(derive_key(&master, "nuvo/db/v1"), derive_key(&master, "nuvo/db/v1"));
    assert_ne!(derive_key(&master, "nuvo/db/v1"), derive_key(&master, "nuvo/audio/v1"));
    assert_ne!(derive_key(&master, "nuvo/db/v1"), master);
}

#[test]
fn phrase_round_trips_to_the_same_key() {
    let master: MasterKey = random_bytes();
    let phrase = phrase_from_key(&master);
    assert_eq!(phrase.split(' ').count(), 24);
    assert_eq!(key_from_phrase(&phrase).unwrap(), master);
}

#[test]
fn phrase_parsing_tolerates_case_and_extra_whitespace() {
    let master = [42u8; 32];
    let messy = format!("  {}\n", phrase_from_key(&master).to_uppercase().replace(' ', "   "));
    assert_eq!(key_from_phrase(&messy).unwrap(), master);
}

#[test]
fn bad_phrases_are_rejected() {
    let phrase = phrase_from_key(&[1u8; 32]);
    let mut words: Vec<&str> = phrase.split(' ').collect();
    words.swap(0, 1);
    assert!(key_from_phrase(&words.join(" ")).is_err(), "checksum must catch swapped words");
    assert!(key_from_phrase(&words[..12].join(" ")).is_err(), "12 words is not a 256-bit key");
    assert!(key_from_phrase("").is_err());
}

#[test]
fn hex_helpers() {
    assert_eq!(to_hex(&[0x00, 0xab, 0xff]), "00abff");
    assert_eq!(sha256_hex(b"abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
}

#[test]
fn memory_keystore_saves_and_loads() {
    let store = MemoryKeyStore::default();
    assert_eq!(store.load().unwrap(), None);
    store.save(&[9u8; 32]).unwrap();
    assert_eq!(store.load().unwrap(), Some([9u8; 32]));
    assert!(MemoryKeyStore::unavailable().load().is_err());
}

// Touches the real Secret Service; run explicitly with `cargo test -p nuvo-crypto -- --ignored`.
#[test]
#[ignore]
fn keyring_store_round_trip() {
    let store = KeyringStore::new("nuvo-core-test");
    store.save(&[5u8; 32]).unwrap();
    assert_eq!(store.load().unwrap(), Some([5u8; 32]));
    store.delete().unwrap();
    assert_eq!(store.load().unwrap(), None);
}
