// On disk: <sha256(track_id)>.lac = "LAC1" || 16-byte nonce prefix || sealed 64 KiB chunks, or <sha256(track_id)>.bin as is

use std::collections::HashSet;
use std::io::SeekFrom;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use nuvo_crypto::{CHUNK_CIPHER, CHUNK_PLAIN, ChunkCipher, NONCE_PREFIX_LEN, derive_key, plain_len, random_bytes, sha256_hex};
use tokio::fs;
use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt};

pub const AUDIO_KEY_INFO: &str = "nuvo/audio/v1";
const MAGIC: &[u8; 4] = b"LAC1";
const HEADER_LEN: u64 = (MAGIC.len() + NONCE_PREFIX_LEN) as u64;
const SEALED_EXT: &str = "lac";
const PLAIN_EXT: &str = "bin";

#[derive(Debug, thiserror::Error)]
pub enum CacheError {
    #[error("upload was empty")]
    Empty,
    #[error("requested range is outside the file")]
    Range,
    #[error("cache file is corrupt or was written with another key")]
    Corrupt,
    #[error(transparent)]
    Io(#[from] std::io::Error),
}

#[derive(Clone)]
pub struct AudioCache {
    dir: PathBuf,
    cipher: Option<Arc<ChunkCipher>>,
    /// The other format in the same folder, read until its files are converted.
    fallback: Option<Arc<AudioCache>>,
}

#[derive(Debug)]
pub struct Finished {
    pub path: PathBuf,
    pub size: u64,
}

impl AudioCache {
    pub fn new(dir: PathBuf, master: &[u8; 32]) -> Self {
        Self { dir, cipher: Some(Arc::new(ChunkCipher::new(&derive_key(master, AUDIO_KEY_INFO)))), fallback: None }
    }

    pub fn plain(dir: PathBuf) -> Self {
        Self { dir, cipher: None, fallback: None }
    }

    pub fn with_fallback(mut self, other: AudioCache) -> Self {
        self.fallback = Some(Arc::new(other));
        self
    }

    pub fn dir(&self) -> &Path {
        &self.dir
    }

    fn ext(&self) -> &'static str {
        if self.cipher.is_some() { SEALED_EXT } else { PLAIN_EXT }
    }

    pub fn path_for(&self, track_id: &str) -> PathBuf {
        self.dir.join(format!("{}.{}", sha256_hex(track_id.as_bytes()), self.ext()))
    }

    pub async fn begin(&self, track_id: &str) -> Result<CacheWriter, CacheError> {
        self.begin_at(self.path_for(track_id)).await
    }

    async fn begin_at(&self, path: PathBuf) -> Result<CacheWriter, CacheError> {
        fs::create_dir_all(&self.dir).await?;
        // Unique per upload: two concurrent uploads of one track must not share a file.
        let part = path.with_extension(format!("{}.part", nuvo_crypto::to_hex(&random_bytes::<8>())));
        let prefix: [u8; NONCE_PREFIX_LEN] = random_bytes();
        let mut file = fs::File::create(&part).await?;
        if self.cipher.is_some() {
            file.write_all(MAGIC).await?;
            file.write_all(&prefix).await?;
        }
        Ok(CacheWriter { cipher: self.cipher.clone(), file, part, path, prefix, buffer: Vec::with_capacity(CHUNK_PLAIN), index: 0, size: 0 })
    }

    pub async fn size(&self, track_id: &str) -> Result<Option<u64>, CacheError> {
        match (self.size_at(&self.path_for(track_id)).await?, &self.fallback) {
            (None, Some(fallback)) => fallback.size_at(&fallback.path_for(track_id)).await,
            (size, _) => Ok(size),
        }
    }

    async fn size_at(&self, path: &Path) -> Result<Option<u64>, CacheError> {
        match fs::metadata(path).await {
            Ok(meta) if self.cipher.is_some() => Ok(Some(plain_len(meta.len().saturating_sub(HEADER_LEN)))),
            Ok(meta) => Ok(Some(meta.len())),
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(err) => Err(err.into()),
        }
    }

    /// Inclusive byte range of the plaintext.
    pub async fn read_range(&self, track_id: &str, start: u64, end: u64) -> Result<Vec<u8>, CacheError> {
        let own = self.path_for(track_id);
        if let Some(fallback) = &self.fallback
            && !fs::try_exists(&own).await?
        {
            // the conversion may move the file between the check and the read
            match fallback.read_at(&fallback.path_for(track_id), start, end).await {
                Err(CacheError::Range | CacheError::Io(_)) if fs::try_exists(&own).await? => {}
                result => return result,
            }
        }
        self.read_at(&own, start, end).await
    }

