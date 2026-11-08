//! Matching cases for the import adapter.

use nuvo_import::SourceRow;
use nuvo_import::matcher::{Decision, evaluate, ranked};
use serde_json::{Value, json};

fn s(title: &str, artist: &str, ms: Option<i64>) -> SourceRow {
    SourceRow { title: title.into(), artists: if artist.is_empty() { vec![] } else { vec![artist.into()] }, duration_ms: ms, ..Default::default() }
}

fn c(id: &str, title: &str, artist: &str, ms: i64) -> Value {
    json!({"id": id, "title": title, "artists": [{"id": "", "name": artist}], "durationMs": ms})
}

fn approved(decision: &Decision) -> Option<(usize, u8)> {
    match decision {
        Decision::Approved { index, score } => Some((*index, *score)),
        Decision::Pending { .. } => None,
    }
}

fn reason(decision: &Decision) -> &'static str {
    match decision {
        Decision::Pending { reason, .. } => reason,
        Decision::Approved { .. } => "approved",
    }
}

#[test]
fn exact_matches_and_durations() {
    let source = s("Blinding Lights", "The Weeknd", Some(200_000));
    assert_eq!(approved(&evaluate(&source, &[c("x", "Blinding Lights", "The Weeknd", 201_000)])), Some((0, 100)), "[1]");
    let far = evaluate(&source, &[c("x", "Blinding Lights", "Cover Band", 260_000)]);
    assert_eq!(far, Decision::Pending { reason: "duration_mismatch", score: far_score(&far), index: Some(0) }, "[2]");
    assert_eq!(reason(&evaluate(&source, &[c("x", "Blinding Lights", "Cover Band", 210_000)])), "low_confidence_match", "[3]");
    let unknown = s("Blinding Lights", "The Weeknd", None);
    assert!(approved(&evaluate(&unknown, &[c("x", "Blinding Lights", "The Weeknd", 201_000)])).unwrap().1 >= 95, "[4]");
    assert_eq!(evaluate(&source, &[]), Decision::Pending { reason: "low_confidence_match", score: None, index: None }, "[5]");
}

fn far_score(decision: &Decision) -> Option<u8> {
    match decision {
        Decision::Pending { score, .. } => *score,
        Decision::Approved { score, .. } => Some(*score),
    }
}

#[test]
fn versions_never_replace_each_other() {
    let halo = s("Halo", "Beyonce", Some(261_000));
    let versions = [c("r", "Halo (Remix)", "Beyonce", 261_000), c("l", "Halo (Live)", "Beyonce", 261_000)];
    assert_eq!(reason(&evaluate(&halo, &versions)), "low_confidence_match", "[6]");
    assert_eq!(reason(&evaluate(&s("Halo (Remix)", "Beyonce", Some(261_000)), &[c("x", "Halo", "Beyonce", 261_000)])), "low_confidence_match", "[7]");
    let cinema = s("Cinema (Skrillex Remix) [FREE DL]", "Benny Benassi", Some(248_000));
    let options = [c("p", "Cinema", "Benny Benassi", 248_000), c("l", "Cinema (Live)", "Benny Benassi", 248_000), c("r", "Cinema (Skrillex Remix)", "Benny Benassi", 249_000)];
    let (index, score) = approved(&evaluate(&cinema, &options)).expect("[21]");
    assert_eq!(index, 2);
    assert!(score >= 90, "[21]");
    let after_dark = s("After Dark (Slowed + Reverb)", "Mr.Kitty", Some(300_000));
    let (index, score) = approved(&evaluate(&after_dark, &[c("o", "After Dark", "Mr.Kitty", 259_000), c("s", "After Dark (Slowed + Reverb)", "Mr.Kitty", 301_000)])).expect("[22]");
    assert_eq!(index, 1);
    assert!(score >= 90, "[22]");
}

#[test]
fn close_candidates_are_ambiguous_unless_one_clearly_wins() {
    let shape = s("Shape of You", "Ed Sheeran", Some(233_000));
    let take = |ms_a, ms_b| [c("a", "Shape of You Studio Take", "Ed Sheeran", ms_a), c("b", "Shape of You Studio Demo", "Ed Sheeran", ms_b)];
    assert_eq!(reason(&evaluate(&shape, &take(239_000, 227_000))), "ambiguous_match", "[8]");
    assert!(approved(&evaluate(&shape, &take(234_000, 232_000))).unwrap().1 >= 85, "[9]");
    let same = [c("a", "Shape of You", "Ed Sheeran", 239_000), c("b", "Shape of You", "Ed Sheeran", 240_000)];
    assert!(approved(&evaluate(&shape, &same)).unwrap().1 >= 95, "[10]");
}

