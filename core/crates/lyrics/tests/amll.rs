use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

use axum::extract::Path;
use axum::http::{StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::Router;
use nuvo_lyrics::{AMLL_URL, Amll, Query, lrc_sync_level};

const WORDS: &str = r#"<tt><body dur="03:10.000"><div><p begin="00:01.000" end="03:10.000"><span begin="00:01.000" end="03:10.000">One</span></p></div></body></tt>"#;
const SHORT: &str = r#"<tt><body><div><p begin="00:01.000" end="00:40.000"><span begin="00:01.000" end="00:40.000">One</span></p></div></body></tt>"#;
const NO_WORDS: &str = "<tt><body></body></tt>";

fn row(title: &str, artists: &[&str], file: &str) -> String {
    serde_json::json!({"metadata": [["musicName", [title]], ["artists", artists]], "rawLyricFile": file}).to_string()
}

struct Mock {
    base: String,
    index_hits: Arc<AtomicUsize>,
    file_hits: Arc<AtomicUsize>,
}

async fn mock(index: String) -> Mock {
    let index_hits = Arc::new(AtomicUsize::new(0));
    let file_hits = Arc::new(AtomicUsize::new(0));
    let (counter, files) = (index_hits.clone(), file_hits.clone());
    let app = Router::new()
        .route("/metadata/raw-lyrics-index.jsonl", get(move || {
            counter.fetch_add(1, Ordering::SeqCst);
            let index = index.clone();
            async move { index }
        }))
        .route("/raw-lyrics/{file}", get(move |Path(file): Path<String>| {
            files.fetch_add(1, Ordering::SeqCst);
            async move {
                match file.as_str() {
                    "words.ttml" => WORDS.to_string().into_response(),
                    "short.ttml" => SHORT.to_string().into_response(),
                    "none.ttml" => NO_WORDS.to_string().into_response(),
                    "huge.ttml" => format!("{WORDS}{}", " ".repeat(300 * 1024)).into_response(),
                    "moved.ttml" => redirect(),
                    _ => StatusCode::NOT_FOUND.into_response(),
                }
            }
        }));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    Mock { base: format!("http://{addr}"), index_hits, file_hits }
}

fn redirect() -> Response {
    (StatusCode::FOUND, [(header::LOCATION, "/raw-lyrics/words.ttml")]).into_response()
}

fn query(title: &str, artist: &str, duration_ms: Option<i64>) -> Query {
    Query { title: title.into(), artist: artist.into(), duration_ms }
}

#[tokio::test]
async fn finds_word_timed_ttml_by_title_and_artist() {
    let m = mock(row("Song", &["Artist"], "words.ttml")).await;
    let candidate = Amll::new(&m.base).unwrap().lookup(&query("Song", "Artist", Some(195_000))).await.unwrap().expect("found");
    assert_eq!(candidate.provider, "amll");
    assert_eq!((candidate.lyrics.format.as_str(), candidate.sync_level.as_str()), ("ttml", "word_level"));
    assert_eq!(candidate.lyrics.content, WORDS);
    assert_eq!(candidate.quality.match_score, 1.0);
}

#[tokio::test]
async fn title_and_artist_match_loosely_but_both_must_match() {
    let m = mock(row("ME! (feat. Somebody)", &["The Artist", "Somebody"], "words.ttml")).await;
    let amll = Amll::new(&m.base).unwrap();
    assert!(amll.lookup(&query("Me!", "the artist", Some(195_000))).await.unwrap().is_some());
    assert!(amll.lookup(&query("ME", "The Artist, Other", Some(195_000))).await.unwrap().is_some());
    assert!(amll.lookup(&query("Me!", "Stranger", Some(195_000))).await.unwrap().is_none());
    assert!(amll.lookup(&query("You", "The Artist", Some(195_000))).await.unwrap().is_none());
}

#[tokio::test]
async fn another_cut_of_the_song_is_refused_by_its_length() {
    let m = mock(row("Song", &["Artist"], "words.ttml")).await;
    let amll = Amll::new(&m.base).unwrap();
    assert!(amll.lookup(&query("Song", "Artist", Some(120_000))).await.unwrap().is_none(), "lyrics run past the end of the track");
    assert!(amll.lookup(&query("Song", "Artist", Some(600_000))).await.unwrap().is_none(), "lyrics cover under half the track");
}

#[tokio::test]
async fn the_newest_entry_that_fits_wins() {
    let index = [row("Song", &["Artist"], "words.ttml"), row("Song", &["Artist"], "short.ttml")].join("\n");
    let m = mock(index).await;
    let candidate = Amll::new(&m.base).unwrap().lookup(&query("Song", "Artist", Some(195_000))).await.unwrap().expect("found");
    assert_eq!(candidate.lyrics.content, WORDS, "the newer file is another cut, the older one fits");
}

#[tokio::test]
async fn a_file_without_timed_words_does_not_count() {
    let m = mock(row("Song", &["Artist"], "none.ttml")).await;
    assert!(Amll::new(&m.base).unwrap().lookup(&query("Song", "Artist", None)).await.unwrap().is_none());
}

#[tokio::test]
async fn the_index_is_fetched_once_for_many_lookups() {
    let m = mock(row("Song", &["Artist"], "words.ttml")).await;
    let amll = Amll::new(&m.base).unwrap();
    for _ in 0..3 {
        amll.lookup(&query("Song", "Artist", Some(195_000))).await.unwrap();
    }
    assert_eq!(m.index_hits.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn a_broken_index_row_is_skipped() {
    let m = mock(format!("not json\n{}\n{{\"metadata\":3}}", row("Song", &["Artist"], "words.ttml"))).await;
    assert!(Amll::new(&m.base).unwrap().lookup(&query("Song", "Artist", Some(195_000))).await.unwrap().is_some());
}

#[tokio::test]
async fn a_file_name_from_the_index_cannot_leave_the_folder() {
    let m = mock([row("Song", &["Artist"], "../metadata/raw-lyrics-index.jsonl"), row("Song", &["Artist"], "a/b.ttml")].join("\n")).await;
    assert!(Amll::new(&m.base).unwrap().lookup(&query("Song", "Artist", None)).await.unwrap().is_none());
    assert_eq!(m.file_hits.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn redirects_are_not_followed_and_oversized_files_are_dropped() {
    let moved = mock(row("Song", &["Artist"], "moved.ttml")).await;
    assert!(Amll::new(&moved.base).unwrap().lookup(&query("Song", "Artist", None)).await.unwrap().is_none());
    assert_eq!(moved.file_hits.load(Ordering::SeqCst), 1);
    let huge = mock(row("Song", &["Artist"], "huge.ttml")).await;
    assert!(Amll::new(&huge.base).unwrap().lookup(&query("Song", "Artist", None)).await.unwrap().is_none());
}

#[tokio::test]
async fn an_unreachable_index_is_an_error_not_a_miss() {
    assert!(Amll::new("http://127.0.0.1:9").unwrap().lookup(&query("Song", "Artist", None)).await.is_err());
}

#[test]
fn only_the_allowed_host_or_a_local_stand_in_is_accepted() {
    assert!(Amll::new(AMLL_URL).is_some());
    assert!(Amll::new("http://127.0.0.1:4000/db").is_some());
    for refused in ["", "http://raw.githubusercontent.com/a", "https://evil.example/a", "https://raw.githubusercontent.com.evil.example/a", "https://user@raw.githubusercontent.com/a", "https://raw.githubusercontent.com:8443/a", "http://10.0.0.1/a"] {
        assert!(Amll::new(refused).is_none(), "{refused}");
    }
}

#[test]
fn enhanced_lrc_counts_as_word_level() {
    assert_eq!(lrc_sync_level("[00:01.00]<00:01.00>One <00:01.50>two"), "word_level");
    assert_eq!(lrc_sync_level("[00:01.00]One two"), "line_level");
    assert_eq!(lrc_sync_level("[00:01.00]<bg>(ooh)\n[00:02.00]a <b> c"), "line_level");
}
