use nuvo_match::text::{artist_and_title, base_title, compare_form, markers, normalize, remove_junk, same_artist, search_query, similarity, translit};
use serde_json::Value;

#[test]
fn normalised_words() {
    assert_eq!(normalize("  Hello,  WORLD!! ёж "), "hello world ёж");
    assert_eq!(compare_form("Ёжик.mp3"), "ежик");
    assert_eq!(compare_form("Song.FLAC (live)"), "song live");
}

#[test]
fn junk_and_base_titles() {
    assert_eq!(remove_junk("Track (Official Audio) @someone"), "Track");
    assert_eq!(remove_junk("Bones - HDMI (Prod. Greaf) [Free Download] (out now) *TEAMSESH*"), "Bones - HDMI");
    assert_eq!(remove_junk("Burial - Archangel (Kode9 Flip) [FREE DL] (prod. by Burial)"), "Burial - Archangel (Kode9 Flip)");
    assert_eq!(remove_junk("MAYOT - Море (tg: mayotmusic)"), "MAYOT - Море");
    assert_eq!(remove_junk("Song tg: channel"), "Song");
    assert_eq!(remove_junk("Song t.me/channel"), "Song");
    assert_eq!(remove_junk("Song prod. Someone Else"), "Song");
    assert_eq!(remove_junk("Song - Out Now"), "Song");
    assert_eq!(remove_junk("Song | Official Video"), "Song");
    assert_eq!(remove_junk("Song - 2011 Remaster"), "Song");
    assert_eq!(remove_junk("Song (2015 Remastered) [HD] ()"), "Song");
    assert_eq!(remove_junk("Нервы - Самый дорогой человек на свете.mp3"), "Нервы - Самый дорогой человек на свете");
    assert_eq!(remove_junk("Песня (из фильма «Брат»)"), "Песня");
    assert_eq!(base_title("Ёжик (feat. Кто-то) - Live at Moscow"), "ежик");
    assert_eq!(base_title("Peaches (feat. Daniel Caesar & Giveon)"), "peaches");
    assert_eq!(base_title("Song ft. Other & Third"), "song");
    assert_eq!(base_title("Paint It Black - Mono"), "paint it black");
    assert_eq!(base_title("Halo (Remix)"), "halo");
    assert_eq!(base_title("After Dark (Slowed + Reverb)"), "after dark");
    assert_eq!(base_title("Song - Ремастеринг 2009"), "song");
}

#[test]
fn artist_and_title_parsing() {
    let pair = |s: &str| artist_and_title(s);
    assert_eq!(pair("Massive Attack - Teardrop"), (Some("Massive Attack".into()), "Teardrop".into()));
    assert_eq!(pair("Channel - Massive Attack - Teardrop"), (Some("Massive Attack".into()), "Teardrop".into()));
    assert_eq!(pair("1999 - Song"), (None, "1999 - Song".into()));
    assert_eq!(pair("AC/DC: Thunderstruck"), (Some("AC/DC".into()), "Thunderstruck".into()));
    assert_eq!(pair("Just A Title"), (None, "Just A Title".into()));
}

#[test]
fn search_queries() {
    let q = search_query("Burial - Archangel (Kode9 Flip) [FREE DL] (prod. by Burial)", &["hyperdub_fan".into()]);
    assert_eq!((q.artist.as_str(), q.title.as_str(), q.query.as_str()), ("Burial", "Archangel (Kode9 Flip)", "Burial Archangel (Kode9 Flip)"));
    assert_eq!(markers("Burial - Archangel (Kode9 Flip) [FREE DL] (prod. by Burial)"), ["flip"]);
    let q = search_query("Bones - HDMI (Prod. Greaf) [Free Download] (out now) *TEAMSESH*", &[]);
    assert_eq!((q.title.as_str(), q.query.as_str()), ("HDMI", "Bones HDMI"));
    assert_eq!(search_query("Bones HDMI", &["Bones".into()]).query, "Bones HDMI");
    assert_eq!(search_query("Levels", &[]).query, "Levels");
}

#[test]
fn junk_only_titles_are_kept() {
    assert_eq!(search_query("(Official Video)", &["Artist".into()]).query, "Artist (Official Video)");
    assert_eq!(search_query("[FREE DL]", &[]).query, "[FREE DL]");
}