#[test]
fn titles_from_uploads_and_other_scripts() {
    let kino = s("Группа крови", "Кино", Some(287_000));
    assert_eq!(approved(&evaluate(&kino, &[c("x", "Группа крови", "Кино", 287_500), c("y", "Звезда", "Кино", 220_000)])).map(|a| a.0), Some(0), "[11]");
    let peaches = s("Peaches (feat. Daniel Caesar & Giveon)", "Justin Bieber", Some(198_000));
    assert!(approved(&evaluate(&peaches, &[c("x", "Peaches", "Justin Bieber", 198_000)])).unwrap().1 >= 95, "[12]");
    let plain = s("Peaches", "Justin Bieber", Some(198_000));
    assert!(approved(&evaluate(&plain, &[c("x", "Peaches (feat. Giveon)", "Justin Bieber", 198_000)])).unwrap().1 >= 95, "[12]");
    let mono = s("Paint It Black - Mono", "The Rolling Stones", Some(202_000));
    assert!(approved(&evaluate(&mono, &[c("x", "Paint It Black (Mono)", "The Rolling Stones", 203_000)])).is_some(), "[14]");
    let upload = s("Кино - Звезда по имени Солнце", "music_archive_77", Some(226_000));
    assert!(approved(&evaluate(&upload, &[c("x", "Звезда по имени Солнце", "Кино", 225_000)])).unwrap().1 >= 85, "[15]");
    let tagged = s("MAYOT - Море (tg: mayotmusic)", "MAYOT", Some(150_000));
    assert!(approved(&evaluate(&tagged, &[c("x", "Море", "MAYOT", 151_000)])).unwrap().1 >= 85, "[17]");
    let reverse = s("Прованс - Ёлка", "xx_user", Some(200_000));
    assert!(approved(&evaluate(&reverse, &[c("x", "Прованс", "Ёлка", 201_000)])).unwrap().1 >= 95, "[23]");
    let inside = s("Владивосток 2000 Мумий Тролль", "randomuser", Some(160_000));
    assert!(approved(&evaluate(&inside, &[c("x", "Владивосток 2000", "Мумий Тролль", 161_000)])).unwrap().1 >= 85, "[24]");
    let file = s("Нервы - Самый дорогой человек на свете.mp3", "vk_music", Some(210_000));
    assert!(approved(&evaluate(&file, &[c("x", "Самый дорогой человек", "Нервы", 213_000)])).unwrap().1 >= 80, "[25]");
    let partial = s("Каста - Вокруг шум сильный", "Каста", Some(200_000));
    assert_eq!(reason(&evaluate(&partial, &[c("x", "Шум", "Каста", 200_000)])), "low_confidence_match", "[26]");
}

#[test]
fn lengths_and_title_only_sources() {
    let levels = s("Levels", "Avicii", Some(199_000));
    assert_eq!(reason(&evaluate(&levels, &[c("v", "Levels", "Avicii", 270_000)])), "duration_mismatch", "[19]");
    let both = [c("v", "Levels (Official Music Video)", "Avicii", 270_000), c("a", "Levels", "Avicii", 200_000)];
    let (index, score) = approved(&evaluate(&levels, &both)).expect("[20]");
    assert_eq!((index, score >= 95), (1, true), "[20]");
    let no_artist = s("Levels", "", Some(199_000));
    assert!(approved(&evaluate(&no_artist, &[c("a", "Levels", "Avicii", 199_500)])).is_some(), "[27]");
    assert_eq!(reason(&evaluate(&no_artist, &[c("a", "Levels", "Avicii", 204_000)])), "low_confidence_match", "[27]");
    assert!(approved(&evaluate(&s("2000", "Artist", Some(200_000)), &[c("a", "2000", "Artist", 200_000)])).is_some(), "[28]");
}

#[test]
fn junk_words_do_not_hide_versions() {
    let plain = s("Song Name", "Band", Some(200_000));
    assert!(approved(&evaluate(&plain, &[c("x", "Song Name (Official Remix)", "Band", 200_000)])).is_none(), "remix is not the original");
    assert!(approved(&evaluate(&plain, &[c("x", "Song Name (Live Video)", "Band", 200_000)])).is_none(), "live is not the original");
    let remix = s("Song Name (Official Remix)", "Band", Some(200_000));
    assert!(approved(&evaluate(&remix, &[c("x", "Song Name", "Band", 200_000)])).is_none());
}

#[test]
fn containment_needs_a_word_boundary() {
    let source = s("Light", "Someone", Some(200_000));
    let boosted = |cand: &str| far_score(&evaluate(&source, &[c("x", cand, "Else", 200_000)])).unwrap();
    assert!(boosted("Lights") < 70, "Light vs Lights must not get the 92 boost");
}

#[test]
fn cyrillic_and_latin_spellings_match() {
    let feduk = s("Федук - Хлопья летят наверх", "Federal", Some(200_000));
    assert!(approved(&evaluate(&feduk, &[c("x", "Khlopya letyat naverkh", "Feduk", 200_500)])).is_some(), "title and artist in Latin");
    let kino = s("Group of Blood", "Kino", Some(287_000));
    assert!(approved(&evaluate(&kino, &[c("x", "Группа крови", "Кино", 287_500)])).is_none(), "a translation is not a transliteration");
    let latin_artist = s("Звезда", "Kino", Some(220_000));
    assert!(approved(&evaluate(&latin_artist, &[c("x", "Звезда", "Кино", 220_000)])).is_some(), "Kino is Кино");
}

#[test]
fn composed_and_decomposed_text_are_equal() {
    let source = s("Cafe\u{301} del Mar", "Energy 52", Some(200_000));
    assert!(approved(&evaluate(&source, &[c("x", "Caf\u{e9} del Mar", "Energy 52", 200_000)])).is_some());
}

#[test]
fn ranking_orders_candidates_and_keeps_pool_positions() {
    let source = s("Levels", "Avicii", Some(199_000));
    let pool = [c("a", "Other Song", "Someone", 100_000), json!({"title": "no id"}), c("b", "Levels", "Avicii", 199_000)];
    let order: Vec<usize> = ranked(&source, &pool).into_iter().map(|(at, _)| at).collect();
    assert_eq!(order, [2, 0], "the unreadable entry is skipped, positions point into the pool");
    assert_eq!(approved(&evaluate(&source, &pool)).map(|a| a.0), Some(2));
}
