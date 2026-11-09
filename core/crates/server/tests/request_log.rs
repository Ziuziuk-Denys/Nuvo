// Alone in its binary: a thread-local tracing subscriber races with callsite interest other tests cache

mod common;

use std::io::Write;
use std::sync::{Arc, Mutex};

#[derive(Clone, Default)]
struct LogBuffer(Arc<Mutex<Vec<u8>>>);

impl Write for LogBuffer {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        self.0.lock().unwrap().extend_from_slice(buf);
        Ok(buf.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

#[tokio::test]
async fn request_log_names_the_route_and_never_the_track_id() {
    let core = common::core();
    let logs = LogBuffer::default();
    let writer = logs.clone();
    let subscriber = tracing_subscriber::fmt().with_ansi(false).with_writer(move || writer.clone()).finish();
    let _guard = tracing::subscriber::set_default(subscriber);
    common::call(&core.app, "GET", "/v1/cache/audio/sc:secret-track-42", None).await;
    let text = String::from_utf8(logs.0.lock().unwrap().clone()).unwrap();
    assert!(text.contains("/v1/cache/audio/{id}"), "log: {text}");
    assert!(!text.contains("secret-track-42"), "log: {text}");
}
