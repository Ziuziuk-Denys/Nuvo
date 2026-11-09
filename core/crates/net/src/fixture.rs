// Replies are registered per https://host/path with the query ignored; every request is logged

use std::collections::HashMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use axum::body::Body;
use axum::extract::Request;
use axum::http::{HeaderMap, StatusCode};
use axum::response::Response;

use crate::{Net, Url};

#[derive(Clone, Debug)]
pub struct Hit {
    pub host: String,
    pub path: String,
    pub query: HashMap<String, String>,
    pub headers: HeaderMap,
    pub body: Vec<u8>,
}

#[derive(Clone, Debug)]
pub struct Reply {
    pub status: u16,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
    pub delay: Duration,
}

impl Reply {
    pub fn status(status: u16) -> Self {
        Self { status, headers: Vec::new(), body: Vec::new(), delay: Duration::ZERO }
    }

    pub fn bytes(content_type: &str, body: impl Into<Vec<u8>>) -> Self {
        Self::status(200).header("content-type", content_type).body(body)
    }

    pub fn text(body: impl Into<String>) -> Self {
        Self::bytes("text/plain", body.into())
    }

    pub fn json(body: impl ToString) -> Self {
        Self::bytes("application/json", body.to_string())
    }

    pub fn redirect(location: &str) -> Self {
        Self::status(302).header("location", location)
    }

    pub fn header(mut self, name: &str, value: &str) -> Self {
        self.headers.push((name.into(), value.into()));
        self
    }

    pub fn body(mut self, body: impl Into<Vec<u8>>) -> Self {
        self.body = body.into();
        self
    }

    pub fn with_status(mut self, status: u16) -> Self {
        self.status = status;
        self
    }

    pub fn after(mut self, delay: Duration) -> Self {
        self.delay = delay;
        self
    }
}

type Handler = Arc<dyn Fn(&Hit) -> Reply + Send + Sync>;

#[derive(Default)]
struct Inner {
    routes: Mutex<HashMap<String, Handler>>,
    hits: Mutex<Vec<Hit>>,
    in_flight: AtomicUsize,
    max_in_flight: AtomicUsize,
}

#[derive(Clone)]
pub struct Fixture {
    pub base: String,
    inner: Arc<Inner>,
}

fn key(url: &str) -> String {
    let url = Url::parse(url).expect("fixture route must be an absolute URL");
    format!("{}{}", url.host_str().unwrap_or_default(), url.path())
}

struct InFlight(Arc<Inner>);

impl Drop for InFlight {
    fn drop(&mut self) {
        self.0.in_flight.fetch_sub(1, Ordering::SeqCst);
    }
}

impl Fixture {
    pub async fn start() -> Self {
        let inner = Arc::new(Inner::default());
        let shared = inner.clone();
        let app = axum::Router::new().fallback(move |req: Request| {
            let inner = shared.clone();
            async move { serve(inner, req).await }
        });
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        Self { base: format!("http://{addr}"), inner }
    }

    pub fn net(&self) -> Net {
        Net::new(Some(self.base.clone()))
    }

    pub fn on(&self, url: &str, reply: Reply) {
        self.on_fn(url, move |_| reply.clone());
    }

    pub fn on_fn(&self, url: &str, handler: impl Fn(&Hit) -> Reply + Send + Sync + 'static) {
        self.inner.routes.lock().unwrap().insert(key(url), Arc::new(handler));
    }

    /// Each request takes the next reply; the last one repeats.
    pub fn on_seq(&self, url: &str, replies: Vec<Reply>) {
        let calls = AtomicUsize::new(0);
        self.on_fn(url, move |_| {
            let n = calls.fetch_add(1, Ordering::SeqCst);
            replies[n.min(replies.len() - 1)].clone()
        });
    }

    pub fn hits(&self, url: &str) -> Vec<Hit> {
        let key = key(url);
        self.inner.hits.lock().unwrap().iter().filter(|h| format!("{}{}", h.host, h.path) == key).cloned().collect()
    }

    pub fn count(&self, url: &str) -> usize {
        self.hits(url).len()
    }

    pub fn log(&self) -> Vec<String> {
        self.inner.hits.lock().unwrap().iter().map(|h| format!("{}{}", h.host, h.path)).collect()
    }

    pub fn hosts(&self) -> Vec<String> {
        self.inner.hits.lock().unwrap().iter().map(|h| h.host.clone()).collect()
    }

    pub fn total(&self) -> usize {
        self.inner.hits.lock().unwrap().len()
    }

    pub fn max_in_flight(&self) -> usize {
        self.inner.max_in_flight.load(Ordering::SeqCst)
    }
}

async fn serve(inner: Arc<Inner>, req: Request) -> Response {
    let path = req.uri().path().trim_start_matches('/').to_string();
    let (host, rest) = path.split_once('/').unwrap_or((path.as_str(), ""));
    let query = req
        .uri()
        .query()
        .map(|q| Url::parse(&format!("http://x/?{q}")).unwrap().query_pairs().into_owned().collect())
        .unwrap_or_default();
    let headers = req.headers().clone();
    let body = axum::body::to_bytes(req.into_body(), usize::MAX).await.map(|b| b.to_vec()).unwrap_or_default();
    let hit = Hit { host: host.to_string(), path: format!("/{rest}"), query, headers, body };
    let handler = inner.routes.lock().unwrap().get(&format!("{}{}", hit.host, hit.path)).cloned();
    inner.hits.lock().unwrap().push(hit.clone());
    let now = inner.in_flight.fetch_add(1, Ordering::SeqCst) + 1;
    inner.max_in_flight.fetch_max(now, Ordering::SeqCst);
    let _guard = InFlight(inner.clone());
    let reply = handler.map_or_else(|| Reply::status(404), |h| h(&hit));
    if !reply.delay.is_zero() {
        tokio::time::sleep(reply.delay).await;
    }
    let mut response = Response::builder().status(StatusCode::from_u16(reply.status).unwrap());
    for (name, value) in &reply.headers {
        response = response.header(name, value);
    }
    response.body(Body::from(reply.body)).unwrap()
}
