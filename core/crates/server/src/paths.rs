use std::fs;
use std::io;
use std::path::{Path, PathBuf};

#[derive(Clone, Debug, PartialEq)]
pub struct Paths {
    pub db: PathBuf,
    pub backups: PathBuf,
    pub audio: PathBuf,
    pub log: PathBuf,
    pub socket: PathBuf,
    /// yt-dlp as Nuvo keeps it current.
    pub tools: PathBuf,
}

impl Paths {
    /// XDG base directories with the XDG defaults. `get` reads the environment; tests pass a map.
    pub fn from_env(get: impl Fn(&str) -> Option<String>) -> Result<Self, String> {
        let home = get("HOME").or_else(|| get("USERPROFILE")).map(PathBuf::from);
        // The XDG spec says relative values are invalid and must be ignored.
        let absolute = |v: &String| Path::new(v).is_absolute();
        let base = |var: &str, fallback: &str| -> Result<PathBuf, String> {
            match get(var).filter(absolute) {
                Some(dir) => Ok(PathBuf::from(dir)),
                // Windows keeps per-user data under %LOCALAPPDATA%, not in dot folders.
                None if cfg!(windows) && get("LOCALAPPDATA").is_some_and(|d| absolute(&d)) => {
                    Ok(PathBuf::from(get("LOCALAPPDATA").unwrap_or_default()))
                }
                None => home.as_ref().map(|h| h.join(fallback)).ok_or_else(|| format!("neither {var} nor HOME is set")),
            }
        };
        let data = base("XDG_DATA_HOME", ".local/share")?.join("nuvo");
        let socket = match get("NUVO_CORE_SOCKET") {
            Some(path) => PathBuf::from(path),
            // The pipe name needs a random part only the launcher can choose.
            None if cfg!(windows) => return Err("NUVO_CORE_SOCKET (a \\\\.\\pipe\\ name) is not set".into()),
            None => PathBuf::from(get("XDG_RUNTIME_DIR").ok_or("XDG_RUNTIME_DIR is not set")?).join("nuvo/core.sock"),
        };
        Ok(Self {
            db: data.join("library.db"),
            backups: data.join("backups"),
            audio: base("XDG_CACHE_HOME", ".cache")?.join("nuvo/audio"),
            log: base("XDG_STATE_HOME", ".local/state")?.join("nuvo/core.log"),
            socket,
            tools: data.join("tools"),
        })
    }

    pub fn under(root: &Path) -> Self {
        Self {
            db: root.join("data/library.db"),
            backups: root.join("data/backups"),
            audio: root.join("cache/audio"),
            log: root.join("state/core.log"),
            socket: root.join("run/core.sock"),
            tools: root.join("data/tools"),
        }
    }
}

/// Creates `dir` and restricts `dir` itself to the current user (0700). Missing parents are
/// created with the default mode and left as they are.
pub fn ensure_private_dir(dir: &Path) -> io::Result<()> {
    fs::create_dir_all(dir)?;
    // Windows: a folder under the user profile is already limited to that user by inherited ACLs.
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(dir, fs::Permissions::from_mode(0o700))?;
    }
    Ok(())
}
