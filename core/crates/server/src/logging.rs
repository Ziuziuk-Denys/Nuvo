use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

pub const LOG_LIMIT_BYTES: u64 = 5 * 1024 * 1024;

pub struct RotatingFile {
    path: PathBuf,
    file: File,
    size: u64,
    limit: u64,
}

impl RotatingFile {
    pub fn open(path: &Path, limit: u64) -> io::Result<Self> {
        let file = OpenOptions::new().create(true).append(true).open(path)?;
        let size = file.metadata()?.len();
        Ok(Self { path: path.to_path_buf(), file, size, limit })
    }

    fn rotate(&mut self) -> io::Result<()> {
        let mut rotated = self.path.clone().into_os_string();
        rotated.push(".1");
        fs::rename(&self.path, rotated)?;
        self.file = OpenOptions::new().create(true).append(true).open(&self.path)?;
        self.size = 0;
        Ok(())
    }
}

impl Write for RotatingFile {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        if self.size > 0 && self.size + buf.len() as u64 > self.limit {
            self.rotate()?;
        }
        let written = self.file.write(buf)?;
        self.size += written as u64;
        Ok(written)
    }

    fn flush(&mut self) -> io::Result<()> {
        self.file.flush()
    }
}

// Never log lyrics text, request bodies or keys
pub fn init(path: &Path) -> io::Result<()> {
    if let Some(dir) = path.parent() {
        crate::paths::ensure_private_dir(dir)?;
    }
    let writer = RotatingFile::open(path, LOG_LIMIT_BYTES)?;
    tracing_subscriber::fmt().with_ansi(false).with_writer(Mutex::new(writer)).init();
    Ok(())
}
