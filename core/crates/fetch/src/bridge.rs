use std::io::{Error, ErrorKind, Result};
use std::net::{IpAddr, Ipv4Addr};
use std::time::Duration;

use nuvo_crypto::{base64_encode, random_bytes, to_hex};
use reqwest::Url;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt, copy_bidirectional};
use tokio::net::{TcpListener, TcpStream};
use tokio::task::JoinHandle;
use tokio::time::timeout;

const HEAD_LIMIT: usize = 16 * 1024;
const STEP: Duration = Duration::from_secs(15);
const REFUSED: &[u8] = b"HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm=\"Nuvo\"\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
const BAD_GATEWAY: &[u8] = b"HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
const BAD_REQUEST: &[u8] = b"HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";

/// A loopback HTTP proxy in front of a SOCKS5 proxy, for clients that speak no SOCKS (ffmpeg) or no SOCKS login (Chromium).
/// Only callers holding its own random login get through.
pub struct Bridge {
    url: String,
    task: JoinHandle<()>,
}

impl Drop for Bridge {
    fn drop(&mut self) {
        self.task.abort();
    }
}

impl Bridge {
    /// Needs a running Tokio runtime.
    pub fn start(upstream: Url) -> Result<Self> {
        let listener = std::net::TcpListener::bind((Ipv4Addr::LOCALHOST, 0))?;
        listener.set_nonblocking(true)?;
        let listener = TcpListener::from_std(listener)?;
        let port = listener.local_addr()?.port();
        let token = to_hex(&random_bytes::<16>());
        let login = format!("basic {}", base64_encode(format!("nuvo:{token}").as_bytes())).to_ascii_lowercase();
        let task = tokio::spawn(async move {
            while let Ok((client, _)) = listener.accept().await {
                let (upstream, login) = (upstream.clone(), login.clone());
                tokio::spawn(async move {
                    let _ = serve(client, &upstream, &login).await;
                });
            }
        });
        Ok(Self { url: format!("http://nuvo:{token}@127.0.0.1:{port}"), task })
    }

    /// An `http://` URL with the bridge's own login; the upstream login never leaves the daemon.
    pub fn url(&self) -> &str {
        &self.url
    }
}

struct Head {
    method: String,
    target: String,
    version: String,
    headers: Vec<(String, String)>,
}

async fn read_head(client: &mut TcpStream) -> Result<(Head, Vec<u8>)> {
    let mut buffer = Vec::with_capacity(1024);
    let end = loop {
        if let Some(at) = buffer.windows(4).position(|w| w == b"\r\n\r\n") {
            break at;
        }
        if buffer.len() > HEAD_LIMIT {
            return Err(Error::new(ErrorKind::InvalidData, "head too long"));
        }
        let mut chunk = [0u8; 4096];
        let read = client.read(&mut chunk).await?;
        if read == 0 {
            return Err(ErrorKind::UnexpectedEof.into());
        }
        buffer.extend_from_slice(&chunk[..read]);
    };
    let text = std::str::from_utf8(&buffer[..end]).map_err(|_| Error::new(ErrorKind::InvalidData, "head is not text"))?;
    let mut lines = text.split("\r\n");
    let mut first = lines.next().unwrap_or_default().split(' ');
    let (Some(method), Some(target), Some(version), None) = (first.next(), first.next(), first.next(), first.next()) else {
        return Err(Error::new(ErrorKind::InvalidData, "bad request line"));
    };
    let headers = lines.filter_map(|line| line.split_once(':')).map(|(name, value)| (name.trim().to_string(), value.trim().to_string())).collect();
    let head = Head { method: method.into(), target: target.into(), version: version.into(), headers };
    Ok((head, buffer[end + 4..].to_vec()))
}

fn same(a: &str, b: &str) -> bool {
    a.len() == b.len() && a.bytes().zip(b.bytes()).fold(0, |acc, (x, y)| acc | (x ^ y)) == 0
}

