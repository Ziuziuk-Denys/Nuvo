// Needs a multilingual model file: NUVO_ALIGN_MODEL=/path/ggml-base-q8_0.bin cargo test -p nuvo-align -- --ignored

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};

use nuvo_align::{AlignError, SAMPLE_RATE, Whisper, align, align_lrc, load, parse_lrc, to_ttml, with_low_priority};

fn model() -> Whisper {
    let path = std::env::var_os("NUVO_ALIGN_MODEL").expect("NUVO_ALIGN_MODEL names a model file");
    load(Path::new(&path)).expect("the model loads")
}

fn fixture(name: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures").join(name)
}

fn audio(lang: &str) -> Vec<f32> {
    let bytes = std::fs::read(fixture(&format!("{lang}.s16"))).unwrap();
    bytes.as_chunks::<2>().0.iter().map(|b| f32::from(i16::from_le_bytes(*b)) / 32768.0).collect()
}

fn lrc(lang: &str) -> String {
    std::fs::read_to_string(fixture(&format!("{lang}.lrc"))).unwrap()
}

/// Start of each spoken word, as placed by make.py.
fn truth(lang: &str) -> Vec<(u32, String)> {
    std::fs::read_to_string(fixture(&format!("{lang}.words")))
        .unwrap()
        .lines()
        .map(|line| {
            let mut fields = line.split('\t');
            (fields.next().unwrap().parse().unwrap(), fields.nth(1).unwrap().to_string())
        })
        .collect()
}

// espeak-ng's Russian is too robotic for the model to find it likely, so the timing is checked without the mismatch gate
fn check(model: &Whisper, lang: &str) {
    let audio = audio(lang);
    let calls = AtomicUsize::new(0);
    let lines = parse_lrc(&lrc(lang), 0, (audio.len() * 1000 / SAMPLE_RATE) as u32);
    let timed = with_low_priority(|| align(model, &audio, &lines, &|_| _ = calls.fetch_add(1, Ordering::Relaxed), &|| false)).unwrap().unwrap();
    let words: Vec<_> = timed.iter().flat_map(|line| &line.words).collect();
    let truth = truth(lang);
    assert_eq!(words.len(), truth.len(), "{lang}: every word is timed");
    let mut errors: Vec<u32> = words
        .iter()
        .zip(&truth)
        .map(|(word, (start_ms, text))| {
            assert_eq!(&word.text, text);
            word.start_ms.abs_diff(*start_ms)
        })
        .collect();
    errors.sort_unstable();
    let median = errors[errors.len() / 2];
    let close = errors.iter().filter(|e| **e <= 300).count() as f32 / errors.len() as f32;
    println!("{lang}: median start error {median} ms, {:.0}% within 300 ms, worst {} ms", close * 100.0, errors.last().unwrap());
    assert!(median <= 150, "{lang}: median start error {median} ms");
    assert!(close >= 0.8, "{lang}: only {:.0}% of words within 300 ms", close * 100.0);
    assert!(words.windows(2).all(|pair| pair[0].start_ms <= pair[1].start_ms && pair[0].start_ms <= pair[0].end_ms), "{lang}: words keep their order");
    assert!(calls.load(Ordering::Relaxed) > 0, "progress is reported");
    assert!(to_ttml(&timed, 0).contains(&format!(">{}</span>", truth[0].1)));
}

#[test]
#[ignore = "needs NUVO_ALIGN_MODEL"]
fn english_and_russian_words_land_on_the_audio() {
    let model = model();
    check(&model, "en");
    check(&model, "ru");
}

#[test]
#[ignore = "needs NUVO_ALIGN_MODEL"]
fn the_lyrics_of_the_song_pass_and_those_of_another_are_refused() {
    let model = model();
    let aligned = with_low_priority(|| align_lrc(&model, &audio("en"), &lrc("en"), 0, &|_| {}, &|| false)).unwrap().unwrap();
    assert!(aligned.ttml.starts_with("<tt ") && aligned.ttml.contains(">river</span>"));
    let result = with_low_priority(|| align_lrc(&model, &audio("en"), &lrc("ru"), 0, &|_| {}, &|| false)).unwrap();
    assert!(matches!(result, Err(AlignError::Mismatch)), "{:?}", result.err());
}

#[test]
#[ignore = "needs NUVO_ALIGN_MODEL"]
fn a_stop_request_ends_the_work() {
    let model = model();
    let result = align_lrc(&model, &audio("en"), &lrc("en"), 0, &|_| {}, &|| true);
    assert!(matches!(result, Err(AlignError::Cancelled)));
}