#[test]
fn artist_equality() {
    for (a, b) in [("Король и Шут", "Михаил Горшенев"), ("Скриптонит", "Scriptonite"), ("Pharaoh & Boulevard Depo", "Pharaoh"), ("Моргенштерн", "Morgenshtern"), ("В. Цой", "Кино"), ("Feduk", "Федук"), ("Фараон", "PHARAOH")] {
        assert!(same_artist(a, b), "{a} = {b}");
    }
    for (a, b) in [("Daft Punk", "Justice"), ("", ""), ("The Weeknd", "Cover Band"), ("MO", "MOTHER")] {
        assert!(!same_artist(a, b), "{a} != {b}");
    }
    assert_eq!(translit("Сайонара детка"), translit("Sayonara Детка"));
}

#[test]
fn version_markers() {
    assert_eq!(markers("Song (Sped Up + Nightcore)"), ["sped-up", "nightcore"]);
    assert_eq!(markers("After Dark (Slowed + Reverb)"), ["slowed", "reverb"]);
    assert!(markers("Plain").is_empty());
    assert_eq!(markers("Песня (ремикс)"), ["remix"]);
    assert_eq!(markers("Песня (концерт)"), ["live"]);
    assert_eq!(markers("Song (V.I.P.)"), ["vip"]);
    assert_eq!(markers("Song - Bass Boosted"), ["bass-boost"]);
    assert!(markers("Credit Where Due").is_empty() && markers("Alive").is_empty());
}

#[test]
fn similarity_properties() {
    assert_eq!(similarity("Звери Районы", "Районы Звери"), 100.0);
    assert_eq!(similarity("abc def", "xyz"), 0.0);
    assert_eq!(similarity("", "abc"), 0.0);
    let covered = similarity("самый дорогой человек", "самый дорогой человек на свете");
    assert!((70.0..=85.0).contains(&covered), "{covered}");
    assert!(similarity("levels", "levels avicii") >= 72.0);
    let typo = similarity("blinding lights", "blinding light");
    assert!(typo > 85.0 && typo < 100.0, "{typo}");
}

#[test]
fn social_tags_need_word_boundaries() {
    assert_eq!(remove_junk("Instant Crush"), "Instant Crush");
    assert_eq!(remove_junk("Outgoing Tide"), "Outgoing Tide");
    assert_eq!(remove_junk("Tiger X Lion"), "Tiger X Lion");
}

#[test]
fn unbracketed_with_stays() {
    assert_eq!(base_title("Stay With Me"), "stay with me");
    assert_eq!(base_title("Dancing with Myself"), "dancing with myself");
    assert_eq!(base_title("Song (with Artist)"), "song");
}

#[test]
fn hyphenated_artists() {
    assert_eq!(artist_and_title("Jay-Z - Encore"), (Some("Jay-Z".into()), "Encore".into()));
    assert_eq!(artist_and_title("Ne-Yo – So Sick"), (Some("Ne-Yo".into()), "So Sick".into()));
}

/// The fixture shared with `nuvo-recs` and the renderer: marker names use `_` there.
#[test]
fn shared_fixture_tags_match() {
    let cases: Vec<Value> = serde_json::from_str(include_str!("../../contracts/fixtures/canonical_titles.json")).unwrap();
    for case in cases {
        let title = case["title"].as_str().unwrap();
        let mut want: Vec<String> = case["tags"].as_array().unwrap().iter().map(|t| t.as_str().unwrap().replace('_', "-")).collect();
        let mut got: Vec<String> = markers(title).into_iter().map(str::to_string).collect();
        want.sort();
        got.sort();
        assert_eq!(got, want, "{title}");
    }
}

#[test]
fn markers_survive_promo_brackets() {
    assert_eq!(markers("Song (Remastered Remix)"), ["remix"]);
    assert_eq!(markers("Song (Exclusive Remix)"), ["remix"]);
    assert_eq!(markers("Song (Sped Up HD)"), ["sped-up"]);
    assert_eq!(markers("Song (Inst. Version)"), ["instrumental"]);
    assert_eq!(markers("Song (X Remix)"), ["remix"]);
    assert_eq!(remove_junk("Song (Sped Up HD)"), "Song (Sped Up)");
    assert_eq!(remove_junk("Song (Remastered Remix)"), "Song (Remix)");
    assert_eq!(base_title("Song (Sped Up HD)"), "song");
    assert_eq!(remove_junk("Song (Remastered)"), "Song");
}