    async fn read_at(&self, path: &Path, start: u64, end: u64) -> Result<Vec<u8>, CacheError> {
        let size = self.size_at(path).await?.ok_or(CacheError::Range)?;
        if start > end || end >= size {
            return Err(CacheError::Range);
        }
        let mut file = fs::File::open(path).await?;
        let Some(cipher) = &self.cipher else {
            file.seek(SeekFrom::Start(start)).await?;
            let mut out = vec![0u8; (end - start + 1) as usize];
            file.read_exact(&mut out).await?;
            return Ok(out);
        };
        let prefix = read_prefix(&mut file).await?;
        let first = start / CHUNK_PLAIN as u64;
        let last = end / CHUNK_PLAIN as u64;
        file.seek(SeekFrom::Start(HEADER_LEN + first * CHUNK_CIPHER as u64)).await?;
        let mut out = Vec::with_capacity((end - start + 1) as usize);
        let mut sealed = Vec::with_capacity(CHUNK_CIPHER);
        for index in first..=last {
            sealed.clear();
            (&mut file).take(CHUNK_CIPHER as u64).read_to_end(&mut sealed).await?;
            let plain = cipher.open(&prefix, index, &sealed).map_err(|_| CacheError::Corrupt)?;
            let chunk_start = index * CHUNK_PLAIN as u64;
            let from = start.saturating_sub(chunk_start) as usize;
            let to = ((end - chunk_start) as usize).min(plain.len() - 1);
            out.extend_from_slice(&plain[from..=to]);
        }
        Ok(out)
    }

    pub async fn delete(&self, track_id: &str) -> Result<(), CacheError> {
        if let Some(fallback) = &self.fallback {
            remove_if_exists(&fallback.path_for(track_id)).await?;
        }
        remove_if_exists(&self.path_for(track_id)).await
    }

    pub async fn delete_path(&self, path: &Path) -> Result<(), CacheError> {
        remove_if_exists(path).await
    }

    pub async fn remove_partials(&self) -> Result<usize, CacheError> {
        self.remove_where(|path| path.to_string_lossy().ends_with(".part")).await
    }

    pub async fn remove_unindexed(&self, indexed_track_ids: &[String]) -> Result<usize, CacheError> {
        let keep: HashSet<PathBuf> = indexed_track_ids.iter().map(|id| self.path_for(id)).collect();
        self.remove_where(|path| path.extension().is_some_and(|ext| ext == self.ext()) && !keep.contains(path)).await
    }

    pub fn other_format_present(&self) -> bool {
        let other = if self.cipher.is_some() { PLAIN_EXT } else { SEALED_EXT };
        std::fs::read_dir(&self.dir).is_ok_and(|entries| entries.filter_map(Result::ok).any(|entry| entry.path().extension().is_some_and(|ext| ext == other)))
    }

    /// Rewrites the fallback's files into this cache's format and returns how many moved; a write error stops it with the rest kept for the next start.
    pub async fn convert(&self) -> Result<usize, CacheError> {
        match &self.fallback {
            Some(fallback) => self.adopt(fallback).await,
            None => Ok(0),
        }
    }

    async fn adopt(&self, other: &AudioCache) -> Result<usize, CacheError> {
        let mut moved = 0;
        let mut entries = match fs::read_dir(&self.dir).await {
            Ok(entries) => entries,
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(0),
            Err(err) => return Err(err.into()),
        };
        while let Some(entry) = entries.next_entry().await? {
            let from = entry.path();
            if from.extension().is_none_or(|ext| ext != other.ext()) {
                continue;
            }
            let to = from.with_extension(self.ext());
            if fs::try_exists(&to).await? {
                remove_if_exists(&from).await?;
                continue;
            }
            match self.copy_from(other, &from, to).await {
                Ok(()) => moved += 1,
                // an unreadable original is lost anyway; it is only a cache
                Err(CacheError::Corrupt | CacheError::Empty) => {}
                Err(err) => return Err(err),
            }
            remove_if_exists(&from).await?;
        }
        Ok(moved)
    }

