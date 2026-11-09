// Paths are not trusted: a link or FIFO swapped in after the scan is refused

use std::io::{Error, ErrorKind};

fn refused() -> Error {
    Error::new(ErrorKind::InvalidInput, "not a regular file inside the folder")
}

#[cfg(unix)]
pub use unix::{open_inside, open_regular};
#[cfg(windows)]
pub use windows::{open_inside, open_regular};

#[cfg(unix)]
mod unix {
    use std::ffi::{CString, OsStr};
    use std::fs::{self, File, OpenOptions};
    use std::io::{Error, Result};
    use super::refused;
    use std::os::fd::{AsRawFd, FromRawFd};
    use std::os::unix::ffi::OsStrExt;
    use std::os::unix::fs::{MetadataExt, OpenOptionsExt};
    use std::path::{Component, Path};

    // No link at the last component, and O_NONBLOCK since a FIFO would wait for a writer
    pub fn open_regular(path: &Path) -> Result<File> {
        let file = OpenOptions::new().read(true).custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK).open(path)?;
        if !file.metadata()?.file_type().is_file() {
            return Err(refused());
        }
        Ok(file)
    }

    // Each component opens O_NOFOLLOW relative to its parent, so a swapped link cannot leave root
    pub fn open_inside(path: &Path, root: &Path) -> Result<File> {
        let link = fs::symlink_metadata(path)?;
        if !link.file_type().is_file() {
            return Err(refused());
        }
        let names: Vec<_> = match path.strip_prefix(root) {
            Ok(rest) => rest.components().map(|c| if let Component::Normal(name) = c { Ok(name) } else { Err(refused()) }).collect::<Result<_>>()?,
            Err(_) => return Err(refused()),
        };
        let Some((last, parents)) = names.split_last() else { return Err(refused()) };
        let mut dir = OpenOptions::new().read(true).custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW).open(root)?;
        for name in parents {
            dir = open_at(&dir, name, libc::O_DIRECTORY)?;
        }
        let file = open_at(&dir, last, libc::O_NONBLOCK)?;
        let meta = file.metadata()?;
        if !meta.file_type().is_file() || meta.dev() != link.dev() || meta.ino() != link.ino() {
            return Err(refused());
        }
        Ok(file)
    }

    // Never a link; O_NONBLOCK is passed only for the file, so a FIFO cannot block
    fn open_at(dir: &File, name: &OsStr, extra: libc::c_int) -> Result<File> {
        let name = CString::new(name.as_bytes()).map_err(|_| refused())?;
        // SAFETY: `dir` is an open descriptor and `name` is a NUL-terminated string
        let fd = unsafe { libc::openat(dir.as_raw_fd(), name.as_ptr(), libc::O_RDONLY | libc::O_CLOEXEC | libc::O_NOFOLLOW | extra) };
        if fd < 0 {
            return Err(Error::last_os_error());
        }
        // SAFETY: `fd` is a new descriptor owned by nobody else
        Ok(unsafe { File::from_raw_fd(fd) })
    }
}

#[cfg(windows)]
mod windows {
    use std::fs::{self, File, OpenOptions};
    use std::io::Result;
    use std::os::windows::fs::OpenOptionsExt;
    use std::path::{Component, Path};

    use super::refused;

    const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x0020_0000;

    pub fn open_regular(path: &Path) -> Result<File> {
        let file = OpenOptions::new().read(true).custom_flags(FILE_FLAG_OPEN_REPARSE_POINT).open(path)?;
        if !file.metadata()?.file_type().is_file() {
            return Err(refused());
        }
        Ok(file)
    }

    // shortcut: a parent swapped between check and open is not caught, use NtCreateFile if needed
    pub fn open_inside(path: &Path, root: &Path) -> Result<File> {
        let rest = path.strip_prefix(root).map_err(|_| refused())?;
        let mut current = root.to_path_buf();
        for component in rest.components() {
            let Component::Normal(name) = component else { return Err(refused()) };
            current.push(name);
            if fs::symlink_metadata(&current)?.file_type().is_symlink() {
                return Err(refused());
            }
        }
        open_regular(path)
    }
}