#[test]
fn bracket_stripping_is_robust() {
    assert_eq!(remove_junk("Song (Official Video (HD))"), "Song");
    assert_eq!(remove_junk("Song (a (Official Video) b)"), "Song (a b)");
    assert_eq!(remove_junk("Song (Remix (Official Video) [HD]"), "Song (Remix");
    assert_eq!(remove_junk("Song (broken [HD] (Official Audio)"), "Song (broken");
    assert_eq!(remove_junk("Song {Official Video}"), "Song");
    assert_eq!(remove_junk("Song [Free Download] {HD} (4K)"), "Song");
    assert_eq!(remove_junk("Song ((((("), "Song (((((");
}

#[test]
fn links_and_handles() {
    for tail in ["vk.com/artist", "soundcloud.com/x/y", "INSTAGRAM.COM/foo", "x.com/foo", "twitter.com/foo", "T.ME/chan", "@someone", "(t.me/chan)", "[VK.com/x]"] {
        assert_eq!(remove_junk(&format!("Song {tail}")), "Song", "{tail}");
    }
    assert_eq!(remove_junk("Box.com/files"), "Box.com/files");
    assert_eq!(remove_junk("mail me@home"), "mail me@home");
}

#[test]
fn offsets_survive_special_case_mapping() {
    assert_eq!(remove_junk("İẞ x T.ME/chan"), "İẞ x");
    assert_eq!(remove_junk("İİİ vk.com/a Song"), "İİİ Song");
}

#[test]
fn unicode_is_normalised() {
    let (nfd, nfc) = ("Che\u{308}rny Beyonce\u{301}", "Ch\u{eb}rny Beyonc\u{e9}");
    assert_eq!(normalize(nfd), normalize(nfc));
    assert_eq!(compare_form(nfd), compare_form(nfc));
    assert_eq!(translit(nfd), translit(nfc));
    assert_eq!(similarity(nfd, nfc), 100.0);
    assert!(same_artist("Beyonce\u{301}", "Beyonc\u{e9}"));
    assert_eq!(remove_junk("Beyonce\u{301} (Official Video)"), "Beyonc\u{e9}");
    assert_eq!(base_title("Beyonce\u{301} - Halo (Remix)"), base_title("Beyonc\u{e9} - Halo (Remix)"));
}

#[test]
fn cyrillic_folds() {
    assert_eq!(compare_form("Чёрный"), compare_form("Черный"));
    assert_eq!(compare_form("Чёрный"), "черный");
    assert_eq!(compare_form("Чёрный"), compare_form("Чёрныи\u{306}"));
    assert_eq!(normalize("Ёж"), "ёж");
    assert_eq!(translit("Чёрный"), translit("Chernyi"));
    assert_eq!(translit("Майк"), translit("Maik"));
}

#[test]
fn by_credits() {
    assert_eq!(remove_junk("Feel the Beat by Beat"), "Feel the Beat by Beat");
    assert_eq!(remove_junk("Stand by Me"), "Stand by Me");
    assert_eq!(remove_junk("Written by Fire"), "Written by Fire");
    assert_eq!(remove_junk("Song beat by Someone"), "Song");
    assert_eq!(remove_junk("Song produced by X"), "Song");
    assert_eq!(remove_junk("Song prod by X"), "Song");
    assert_eq!(remove_junk("Song prod. X"), "Song");
    assert_eq!(remove_junk("Song (beat by X)"), "Song");
}

#[test]
fn artist_and_title_split_rules() {
    let pair = |s: &str| artist_and_title(s);
    assert_eq!(pair("Up - Artist - Title - Part Two"), (Some("Artist".into()), "Title - Part Two".into()));
    assert_eq!(pair("Up | Artist ~ Title"), (Some("Artist".into()), "Title".into()));
    assert_eq!(pair("A - B - Title"), (None, "A - B - Title".into()));
    assert_eq!(pair("A - Song"), (None, "A - Song".into()));
    assert_eq!(pair("2000 - Song"), (None, "2000 - Song".into()));
    assert_eq!(pair("12 34 - x"), (None, "12 34 - x".into()));
    assert_eq!(pair("Artist | Song"), (Some("Artist".into()), "Song".into()));
    assert_eq!(pair("Artist ~ Song"), (Some("Artist".into()), "Song".into()));
    assert_eq!(pair("Artist – Song"), (Some("Artist".into()), "Song".into()));
    assert_eq!(pair("Artist — Song"), (Some("Artist".into()), "Song".into()));
    assert_eq!(pair("Jay-Z"), (None, "Jay-Z".into()));
}

