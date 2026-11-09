use std::os::unix::fs::PermissionsExt;

use nuvo_crypto::{FallbackKeyStore, FileKeyStore, KeyStore, MasterKey, MemoryKeyStore};

const KEY: MasterKey = [7; 32];

fn file(dir: &tempfile::TempDir) -> FileKeyStore {
    FileKeyStore::new(dir.path().join("master.key"))
}

#[test]
fn without_a_secret_service_the_key_lives_in_a_private_file() {
    let dir = tempfile::tempdir().unwrap();
    let store = FallbackKeyStore::new(MemoryKeyStore::unavailable(), file(&dir));
    assert_eq!(store.load().unwrap(), None);
    store.save(&KEY).unwrap();
    assert_eq!(store.load().unwrap(), Some(KEY));
    let meta = dir.path().join("master.key").metadata().unwrap();
    assert_eq!(meta.permissions().mode() & 0o777, 0o600);
    assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
}

#[test]
fn the_keyring_wins_and_a_working_one_never_touches_the_file() {
    let dir = tempfile::tempdir().unwrap();
    let store = FallbackKeyStore::new(MemoryKeyStore::with_key(KEY), file(&dir));
    assert_eq!(store.load().unwrap(), Some(KEY));
    store.save(&[9; 32]).unwrap();
    assert!(!dir.path().join("master.key").exists());
}

#[test]
fn a_key_from_the_file_moves_into_a_keyring_that_came_back() {
    let dir = tempfile::tempdir().unwrap();
    file(&dir).save(&KEY).unwrap();
    let store = FallbackKeyStore::new(MemoryKeyStore::default(), file(&dir));
    assert_eq!(store.load().unwrap(), Some(KEY));
    assert!(!dir.path().join("master.key").exists());
    assert_eq!(store.load().unwrap(), Some(KEY));
}

#[test]
fn a_damaged_key_file_is_an_error_not_a_new_key() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("master.key"), b"short").unwrap();
    assert!(FallbackKeyStore::new(MemoryKeyStore::unavailable(), file(&dir)).load().is_err());
}

fn sealed(dir: &tempfile::TempDir) -> FileKeyStore {
    FileKeyStore::new(dir.path().join("master.key")).with_rounds(1000)
}

#[test]
fn a_passphrase_seals_the_key_file_and_is_needed_to_open_it() {
    use nuvo_crypto::{KeyStoreError, Protection};
    let dir = tempfile::tempdir().unwrap();
    let store = FallbackKeyStore::new(MemoryKeyStore::unavailable(), sealed(&dir));
    store.save(&KEY).unwrap();
    assert_eq!(store.protection(), Protection::File);
    store.set_passphrase(&KEY, Some("correct horse")).unwrap();
    assert_eq!(store.protection(), Protection::Passphrase);
    let on_disk = std::fs::read(dir.path().join("master.key")).unwrap();
    assert!(!on_disk.windows(32).any(|w| w == KEY), "the key must not sit in the file in the clear");
    assert_eq!(dir.path().join("master.key").metadata().unwrap().permissions().mode() & 0o777, 0o600);

    let again = FallbackKeyStore::new(MemoryKeyStore::unavailable(), sealed(&dir));
    assert!(matches!(again.load(), Err(KeyStoreError::NeedsPassphrase)));
    assert!(matches!(again.unlock_with_passphrase("wrong"), Err(KeyStoreError::WrongPassphrase)));
    assert!(matches!(again.load(), Err(KeyStoreError::NeedsPassphrase)));
    assert_eq!(again.unlock_with_passphrase("correct horse").unwrap(), KEY);
    assert_eq!(again.load().unwrap(), Some(KEY));
    again.save(&KEY).unwrap();
    assert_eq!(again.protection(), Protection::Passphrase);
}

#[test]
fn removing_the_passphrase_writes_the_key_plain_again() {
    use nuvo_crypto::Protection;
    let dir = tempfile::tempdir().unwrap();
    let store = FallbackKeyStore::new(MemoryKeyStore::unavailable(), sealed(&dir));
    store.save(&KEY).unwrap();
    store.set_passphrase(&KEY, Some("correct horse")).unwrap();
    store.set_passphrase(&KEY, None).unwrap();
    assert_eq!(store.protection(), Protection::File);
    assert_eq!(FallbackKeyStore::new(MemoryKeyStore::unavailable(), sealed(&dir)).load().unwrap(), Some(KEY));
}

#[test]
fn a_keyring_has_no_file_to_seal() {
    use nuvo_crypto::{KeyStoreError, Protection};
    let dir = tempfile::tempdir().unwrap();
    let store = FallbackKeyStore::new(MemoryKeyStore::with_key(KEY), sealed(&dir));
    assert_eq!(store.protection(), Protection::Keyring);
    assert!(matches!(store.set_passphrase(&KEY, Some("x")), Err(KeyStoreError::NoFile)));
}
