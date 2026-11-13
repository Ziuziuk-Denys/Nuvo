use std::sync::{Arc, Mutex};
use std::sync::atomic::{AtomicUsize, Ordering};

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio_rustls::rustls;
use tokio_rustls::rustls::pki_types::pem::PemObject;
use tokio_rustls::rustls::pki_types::{CertificateDer, PrivateKeyDer};

/// `Basic` credentials for `user:pass`.
pub const USER_PASS_B64: &str = "dXNlcjpwYXNz";

async fn read_head(stream: &mut TcpStream) -> String {
    let mut head = Vec::new();
    let mut byte = [0u8; 1];
    while !head.ends_with(b"\r\n\r\n") && stream.read(&mut byte).await.unwrap_or(0) == 1 {
        head.push(byte[0]);
    }
    String::from_utf8_lossy(&head).into_owned()
}

pub async fn answering(body: &'static [u8], auth: Option<&'static str>) -> (String, Arc<AtomicUsize>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let count = Arc::new(AtomicUsize::new(0));
    let seen = count.clone();
    tokio::spawn(async move {
        while let Ok((mut stream, _)) = listener.accept().await {
            let seen = seen.clone();
            tokio::spawn(async move {
                let head = read_head(&mut stream).await;
                seen.fetch_add(1, Ordering::SeqCst);
                let authorized = auth.is_none_or(|b64| head.lines().any(|l| l.eq_ignore_ascii_case(&format!("proxy-authorization: Basic {b64}"))));
                let response = if authorized {
                    let mut ok = format!("HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len()).into_bytes();
                    ok.extend_from_slice(body);
                    ok
                } else {
                    b"HTTP/1.1 407 Proxy Authentication Required\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".to_vec()
                };
                let _ = stream.write_all(&response).await;
            });
        }
    });
    (url, count)
}

/// Every target the SOCKS fixture was asked for, as `host:port`.
pub type Targets = Arc<Mutex<Vec<String>>>;

/// A SOCKS5 proxy. Names under `.proxy.test` resolve only here, to loopback: the way a site blocked on the
/// local network is reachable only through the proxy. `login` is `user:pass`.
pub async fn socks5(login: Option<&'static str>) -> (String, Targets) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("socks5h://{}", listener.local_addr().unwrap());
    let targets = Targets::default();
    let seen = targets.clone();
    tokio::spawn(async move {
        while let Ok((mut client, _)) = listener.accept().await {
            let seen = seen.clone();
            tokio::spawn(async move {
                let mut greeting = [0u8; 2];
                client.read_exact(&mut greeting).await.unwrap();
                let mut methods = vec![0u8; greeting[1] as usize];
                client.read_exact(&mut methods).await.unwrap();
                if let Some(login) = login {
                    if !methods.contains(&2) {
                        let _ = client.write_all(&[5, 0xff]).await;
                        return;
                    }
                    client.write_all(&[5, 2]).await.unwrap();
                    let mut head = [0u8; 2];
                    client.read_exact(&mut head).await.unwrap();
                    let mut user = vec![0u8; head[1] as usize];
                    client.read_exact(&mut user).await.unwrap();
                    let mut pass = vec![0u8; client.read_u8().await.unwrap() as usize];
                    client.read_exact(&mut pass).await.unwrap();
                    let given = format!("{}:{}", String::from_utf8_lossy(&user), String::from_utf8_lossy(&pass));
                    let ok = given == login;
                    client.write_all(&[1, if ok { 0 } else { 1 }]).await.unwrap();
                    if !ok {
                        return;
                    }
                } else {
                    client.write_all(&[5, 0]).await.unwrap();
                }
                let mut request = [0u8; 4];
                client.read_exact(&mut request).await.unwrap();
                let host = match request[3] {
                    1 => {
                        let mut ip = [0u8; 4];
                        client.read_exact(&mut ip).await.unwrap();
                        std::net::Ipv4Addr::from(ip).to_string()
                    }
                    3 => {
                        let mut name = vec![0u8; client.read_u8().await.unwrap() as usize];
                        client.read_exact(&mut name).await.unwrap();
                        String::from_utf8(name).unwrap()
                    }
                    _ => return,
                };
                let port = client.read_u16().await.unwrap();
                seen.lock().unwrap().push(format!("{host}:{port}"));
                let address = if host.ends_with(".proxy.test") { "127.0.0.1" } else { host.as_str() };
                let Ok(mut upstream) = TcpStream::connect((address, port)).await else {
                    let _ = client.write_all(&[5, 5, 0, 1, 0, 0, 0, 0, 0, 0]).await;
                    return;
                };
                client.write_all(&[5, 0, 0, 1, 0, 0, 0, 0, 0, 0]).await.unwrap();
                let _ = tokio::io::copy_bidirectional(&mut client, &mut upstream).await;
            });
        }
    });
    (url, targets)
}

const CERT: &str = "-----BEGIN CERTIFICATE-----
MIIBljCCATugAwIBAgIUB+CXN19njyXtZeRoYgBBUtHziV4wCgYIKoZIzj0EAwIw
FDESMBAGA1UEAwwJbG9jYWxob3N0MCAXDTI2MTAyNzAyMDc0OVoYDzIxMjYxMDAz
MDIwNzQ5WjAUMRIwEAYDVQQDDAlsb2NhbGhvc3QwWTATBgcqhkjOPQIBBggqhkjO
PQMBBwNCAAQd3s4fChV+sW8gLINfz7gMmRknIvIYujKnHz0TDXPrHW2q+VbEH6bE
66AYNmZV4Bi+W6ORs2guHiquRTb3J2B0o2kwZzAdBgNVHQ4EFgQUzBdZNJiue0UK
a4yOlKy9ra2wjQcwHwYDVR0jBBgwFoAUzBdZNJiue0UKa4yOlKy9ra2wjQcwDwYD
VR0TAQH/BAUwAwEB/zAUBgNVHREEDTALgglsb2NhbGhvc3QwCgYIKoZIzj0EAwID
SQAwRgIhALhWD4dbjH2nErTt/OPqw+PZivOM5pruMmA12VGdoXmnAiEA81paaZkQ
PpG093VfIPYC1xqvgat+++jGZDW95aYFFwY=
-----END CERTIFICATE-----";
const KEY: &str = "-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgWFN7y9IBaF7hp9QI
VGtjYsOBstwMtzTtGOHHYAr6jkyhRANCAAQd3s4fChV+sW8gLINfz7gMmRknIvIY
ujKnHz0TDXPrHW2q+VbEH6bE66AYNmZV4Bi+W6ORs2guHiquRTb3J2B0
-----END PRIVATE KEY-----";

/// A self-signed `localhost` certificate.
pub fn tls_acceptor() -> tokio_rustls::TlsAcceptor {
    let certs = vec![CertificateDer::from_pem_slice(CERT.as_bytes()).unwrap()];
    let key = PrivateKeyDer::from_pem_slice(KEY.as_bytes()).unwrap();
    let config = rustls::ServerConfig::builder_with_provider(Arc::new(rustls::crypto::aws_lc_rs::default_provider()))
        .with_safe_default_protocol_versions()
        .unwrap()
        .with_no_client_auth()
        .with_single_cert(certs, key)
        .unwrap();
    tokio_rustls::TlsAcceptor::from(Arc::new(config))
}

/// Answers every request with `body`, over TLS when `tls` is set; returns the port.
pub async fn serving(body: Vec<u8>, tls: bool) -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let acceptor = tls_acceptor();
    let body = Arc::new(body);
    tokio::spawn(async move {
        while let Ok((stream, _)) = listener.accept().await {
            let (acceptor, body) = (acceptor.clone(), body.clone());
            tokio::spawn(async move {
                let mut head = format!("HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len()).into_bytes();
                head.extend_from_slice(&body);
                if tls {
                    let Ok(mut stream) = acceptor.accept(stream).await else { return };
                    let mut request = [0u8; 4096];
                    let _ = stream.read(&mut request).await;
                    let _ = stream.write_all(&head).await;
                    let _ = stream.shutdown().await;
                } else {
                    let mut stream = stream;
                    read_head(&mut stream).await;
                    let _ = stream.write_all(&head).await;
                }
            });
        }
    });
    port
}