#[test]
fn dash_qualifiers_and_years() {
    for tail in ["2011 Remaster", "Remastered 2011", "Remaster", "Live at Wembley", "Live", "Acoustic", "Instrumental", "Radio Edit", "Single Version", "Original Mix", "Album Version", "Stereo", "Mono", "Ремастеринг 2009", "Ремастированная версия 2011", "Ремастер"] {
        assert_eq!(base_title(&format!("Song - {tail}")), "song", "{tail}");
    }
    assert_eq!(base_title("Song - 2011"), "song 2011");
    assert_eq!(base_title("Song - Part Two"), "song part two");
    assert_eq!(remove_junk("Song - Ремастеринг 2009"), "Song");
    assert_eq!(remove_junk("Song (Ремастер 2011)"), "Song");
    assert_eq!(remove_junk("Песня [Ремастированная версия]"), "Песня");
    assert_eq!(remove_junk("Song | Premiere"), "Song");
    assert_eq!(remove_junk("Song - Free DL"), "Song");
    assert_eq!(remove_junk("Song - Official Video"), "Song");
    assert_eq!(remove_junk("Song (Deluxe Edition) (Anniversary Edition)"), "Song");
    assert_eq!(base_title("Live"), "");
}

#[test]
fn alias_groups() {
    let groups: [&[&str]; 4] = [
        &["Кино", "Виктор Цой", "В. Цой", "Цой"],
        &["Король и Шут", "Горшок", "Михаил Горшенев", "Князь", "Андрей Князев"],
        &["Скриптонит", "Scriptonite"],
        &["Pharaoh", "Фараон"],
    ];
    for group in groups {
        for a in group {
            for b in group {
                assert!(same_artist(a, b), "{a} = {b}");
            }
        }
    }
    assert!(!same_artist("Кино", "Горшок"));
    assert!(!same_artist("Скриптонит", "Pharaoh"));
}

#[test]
fn empty_and_blank_input() {
    assert_eq!(remove_junk("()"), "");
    for blank in ["", "   ", "\t\n ", "---"] {
        assert_eq!(normalize(blank), "", "{blank:?}");
        assert_eq!(compare_form(blank), "");
        assert_eq!(remove_junk(blank), "");
        assert_eq!(base_title(blank), "");
        assert_eq!(translit(blank), "");
        assert!(markers(blank).is_empty());
        assert_eq!(artist_and_title(blank).0, None);
        assert_eq!(search_query(blank, &[]).query, "");
        assert_eq!(similarity(blank, blank), 0.0);
        assert_eq!(similarity(blank, "abc"), 0.0);
        assert!(!same_artist(blank, blank));
        assert!(!same_artist(blank, "abc"));
    }
}

#[test]
fn long_input_is_bounded() {
    let inputs = [
        " - ".repeat(100_000),
        "(".repeat(100_000),
        "[a ".repeat(100_000),
        "a ".repeat(100_000),
        "feat ".repeat(100_000),
        "prod. ".repeat(100_000),
        "*a".repeat(100_000),
        "a:".repeat(100_000),
        "e\u{301}".repeat(100_000),
        "İ".repeat(100_000),
        "@".repeat(100_000),
    ];
    let start = std::time::Instant::now();
    for input in &inputs {
        remove_junk(input);
        base_title(input);
        artist_and_title(input);
        markers(input);
        search_query(input, std::slice::from_ref(input));
        similarity(input, input);
        similarity(input, "a b c");
        same_artist(input, input);
        translit(input);
    }
    assert!(start.elapsed() < std::time::Duration::from_secs(3), "{:?}", start.elapsed());
    assert_eq!(normalize(&"a".repeat(1000)).chars().count(), 300);
    let words = "ab ".repeat(100_000);
    let start = std::time::Instant::now();
    nuvo_match::text::similarity_of_forms(&words, &words.replace("ab", "ba"));
    assert!(start.elapsed() < std::time::Duration::from_secs(1));
}

#[test]
fn similarity_is_symmetric() {
    let texts = ["alpha beta", "alpha alpha", "alpha", "beta alpha gamma", "alphb beta", "самый дорогой человек", "самый дорогой человек на свете", "levels", "levels avicii", "a b", "b a c"];
    for a in texts {
        for b in texts {
            assert_eq!(similarity(a, b), similarity(b, a), "{a} / {b}");
        }
    }
    assert!(similarity("alpha beta", "alpha alpha") < 100.0);
}
