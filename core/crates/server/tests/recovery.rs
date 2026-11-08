mod common;

use axum::http::StatusCode;
use nuvo_crypto::{KeyStore, MemoryKeyStore, phrase_from_key};
use serde_json::json;

#[tokio::test]
async fn phrase_is_shown_until_confirmed() {
    let core = common::core();
    let (status, body) = common::call(&core.app, "GET", "/v1/recovery/phrase", None).await;
    assert_eq!(status, StatusCode::OK);
    let phrase = body["phrase"].as_str().unwrap().to_string();
    assert_eq!(phrase.split(' ').count(), 24);
    assert_eq!(common::call(&core.app, "GET", "/v1/recovery/phrase", None).await.1["phrase"], phrase.as_str(), "stable across calls");

    assert_eq!(common::call(&core.app, "POST", "/v1/recovery/confirm", None).await.0, StatusCode::NO_CONTENT);
    assert_eq!(common::call(&core.app, "GET", "/v1/recovery/phrase", None).await.0, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn restore_unlocks_with_the_right_phrase_only() {
    let first = common::core();
    let phrase = common::call(&first.app, "GET", "/v1/recovery/phrase", None).await.1["phrase"].as_str().unwrap().to_string();
    let store = std::sync::Arc::new(MemoryKeyStore::default());
    let core = common::boot(first.dir, Shared(store.clone()), "http://127.0.0.1:9");
    assert!(core.state.is_locked());

    let (status, body) = common::call(&core.app, "POST", "/v1/recovery/restore", Some(json!({"phrase": "not a phrase"}))).await;
    assert_eq!((status, body["code"].as_str()), (StatusCode::BAD_REQUEST, Some("INVALID_INPUT")));

    let other = phrase_from_key(&[1u8; 32]);
    let (status, _) = common::call(&core.app, "POST", "/v1/recovery/restore", Some(json!({"phrase": other}))).await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "a valid phrase for another key must not unlock");
    assert!(core.state.is_locked());

    let (status, _) = common::call(&core.app, "POST", "/v1/recovery/restore", Some(json!({"phrase": phrase.to_uppercase()}))).await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    assert!(!core.state.is_locked());
    assert!(store.load().unwrap().is_some(), "recovered key is saved back to the keyring");
    assert_eq!(common::call(&core.app, "GET", "/v1/recovery/phrase", None).await.0, StatusCode::NOT_FOUND, "restoring proves the user has the phrase");
    assert_eq!(common::call(&core.app, "POST", "/v1/recovery/restore", Some(json!({"phrase": phrase}))).await.0, StatusCode::CONFLICT);
}

#[tokio::test]
async fn phrase_routes_are_locked_while_locked() {
    let first = common::core();
    let core = common::boot(first.dir, MemoryKeyStore::default(), "http://127.0.0.1:9");
    assert_eq!(common::call(&core.app, "GET", "/v1/recovery/phrase", None).await.0, StatusCode::LOCKED);
}

struct Shared(std::sync::Arc<MemoryKeyStore>);

impl KeyStore for Shared {
    fn load(&self) -> Result<Option<nuvo_crypto::MasterKey>, nuvo_crypto::KeyStoreError> {
        self.0.load()
    }
    fn save(&self, key: &nuvo_crypto::MasterKey) -> Result<(), nuvo_crypto::KeyStoreError> {
        self.0.save(key)
    }
}

fn file_store(dir: &std::path::Path) -> nuvo_crypto::FallbackKeyStore<MemoryKeyStore> {
    nuvo_crypto::FallbackKeyStore::new(MemoryKeyStore::unavailable(), nuvo_crypto::FileKeyStore::new(dir.join("master.key")).with_rounds(1000))
}

#[tokio::test]
async fn a_key_file_can_be_sealed_with_a_passphrase_and_opens_the_library_again() {
    let keys = tempfile::tempdir().unwrap();
    let first = common::boot(tempfile::tempdir().unwrap(), file_store(keys.path()), "http://127.0.0.1:9");
    let (_, storage) = common::call(&first.app, "GET", "/v1/system/key-storage", None).await;
    assert_eq!(storage["protection"], "file", "no keyring: the plain file is what Settings warns about");

    let (status, _) = common::call(&first.app, "PUT", "/v1/system/key-passphrase", Some(json!({"passphrase": "short"}))).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let (status, storage) = common::call(&first.app, "PUT", "/v1/system/key-passphrase", Some(json!({"passphrase": "correct horse"}))).await;
    assert_eq!((status, storage["protection"].as_str()), (StatusCode::OK, Some("passphrase")));

    let second = common::boot(first.dir, file_store(keys.path()), "http://127.0.0.1:9");
    assert!(second.state.is_locked());
    let (_, health) = common::call(&second.app, "GET", "/health", None).await;
    assert_eq!((health["locked"].as_bool(), health["passphrase"].as_bool()), (Some(true), Some(true)));
    let (status, _) = common::call(&second.app, "POST", "/v1/recovery/passphrase", Some(json!({"passphrase": "wrong horse"}))).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(second.state.is_locked());
    let (status, _) = common::call(&second.app, "POST", "/v1/recovery/passphrase", Some(json!({"passphrase": "correct horse"}))).await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    assert!(!second.state.is_locked());
    let (_, health) = common::call(&second.app, "GET", "/health", None).await;
    assert!(health.get("passphrase").is_none(), "an open library asks for nothing");

    let (status, storage) = common::call(&second.app, "PUT", "/v1/system/key-passphrase", Some(json!({"passphrase": null}))).await;
    assert_eq!((status, storage["protection"].as_str()), (StatusCode::OK, Some("file")));
}

#[tokio::test]
async fn a_keyring_needs_no_passphrase() {
    let core = common::core();
    let (_, storage) = common::call(&core.app, "GET", "/v1/system/key-storage", None).await;
    assert_eq!(storage["protection"], "keyring");
    let (status, _) = common::call(&core.app, "PUT", "/v1/system/key-passphrase", Some(json!({"passphrase": "correct horse"}))).await;
    assert_eq!(status, StatusCode::CONFLICT);
}
