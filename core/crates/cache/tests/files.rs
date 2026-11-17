use nuvo_cache::{AudioCache, CacheError};
use nuvo_crypto::{CHUNK_PLAIN, random_bytes};

fn sample(len: usize) -> Vec<u8> {
    (0..len).map(|i| (i % 251) as u8).collect()
}

async fn store(cache: &AudioCache, id: &str, data: &[u8], piece: usize) -> u64 {
    let mut writer = cache.begin(id).await.unwrap();
    for part in data.chunks(piece.max(1)) {
        writer.write(part).await.unwrap();
    }
    writer.finish().await.unwrap().size
}

#[tokio::test]
async fn round_trips_files_of_awkward_sizes() {
    let dir = tempfile::tempdir().unwrap();
    let cache = AudioCache::new(dir.path().to_path_buf(), &random_bytes());
    for len in [1, CHUNK_PLAIN - 1, CHUNK_PLAIN, CHUNK_PLAIN + 1, 3 * CHUNK_PLAIN + 777] {
        let data = sample(len);
        let id = format!("t{len}");
        assert_eq!(store(&cache, &id, &data, 10_000).await, len as u64);
        assert_eq!(cache.size(&id).await.unwrap(), Some(len as u64));
        assert_eq!(cache.read_range(&id, 0, len as u64 - 1).await.unwrap(), data, "len {len}");
    }
}

#[tokio::test]
async fn range_reads_across_chunk_boundaries() {
    let dir = tempfile::tempdir().unwrap();
    let cache = AudioCache::new(dir.path().to_path_buf(), &random_bytes());
    let data = sample(3 * CHUNK_PLAIN + 100);
    store(&cache, "t", &data, 4096).await;
    let start = CHUNK_PLAIN as u64 - 10;
    let end = 2 * CHUNK_PLAIN as u64 + 10;
    assert_eq!(cache.read_range("t", start, end).await.unwrap(), &data[start as usize..=end as usize]);
    let last = data.len() as u64 - 1;
    assert_eq!(cache.read_range("t", last, last).await.unwrap(), &data[last as usize..]);
}

#[tokio::test]
async fn files_are_encrypted_and_bound_to_the_key() {
    let dir = tempfile::tempdir().unwrap();
    let key = random_bytes();
    let cache = AudioCache::new(dir.path().to_path_buf(), &key);
    let data = vec![0x42u8; 5000];
    store(&cache, "t", &data, 5000).await;
    let raw = std::fs::read(cache.path_for("t")).unwrap();
    assert!(!raw.windows(64).any(|w| w.iter().all(|b| *b == 0x42)), "plaintext must not appear on disk");
    let other = AudioCache::new(dir.path().to_path_buf(), &random_bytes());
    assert!(matches!(other.read_range("t", 0, 10).await.unwrap_err(), CacheError::Corrupt));
}

#[tokio::test]
async fn unfinished_uploads_are_invisible_and_cleaned_up() {
    let dir = tempfile::tempdir().unwrap();
    let cache = AudioCache::new(dir.path().to_path_buf(), &random_bytes());
    let mut writer = cache.begin("t").await.unwrap();
    writer.write(&sample(CHUNK_PLAIN * 2)).await.unwrap();
    // A crash runs no destructor.
    std::mem::forget(writer);
    assert_eq!(cache.size("t").await.unwrap(), None);
    assert_eq!(cache.remove_partials().await.unwrap(), 1);
    assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 0);
}

#[tokio::test]
async fn a_dropped_writer_removes_its_part() {
    let dir = tempfile::tempdir().unwrap();
    let cache = AudioCache::new(dir.path().to_path_buf(), &random_bytes());
    let mut writer = cache.begin("t").await.unwrap();
    writer.write(&sample(CHUNK_PLAIN * 2)).await.unwrap();
    drop(writer);
    assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 0);
}

