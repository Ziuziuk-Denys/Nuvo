//! The local listener. Unix uses a socket file; Windows uses a named pipe. Both implement
//! `axum::serve::Listener`, so the router and the tests do not know the difference.

#[cfg(unix)]
pub use unix::bind;
#[cfg(windows)]
pub use windows::bind;

#[cfg(unix)]
mod unix {
    use std::fs;
    use std::io;
    use std::os::unix::fs::PermissionsExt;
    use std::path::Path;

    use tokio::net::{UnixListener, UnixStream};

    /// Binds the daemon socket in a 0700 directory with mode 0600. A stale socket file left by a
    /// crash is replaced; a socket that still answers means another daemon owns the library.
    pub async fn bind(path: &Path) -> io::Result<UnixListener> {
        if let Some(dir) = path.parent() {
            crate::paths::ensure_private_dir(dir)?;
        }
        if path.exists() {
            if UnixStream::connect(path).await.is_ok() {
                return Err(io::Error::new(io::ErrorKind::AddrInUse, "another nuvo-core is already running"));
            }
            fs::remove_file(path)?;
        }
        let listener = UnixListener::bind(path)?;
        fs::set_permissions(path, fs::Permissions::from_mode(0o600))?;
        Ok(listener)
    }
}

#[cfg(windows)]
mod windows {
    use std::ffi::c_void;
    use std::io;
    use std::path::Path;
    use std::time::Duration;

    use tokio::net::windows::named_pipe::{NamedPipeServer, ServerOptions};
    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::Authorization::{ConvertStringSecurityDescriptorToSecurityDescriptorW, SDDL_REVISION_1};
    use windows_sys::Win32::Security::SECURITY_ATTRIBUTES;

    /// Protected DACL: full access for the pipe's owner (the current user) and nobody else.
    const OWNER_ONLY: &str = "D:P(A;;GA;;;OW)";

    /// Serves one pipe name, always keeping one free instance waiting for the next client.
    pub struct PipeListener {
        name: String,
        next: NamedPipeServer,
    }

    /// Creates the first instance. `first_pipe_instance` makes the call fail when the name already
    /// exists, so another process cannot squat it or share it.
    pub async fn bind(path: &Path) -> io::Result<PipeListener> {
        let name = path.to_str().filter(|n| n.starts_with(r"\\.\pipe\")).ok_or_else(|| {
            io::Error::new(io::ErrorKind::InvalidInput, r"the socket path must be a \\.\pipe\ name")
        })?;
        let next = create(name, true).map_err(|err| match err.kind() {
            io::ErrorKind::PermissionDenied | io::ErrorKind::AlreadyExists => {
                io::Error::new(io::ErrorKind::AddrInUse, "another nuvo-core is already running")
            }
            _ => err,
        })?;
        Ok(PipeListener { name: name.to_string(), next })
    }

    fn create(name: &str, first: bool) -> io::Result<NamedPipeServer> {
        let wide: Vec<u16> = OWNER_ONLY.encode_utf16().chain(Some(0)).collect();
        let mut descriptor: *mut c_void = std::ptr::null_mut();
        // SAFETY: `wide` is NUL-terminated; on success `descriptor` is a LocalAlloc block freed below
        let ok = unsafe {
            ConvertStringSecurityDescriptorToSecurityDescriptorW(wide.as_ptr(), SDDL_REVISION_1, &mut descriptor, std::ptr::null_mut())
        };
        if ok == 0 {
            return Err(io::Error::last_os_error());
        }
        let mut attributes = SECURITY_ATTRIBUTES {
            nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
            lpSecurityDescriptor: descriptor,
            bInheritHandle: 0,
        };
        let mut options = ServerOptions::new();
        options.first_pipe_instance(first).reject_remote_clients(true);
        // SAFETY: `attributes` points at a valid descriptor for the duration of the call
        let pipe = unsafe { options.create_with_security_attributes_raw(name, &mut attributes as *mut _ as *mut c_void) };
        // SAFETY: allocated by the conversion call above and not used after this point
        unsafe { LocalFree(descriptor) };
        pipe
    }

    impl axum::serve::Listener for PipeListener {
        type Io = NamedPipeServer;
        type Addr = ();

        async fn accept(&mut self) -> (Self::Io, Self::Addr) {
            loop {
                let connected = self.next.connect().await;
                // Swap in a fresh instance first so the name keeps being served.
                let fresh = loop {
                    match create(&self.name, false) {
                        Ok(pipe) => break pipe,
                        Err(err) => {
                            tracing::warn!(%err, "cannot create a pipe instance");
                            tokio::time::sleep(Duration::from_millis(100)).await;
                        }
                    }
                };
                let server = std::mem::replace(&mut self.next, fresh);
                match connected {
                    Ok(()) => return (server, ()),
                    Err(err) => {
                        tracing::warn!(%err, "pipe accept failed");
                        tokio::time::sleep(Duration::from_millis(100)).await;
                    }
                }
            }
        }

        fn local_addr(&self) -> io::Result<Self::Addr> {
            Ok(())
        }
    }
}