    // The original goes only after the copy is on disk with the same length; the AEAD tags check every sealed chunk on the way
    async fn copy_from(&self, other: &AudioCache, from: &Path, to: PathBuf) -> Result<(), CacheError> {
        let expected = other.size_at(from).await?.ok_or(CacheError::Corrupt)?;
        let mut input = fs::File::open(from).await?;
        let mut writer = self.begin_at(to).await?;
        match &other.cipher {
            Some(cipher) => {
                let prefix = read_prefix(&mut input).await?;
                let mut sealed = Vec::with_capacity(CHUNK_CIPHER);
                for index in 0.. {
                    sealed.clear();
                    (&mut input).take(CHUNK_CIPHER as u64).read_to_end(&mut sealed).await?;
                    if sealed.is_empty() {
                        break;
                    }
                    writer.write(&cipher.open(&prefix, index, &sealed).map_err(|_| CacheError::Corrupt)?).await?;
                }
            }
            None => {
                let mut buffer = vec![0u8; CHUNK_PLAIN];
                loop {
                    let read = input.read(&mut buffer).await?;
                    if read == 0 {
                        break;
                    }
                    writer.write(&buffer[..read]).await?;
                }
            }
        }
        if writer.size() != expected {
            return Err(CacheError::Corrupt);
        }
        let finished = writer.finish().await?;
        if self.size_at(&finished.path).await? != Some(expected) {
            remove_if_exists(&finished.path).await?;
            return Err(CacheError::Io(std::io::Error::other("the converted file has the wrong length")));
        }
        Ok(())
    }

    async fn remove_where(&self, doomed: impl Fn(&Path) -> bool) -> Result<usize, CacheError> {
        let mut removed = 0;
        let mut entries = match fs::read_dir(&self.dir).await {
            Ok(entries) => entries,
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(0),
            Err(err) => return Err(err.into()),
        };
        while let Some(entry) = entries.next_entry().await? {
            let path = entry.path();
            if doomed(&path) {
                fs::remove_file(&path).await?;
                removed += 1;
            }
        }
        Ok(removed)
    }
}

async fn read_prefix(file: &mut fs::File) -> Result<[u8; NONCE_PREFIX_LEN], CacheError> {
    let mut header = [0u8; HEADER_LEN as usize];
    if let Err(e) = file.read_exact(&mut header).await {
        if e.kind() == std::io::ErrorKind::UnexpectedEof {
            return Err(CacheError::Corrupt);
        }
        return Err(e.into());
    }
    if &header[..MAGIC.len()] != MAGIC {
        return Err(CacheError::Corrupt);
    }
    Ok(header[MAGIC.len()..].try_into().expect("header length"))
}

async fn remove_if_exists(path: &Path) -> Result<(), CacheError> {
    match fs::remove_file(path).await {
        Err(err) if err.kind() != std::io::ErrorKind::NotFound => Err(err.into()),
        _ => Ok(()),
    }
}

pub struct CacheWriter {
    cipher: Option<Arc<ChunkCipher>>,
    file: fs::File,
    part: PathBuf,
    path: PathBuf,
    prefix: [u8; NONCE_PREFIX_LEN],
    buffer: Vec<u8>,
    index: u64,
    size: u64,
}

impl CacheWriter {
    pub fn size(&self) -> u64 {
        self.size
    }

    pub fn part_path(&self) -> &Path {
        &self.part
    }

    pub async fn write(&mut self, mut data: &[u8]) -> Result<(), CacheError> {
        self.size += data.len() as u64;
        while !data.is_empty() {
            let take = (CHUNK_PLAIN - self.buffer.len()).min(data.len());
            self.buffer.extend_from_slice(&data[..take]);
            data = &data[take..];
            if self.buffer.len() == CHUNK_PLAIN {
                self.flush_chunk().await?;
            }
        }
        Ok(())
    }

    async fn flush_chunk(&mut self) -> Result<(), CacheError> {
        match &self.cipher {
            Some(cipher) => self.file.write_all(&cipher.seal(&self.prefix, self.index, &self.buffer)).await?,
            None => self.file.write_all(&self.buffer).await?,
        }
        self.buffer.clear();
        self.index += 1;
        Ok(())
    }

    pub async fn abort(self) {
        let _ = fs::remove_file(&self.part).await;
    }

    pub async fn finish(mut self) -> Result<Finished, CacheError> {
        if self.size == 0 {
            let _ = fs::remove_file(&self.part).await;
            return Err(CacheError::Empty);
        }
        if !self.buffer.is_empty() && let Err(e) = self.flush_chunk().await {
            let _ = fs::remove_file(&self.part).await;
            return Err(e);
        }
        if let Err(e) = self.file.sync_all().await {
            let _ = fs::remove_file(&self.part).await;
            return Err(e.into());
        }
        if let Err(e) = fs::rename(&self.part, &self.path).await {
            let _ = fs::remove_file(&self.part).await;
            return Err(e.into());
        }
        Ok(Finished { path: self.path.clone(), size: self.size })
    }
}

// A cancelled writer leaves no partial file; the unique part name makes this a no-op after finish
impl Drop for CacheWriter {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.part);
    }
}
