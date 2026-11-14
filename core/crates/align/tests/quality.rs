// Needs a multilingual model file: NUVO_ALIGN_MODEL=/path/ggml-base-q8_0.bin cargo test -p nuvo-align -- --ignored

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};

use nuvo_align::{AlignError, SAMPLE_RATE, Whisper, align, align_lrc, align_text, load, parse_lrc, to_ttml, transcribe_song, with_low_priority};

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

fn plain(lang: &str) -> String {
    lrc(lang).lines().map(|line| line.split_once(']').unwrap().1).collect::<Vec<_>>().join("\n")
}

fn normalized(text: &str) -> Vec<String> {
    text.split_whitespace().map(|w| w.chars().filter(|c| c.is_alphanumeric()).flat_map(char::to_lowercase).collect::<String>().replace('ё', "е")).filter(|w| !w.is_empty()).collect()
}

fn word_errors(truth: &[String], heard: &[String]) -> f32 {
    let mut row: Vec<usize> = (0..=heard.len()).collect();
    for (i, a) in truth.iter().enumerate() {
        let mut diagonal = row[0];
        row[0] = i + 1;
        for (j, b) in heard.iter().enumerate() {
            let next = (diagonal + usize::from(a != b)).min(row[j] + 1).min(row[j + 1] + 1);
            diagonal = row[j + 1];
            row[j + 1] = next;
        }
    }
    row[heard.len()] as f32 / truth.len() as f32
}

// The robotic Russian fixture is not heard at all, so these two run on English only
#[test]
#[ignore = "needs NUVO_ALIGN_MODEL"]
fn a_song_without_lyrics_is_heard_and_timed() {
    let model = model();
    let calls = AtomicUsize::new(0);
    let made = with_low_priority(|| transcribe_song(&model, &audio("en"), None, &|_| _ = calls.fetch_add(1, Ordering::Relaxed), &|| false)).unwrap().unwrap();
    let words: Vec<_> = made.lines.iter().flat_map(|line| &line.words).collect();
    let heard: Vec<String> = words.iter().flat_map(|w| normalized(&w.text)).collect();
    let truth = truth("en");
    let errors = word_errors(&truth.iter().flat_map(|(_, w)| normalized(w)).collect::<Vec<_>>(), &heard);
    println!("en: word error rate {:.0}%, confidence {:.2}", errors * 100.0, made.confidence);
    assert_eq!(made.language, "en");
    assert!(errors <= 0.25, "{heard:?}");
    assert!(made.confidence > 0.0 && made.confidence <= 1.0);
    assert!(words.windows(2).all(|pair| pair[0].start_ms <= pair[0].end_ms), "words keep their order");
    assert!(words[0].start_ms.abs_diff(truth[0].0) <= 700, "the first word starts at {} ms", words[0].start_ms);
    assert!(calls.load(Ordering::Relaxed) > 0);
}

#[test]
#[ignore = "needs NUVO_ALIGN_MODEL"]
fn plain_lyrics_get_line_and_word_times() {
    let model = model();
    let made = with_low_priority(|| align_text(&model, &audio("en"), &plain("en"), None, &|_| {}, &|| false)).unwrap().unwrap();
    let truth = truth("en");
    let mut first_word = 0;
    let line_starts: Vec<u32> = plain("en")
        .lines()
        .map(|line| {
            let start_ms = truth[first_word].0;
            first_word += line.split_whitespace().count();
            start_ms
        })
        .collect();
    assert_eq!(made.lines.len(), line_starts.len());
    for (line, start_ms) in made.lines.iter().zip(&line_starts) {
        let error = line.words[0].start_ms.abs_diff(*start_ms);
        assert!(error <= 700, "a line starts {error} ms off");
    }
    assert_eq!(made.lines.iter().map(|l| l.words.len()).sum::<usize>(), truth.len(), "every word is timed");
    assert!(made.confidence >= 0.5, "{} of the words heard", made.confidence);
    let other = with_low_priority(|| align_text(&model, &audio("en"), &plain("ru"), None, &|_| {}, &|| false)).unwrap();
    assert!(matches!(other, Err(AlignError::Mismatch)), "{:?}", other.err());
}

#[test]
#[ignore = "needs NUVO_ALIGN_MODEL"]
fn a_stop_request_ends_a_transcription() {
    let model = model();
    assert!(matches!(transcribe_song(&model, &audio("en"), None, &|_| {}, &|| true), Err(AlignError::Cancelled)));
}