#[tokio::test]
async fn files_without_an_index_row_are_removed_and_indexed_ones_kept() {
    let dir = tempfile::tempdir().unwrap();
    let cache = AudioCache::new(dir.path().to_path_buf(), &random_bytes());
    store(&cache, "kept", &sample(100), 100).await;
    store(&cache, "orphan", &sample(100), 100).await;
    std::fs::write(dir.path().join("notes.txt"), b"not ours").unwrap();
    assert_eq!(cache.remove_unindexed(&["kept".to_string()]).await.unwrap(), 1);
    assert_eq!(cache.size("kept").await.unwrap(), Some(100));
    assert_eq!(cache.size("orphan").await.unwrap(), None);
    assert!(dir.path().join("notes.txt").exists(), "only .lac files are touched");
}

#[tokio::test]
async fn concurrent_uploads_of_one_track_do_not_corrupt_it() {
    let dir = tempfile::tempdir().unwrap();
    let cache = AudioCache::new(dir.path().to_path_buf(), &random_bytes());
    let data = sample(CHUNK_PLAIN * 2 + 5);
    let mut a = cache.begin("t").await.unwrap();
    let mut b = cache.begin("t").await.unwrap();
    a.write(&data[..1000]).await.unwrap();
    b.write(&data).await.unwrap();
    a.write(&data[1000..]).await.unwrap();
    b.finish().await.unwrap();
    a.finish().await.unwrap();
    assert_eq!(cache.read_range("t", 0, data.len() as u64 - 1).await.unwrap(), data);
}

#[tokio::test]
async fn abort_removes_the_partial_file() {
    let dir = tempfile::tempdir().unwrap();
    let cache = AudioCache::new(dir.path().to_path_buf(), &random_bytes());
    let mut writer = cache.begin("t").await.unwrap();
    writer.write(b"abc").await.unwrap();
    writer.abort().await;
    assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 0);
}

#[tokio::test]
async fn empty_uploads_are_rejected_and_missing_files_read_as_none() {
    let dir = tempfile::tempdir().unwrap();
    let cache = AudioCache::new(dir.path().to_path_buf(), &random_bytes());
    let writer = cache.begin("t").await.unwrap();
    assert!(matches!(writer.finish().await.unwrap_err(), CacheError::Empty));
    assert_eq!(cache.size("nope").await.unwrap(), None);
    cache.delete("nope").await.unwrap();
}

#[tokio::test]
async fn out_of_range_reads_are_rejected() {
    let dir = tempfile::tempdir().unwrap();
    let cache = AudioCache::new(dir.path().to_path_buf(), &random_bytes());
    store(&cache, "t", &sample(100), 100).await;
    assert!(matches!(cache.read_range("t", 50, 100).await.unwrap_err(), CacheError::Range));
    assert!(matches!(cache.read_range("t", 60, 50).await.unwrap_err(), CacheError::Range));
}

#[tokio::test]
async fn a_plain_cache_keeps_the_bytes_as_they_are() {
    let dir = tempfile::tempdir().unwrap();
    let cache = AudioCache::plain(dir.path().to_path_buf());
    for len in [1, CHUNK_PLAIN - 1, CHUNK_PLAIN, 3 * CHUNK_PLAIN + 777] {
        let data = sample(len);
        let id = format!("t{len}");
        assert_eq!(store(&cache, &id, &data, 10_000).await, len as u64);
        assert_eq!(cache.size(&id).await.unwrap(), Some(len as u64));
        assert_eq!(std::fs::read(cache.path_for(&id)).unwrap(), data);
        let (start, end) = (len as u64 / 3, len as u64 - 1);
        assert_eq!(cache.read_range(&id, start, end).await.unwrap(), &data[start as usize..]);
    }
    assert!(!cache.other_format_present());
}