async fn serve(mut client: TcpStream, upstream: &Url, login: &str) -> Result<()> {
    let (head, rest) = timeout(STEP, read_head(&mut client)).await.map_err(|_| Error::from(ErrorKind::TimedOut))??;
    let authorized = head.headers.iter().any(|(name, value)| name.eq_ignore_ascii_case("proxy-authorization") && same(&value.to_ascii_lowercase(), login));
    if !authorized {
        return client.write_all(REFUSED).await;
    }
    let tunnel = head.method == "CONNECT";
    let target = if tunnel { Url::parse(&format!("http://{}", head.target)).ok().filter(|u| u.port().is_some()) } else { Url::parse(&head.target).ok().filter(|u| u.scheme() == "http") };
    let Some((host, port)) = target.as_ref().and_then(|u| Some((u.host_str()?.trim_start_matches('[').trim_end_matches(']').to_string(), u.port_or_known_default()?))) else {
        return client.write_all(BAD_REQUEST).await;
    };
    let mut server = match timeout(STEP, socks5_connect(upstream, &host, port)).await {
        Ok(Ok(server)) => server,
        _ => return client.write_all(BAD_GATEWAY).await,
    };
    if tunnel {
        client.write_all(b"HTTP/1.1 200 Connection established\r\n\r\n").await?;
    } else {
        // Plain HTTP: one request per connection, so a reused client connection never reaches the wrong host.
        let target = target.expect("checked above");
        let path = target.query().map_or_else(|| target.path().to_string(), |query| format!("{}?{query}", target.path()));
        let mut forward = format!("{} {path} {}\r\n", head.method, head.version);
        for (name, value) in &head.headers {
            if !["proxy-authorization", "proxy-connection", "connection", "keep-alive"].contains(&name.to_ascii_lowercase().as_str()) {
                forward.push_str(&format!("{name}: {value}\r\n"));
            }
        }
        forward.push_str("Connection: close\r\n\r\n");
        server.write_all(forward.as_bytes()).await?;
    }
    server.write_all(&rest).await?;
    copy_bidirectional(&mut client, &mut server).await.map(|_| ())
}

fn percent_decoded(text: &str) -> Vec<u8> {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut at = 0;
    while at < bytes.len() {
        let hex = bytes.get(at + 1..at + 3).and_then(|h| std::str::from_utf8(h).ok()).and_then(|h| u8::from_str_radix(h, 16).ok());
        match (bytes[at], hex) {
            (b'%', Some(byte)) => {
                out.push(byte);
                at += 3;
            }
            (byte, _) => {
                out.push(byte);
                at += 1;
            }
        }
    }
    out
}

fn refused(why: &str) -> Error {
    Error::new(ErrorKind::ConnectionRefused, why.to_string())
}

/// RFC 1928 CONNECT with the RFC 1929 login; `socks5h` sends the name, `socks5` resolves it here.
async fn socks5_connect(upstream: &Url, host: &str, port: u16) -> Result<TcpStream> {
    let proxy_host = upstream.host_str().unwrap_or_default().trim_start_matches('[').trim_end_matches(']');
    let mut stream = TcpStream::connect((proxy_host, upstream.port().unwrap_or(1080))).await?;
    let (user, pass) = (percent_decoded(upstream.username()), percent_decoded(upstream.password().unwrap_or_default()));
    handshake(&mut stream, &user, &pass).await?;
    let mut request = vec![5, 1, 0];
    let ip = match host.parse::<IpAddr>() {
        Ok(ip) => Some(ip),
        Err(_) if upstream.scheme() == "socks5h" => None,
        Err(_) => Some(tokio::net::lookup_host((host, port)).await?.next().ok_or_else(|| refused("no address"))?.ip()),
    };
    match ip {
        Some(IpAddr::V4(v4)) => {
            request.push(1);
            request.extend_from_slice(&v4.octets());
        }
        Some(IpAddr::V6(v6)) => {
            request.push(4);
            request.extend_from_slice(&v6.octets());
        }
        None => {
            let name = u8::try_from(host.len()).map_err(|_| refused("host name too long"))?;
            request.extend_from_slice(&[3, name]);
            request.extend_from_slice(host.as_bytes());
        }
    }
    request.extend_from_slice(&port.to_be_bytes());
    stream.write_all(&request).await?;
    let mut reply = [0u8; 4];
    stream.read_exact(&mut reply).await?;
    if reply[..2] != [5, 0] {
        return Err(refused("the proxy refused the connection"));
    }
    let bound = match reply[3] {
        1 => 4,
        4 => 16,
        3 => stream.read_u8().await? as usize,
        _ => return Err(refused("bad proxy reply")),
    };
    let mut skip = vec![0u8; bound + 2];
    stream.read_exact(&mut skip).await?;
    Ok(stream)
}

async fn handshake<S: AsyncRead + AsyncWrite + Unpin>(stream: &mut S, user: &[u8], pass: &[u8]) -> Result<()> {
    let login = !user.is_empty();
    stream.write_all(if login { &[5, 2, 0, 2] } else { &[5, 1, 0] }).await?;
    let mut choice = [0u8; 2];
    stream.read_exact(&mut choice).await?;
    match choice {
        [5, 0] => Ok(()),
        [5, 2] if login => {
            let (user_len, pass_len) = (u8::try_from(user.len()), u8::try_from(pass.len()));
            let (Ok(user_len), Ok(pass_len)) = (user_len, pass_len) else { return Err(refused("login too long")) };
            let mut auth = vec![1, user_len];
            auth.extend_from_slice(user);
            auth.push(pass_len);
            auth.extend_from_slice(pass);
            stream.write_all(&auth).await?;
            let mut status = [0u8; 2];
            stream.read_exact(&mut status).await?;
            if status[1] == 0 { Ok(()) } else { Err(refused("the proxy rejected the login")) }
        }
        _ => Err(refused("the proxy wants a login")),
    }
}
