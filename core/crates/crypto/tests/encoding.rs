use nuvo_crypto::{base64_decode, base64_encode};

#[test]
fn base64_matches_the_rfc_4648_vectors() {
    let vectors = [("", ""), ("f", "Zg=="), ("fo", "Zm8="), ("foo", "Zm9v"), ("foob", "Zm9vYg=="), ("fooba", "Zm9vYmE="), ("foobar", "Zm9vYmFy")];
    for (plain, encoded) in vectors {
        assert_eq!(base64_encode(plain.as_bytes()), encoded);
        assert_eq!(base64_decode(encoded).unwrap(), plain.as_bytes());
        assert_eq!(base64_decode(encoded.trim_end_matches('=')).unwrap(), plain.as_bytes(), "padding is optional");
    }
    let bytes: Vec<u8> = (0..=255).collect();
    assert_eq!(base64_decode(&base64_encode(&bytes)).unwrap(), bytes);
}

#[test]
fn base64_rejects_characters_outside_the_alphabet() {
    assert_eq!(base64_decode("Zm9v!"), None);
    assert_eq!(base64_decode("Zm 9v"), None);
    assert_eq!(base64_decode("Zm9v-_"), None, "the URL-safe alphabet is not accepted");
}