#[tokio::test]
async fn files_move_between_the_sealed_and_the_plain_format() {
    let dir = tempfile::tempdir().unwrap();
    let key = random_bytes();
    let sealed = AudioCache::new(dir.path().to_path_buf(), &key);
    let (one, two) = (sample(3 * CHUNK_PLAIN + 5), sample(77));
    store(&sealed, "one", &one, 4096).await;
    store(&sealed, "two", &two, 4096).await;
    let plain = AudioCache::plain(dir.path().to_path_buf()).with_fallback(AudioCache::new(dir.path().to_path_buf(), &key));
    store(&plain, "two", &two, 4096).await;
    assert!(plain.other_format_present());
    assert_eq!(plain.size("one").await.unwrap(), Some(one.len() as u64), "a file not yet converted is still there");
    assert_eq!(plain.read_range("one", 10, 20).await.unwrap(), &one[10..=20]);

    assert_eq!(plain.convert().await.unwrap(), 1);
    assert!(!plain.other_format_present());
    assert_eq!(std::fs::read(plain.path_for("one")).unwrap(), one);
    assert_eq!(sealed.size("two").await.unwrap(), None, "a copy already in the new format wins");

    let back = AudioCache::new(dir.path().to_path_buf(), &key).with_fallback(AudioCache::plain(dir.path().to_path_buf()));
    assert_eq!(back.convert().await.unwrap(), 2);
    assert_eq!(back.read_range("two", 0, two.len() as u64 - 1).await.unwrap(), two);
    assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 2);
}

#[tokio::test]
async fn delete_removes_a_track_in_either_format() {
    let dir = tempfile::tempdir().unwrap();
    let key = random_bytes();
    store(&AudioCache::new(dir.path().to_path_buf(), &key), "t", &sample(10), 10).await;
    let plain = AudioCache::plain(dir.path().to_path_buf()).with_fallback(AudioCache::new(dir.path().to_path_buf(), &key));
    plain.delete("t").await.unwrap();
    assert_eq!(plain.size("t").await.unwrap(), None);
    assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 0);
}

#[tokio::test]
async fn a_corrupt_original_is_dropped_and_the_rest_converts() {
    let dir = tempfile::tempdir().unwrap();
    let key = random_bytes();
    let sealed = AudioCache::new(dir.path().to_path_buf(), &key);
    store(&sealed, "good", &sample(CHUNK_PLAIN + 9), 4096).await;
    store(&sealed, "bad", &sample(CHUNK_PLAIN + 9), 4096).await;
    let mut bytes = std::fs::read(sealed.path_for("bad")).unwrap();
    bytes[100] ^= 1;
    std::fs::write(sealed.path_for("bad"), bytes).unwrap();
    let plain = AudioCache::plain(dir.path().to_path_buf()).with_fallback(AudioCache::new(dir.path().to_path_buf(), &key));
    assert_eq!(plain.convert().await.unwrap(), 1);
    assert_eq!(plain.read_range("good", 0, 9).await.unwrap(), &sample(10)[..]);
    assert_eq!(plain.size("bad").await.unwrap(), None);
    assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
}

#[cfg(unix)]
#[tokio::test]
async fn a_failed_write_keeps_every_original_for_the_next_start() {
    use std::os::unix::fs::PermissionsExt;
    let dir = tempfile::tempdir().unwrap();
    let key = random_bytes();
    let data = sample(2 * CHUNK_PLAIN);
    store(&AudioCache::new(dir.path().to_path_buf(), &key), "t", &data, 4096).await;
    let plain = AudioCache::plain(dir.path().to_path_buf()).with_fallback(AudioCache::new(dir.path().to_path_buf(), &key));
    std::fs::set_permissions(dir.path(), std::fs::Permissions::from_mode(0o500)).unwrap();
    assert!(plain.convert().await.is_err());
    std::fs::set_permissions(dir.path(), std::fs::Permissions::from_mode(0o700)).unwrap();
    assert_eq!(plain.read_range("t", 0, data.len() as u64 - 1).await.unwrap(), data, "still readable in the old format");

    std::fs::write(dir.path().join("half.bin.0011.part"), b"left by a crash").unwrap();
    assert_eq!(plain.remove_partials().await.unwrap(), 1);
    assert_eq!(plain.convert().await.unwrap(), 1);
    assert_eq!(std::fs::read(plain.path_for("t")).unwrap(), data);
}
