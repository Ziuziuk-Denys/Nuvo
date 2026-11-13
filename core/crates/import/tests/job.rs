use std::collections::HashSet;

use nuvo_contracts::{ImportNext, ImportRow};
use nuvo_import::job::{self, Target};
use nuvo_import::{Parsed, SourceRow};
use nuvo_store::{Connection, Db, StoreError, library, open_connection, playlists};
use serde_json::{Value, json};
use tempfile::TempDir;

fn open() -> (TempDir, Connection) {
    let dir = tempfile::tempdir().unwrap();
    let conn = open_connection(&dir.path().join("library.db"), &[5u8; 32], &dir.path().join("backups")).unwrap();
    (dir, conn)
}

fn track(id: &str, title: &str, artist: &str, ms: i64) -> Value {
    json!({"id": id, "title": title, "artists": [{"id": "", "name": artist}], "durationMs": ms})
}

fn meta_row(title: &str, artist: &str, ms: Option<i64>) -> SourceRow {
    SourceRow { title: title.into(), artists: vec![artist.into()], duration_ms: ms, ..Default::default() }
}

fn exact_row(id: &str) -> SourceRow {
    SourceRow { title: format!("Song {id}"), artists: vec!["A".into()], track: Some(track(id, &format!("Song {id}"), "A", 200_000)), ..Default::default() }
}

fn parsed(rows: Vec<SourceRow>) -> Parsed {
    Parsed { source_kind: "spotify-csv", label: "My Mix".into(), liked: false, rows }
}

fn playlist_tracks(conn: &Connection, id: &str) -> Vec<String> {
    playlists::get(conn, id).unwrap().items.into_iter().map(|i| i.track["id"].as_str().unwrap().to_string()).collect()
}

fn answer(conn: &Connection, id: &str, row_id: i64, answers: &[Option<Vec<Value>>]) -> ImportRow {
    for step in 0..6 {
        let given = answers.get(step).cloned().unwrap_or(Some(vec![]));
        let row = job::post_candidates(conn, id, row_id, step, given.clone().unwrap_or_default(), given.is_none(), 1000).unwrap();
        if row.label.is_some() {
            return row;
        }
    }
    panic!("row {row_id} never decided");
}

fn row_ids(conn: &Connection, id: &str) -> Vec<i64> {
    job::rows(conn, id, "all", None, 500).unwrap().items.iter().map(|r| r.id).collect()
}

#[test]
fn exact_rows_land_at_once_in_source_order_and_doubles_are_already_there() {
    let (_dir, conn) = open();
    let summary = job::start(&conn, &parsed(vec![exact_row("e1"), meta_row("Wait", "B", None), exact_row("e2"), exact_row("e1")]), &[], None, 1000).unwrap();
    assert_eq!((summary.label.as_str(), summary.target_kind.as_str(), summary.status.as_str()), ("My Mix", "playlist", "running"));
    assert_eq!((summary.total, summary.done, summary.counts.exact, summary.counts.already), (4, 3, 2, 1));
    let pid = summary.target_id.clone().unwrap();
    assert_eq!(playlists::get(&conn, &pid).unwrap().playlist.title, "My Mix", "a new playlist named after the source");
    assert_eq!(playlist_tracks(&conn, &pid), ["e1", "e2"]);
    let rows = job::rows(&conn, &summary.id, "all", None, 500).unwrap().items;
    assert_eq!(rows[3].reason.as_deref(), Some("already_there"));
    assert_eq!(rows[1].label, None, "a metadata row waits for its searches");
}

#[test]
fn leases_hand_out_each_row_once_and_expire() {
    let (_dir, conn) = open();
    let id = job::start(&conn, &parsed(vec![meta_row("One", "A", None), meta_row("Two", "A", None)]), &[], None, 1000).unwrap().id;
    let first = job::next(&conn, &id, 5000).unwrap();
    let second = job::next(&conn, &id, 5000).unwrap();
    let (ImportNext::Search { row_id: a, searches }, ImportNext::Search { row_id: b, .. }) = (&first, &second) else { panic!("{first:?} {second:?}") };
    assert_ne!(a, b);
    let asked: Vec<_> = searches.iter().map(|s| (s.query.as_str(), s.filter.as_str(), s.source.as_str(), s.step)).collect();
    assert_eq!(asked, [("A One", "songs", "youtube", 0), ("A One", "any", "soundcloud", 1)], "both sources at once");
    assert_eq!(job::next(&conn, &id, 5000).unwrap(), ImportNext::Wait { wait: job::LEASE_MS as u64 });
    let again = job::next(&conn, &id, 5000 + job::LEASE_MS).unwrap();
    assert!(matches!(again, ImportNext::Search { row_id, .. } if row_id == *a), "a crashed worker's row comes back");
}

#[tokio::test]
async fn four_workers_never_share_a_row() {
    let (_dir, conn) = open();
    let rows: Vec<SourceRow> = (0..8).map(|i| meta_row(&format!("Song {i}"), "A", None)).collect();
    let id = job::start(&conn, &parsed(rows), &[], None, 1000).unwrap().id;
    let db = Db::new(conn);
    let workers = (0..4).map(|_| {
        let (db, id) = (db.clone(), id.clone());
        tokio::spawn(async move { db.call(move |c| job::next(c, &id, 2000)).await.unwrap() })
    });
    let mut seen = HashSet::new();
    for worker in workers {
        let ImportNext::Search { row_id, .. } = worker.await.unwrap() else { panic!("expected a search") };
        assert!(seen.insert(row_id), "row {row_id} handed out twice");
    }
}

#[test]
fn labels_follow_the_match_outcome() {
    let (_dir, conn) = open();
    let source = vec![
        meta_row("Blinding Lights", "The Weeknd", Some(200_000)),
        meta_row("Song Title Here Tomorrowland", "Weeknd", Some(200_000)),
        meta_row("Levels", "Avicii", Some(199_000)),
        meta_row("Nothing Like It", "Nobody", Some(100_000)),
        meta_row("Search Fails", "Nobody", Some(100_000)),
        meta_row("Already Here", "C", Some(150_000)),
    ];
    let pid = playlists::create(&conn, &nuvo_contracts::CreatePlaylist { title: "Mine".into(), description: None, is_public: false }, 1).unwrap().id;
    playlists::add_track(&conn, &pid, "dup", Some(track("dup", "Already Here", "C", 150_000)), 1).unwrap();
    let id = job::start(&conn, &parsed(source), &[], Some(Target::Playlist(pid.clone())), 1000).unwrap().id;
    let ids = row_ids(&conn, &id);

    let likely = answer(&conn, &id, ids[0], &[Some(vec![track("bl", "Blinding Lights", "The Weeknd", 200_500)])]);
    assert_eq!((likely.label.as_deref(), likely.reason.as_deref(), likely.score), (Some("likely"), Some("matched"), Some(100)));
    let check = answer(&conn, &id, ids[1], &[Some(vec![track("st", "Song Title Here", "Weaknd", 206_000)])]);
    assert_eq!(check.label.as_deref(), Some("check"), "{check:?}");
    assert!((75..85).contains(&check.score.unwrap()));
    let long = answer(&conn, &id, ids[2], &[Some(vec![track("lv", "Levels", "Avicii", 270_000)])]);
    assert_eq!((long.label.as_deref(), long.reason.as_deref()), (Some("missing"), Some("duration_mismatch")));
    assert_eq!(long.track.as_ref().unwrap()["id"], "lv", "the proposal is offered");
    assert_eq!(long.duration_diff_ms, Some(71_000));
    let none = answer(&conn, &id, ids[3], &[]);
    assert_eq!((none.label.as_deref(), none.reason.as_deref(), none.track.as_ref()), (Some("missing"), Some("no_catalog_candidates"), None));
    let failed = answer(&conn, &id, ids[4], &[Some(vec![]), None]);
    assert_eq!(failed.reason.as_deref(), Some("catalog_lookup_failed"));
    let already = answer(&conn, &id, ids[5], &[Some(vec![track("dup", "Already Here", "C", 150_000)])]);
    assert_eq!((already.label.as_deref(), already.reason.as_deref()), (Some("already"), Some("already_there")));

    assert_eq!(playlist_tracks(&conn, &pid), ["dup", "bl", "st"], "matches keep source order after the items already there");
    let summary = job::summary(&conn, &id).unwrap();
    assert_eq!((summary.status.as_str(), summary.needs_review), ("done", 4));
    assert_eq!((summary.counts.likely, summary.counts.check, summary.counts.missing, summary.counts.already), (1, 1, 3, 1));
    assert_eq!(job::next(&conn, &id, 9000).unwrap(), ImportNext::Done { done: true });
}

#[test]
fn a_restart_resumes_at_the_next_step() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("library.db");
    let conn = open_connection(&path, &[5u8; 32], &dir.path().join("backups")).unwrap();
    let id = job::start(&conn, &parsed(vec![meta_row("Teardrop", "Massive Attack", None)]), &[], None, 1000).unwrap().id;
    let row = row_ids(&conn, &id)[0];
    job::post_candidates(&conn, &id, row, 0, vec![], false, 1000).unwrap();
    drop(conn);
    let conn = open_connection(&path, &[5u8; 32], &dir.path().join("backups")).unwrap();
    let ImportNext::Search { searches, .. } = job::next(&conn, &id, 2000).unwrap() else { panic!() };
    assert_eq!(searches.iter().map(|s| (s.step, s.source.as_str())).collect::<Vec<_>>(), [(1, "soundcloud")]);
    let stale = job::post_candidates(&conn, &id, row, 0, vec![], false, 2000);
    assert!(matches!(stale, Err(StoreError::Conflict(_))), "a late answer for step 0 does not count twice");
}

#[test]
fn a_round_keeps_its_lease_until_every_answer_is_in() {
    let (_dir, conn) = open();
    let id = job::start(&conn, &parsed(vec![meta_row("Teardrop", "Massive Attack", Some(330_000))]), &[], None, 1000).unwrap().id;
    let ImportNext::Search { row_id, .. } = job::next(&conn, &id, 2000).unwrap() else { panic!() };
    job::post_candidates(&conn, &id, row_id, 0, vec![], false, 2000).unwrap();
    assert!(matches!(job::next(&conn, &id, 2000).unwrap(), ImportNext::Wait { .. }), "SoundCloud is still being asked");
    job::post_candidates(&conn, &id, row_id, 1, vec![], false, 2000).unwrap();
    let ImportNext::Search { searches, .. } = job::next(&conn, &id, 2000).unwrap() else { panic!() };
    assert_eq!(searches.iter().map(|s| (s.step, s.filter.as_str())).collect::<Vec<_>>(), [(2, "any")]);
}

#[test]
fn a_sure_answer_decides_the_row_and_the_other_answer_is_late() {
    let (_dir, conn) = open();
    let id = job::start(&conn, &parsed(vec![meta_row("Teardrop", "Massive Attack", Some(330_000))]), &[], None, 1000).unwrap().id;
    let ImportNext::Search { row_id, .. } = job::next(&conn, &id, 2000).unwrap() else { panic!() };
    let mut official = track("sc:1", "Teardrop", "Massive Attack", 330_000);
    official["verified"] = serde_json::json!(true);
    let row = job::post_candidates(&conn, &id, row_id, 1, vec![official], false, 2000).unwrap();
    assert_eq!(row.label.as_deref(), Some("likely"));
    let late = job::post_candidates(&conn, &id, row_id, 0, vec![], false, 2000);
    assert!(matches!(late, Err(StoreError::Conflict(_))));
}

#[test]
fn decisions_change_the_target_in_one_go() {
    let (_dir, conn) = open();
    let summary = job::start(&conn, &parsed(vec![meta_row("Levels", "Avicii", Some(199_000)), meta_row("Blinding Lights", "The Weeknd", Some(200_000))]), &[], None, 1000).unwrap();
    let (id, pid) = (summary.id, summary.target_id.unwrap());
    let ids = row_ids(&conn, &id);
    answer(&conn, &id, ids[0], &[Some(vec![track("lv", "Levels", "Avicii", 270_000)])]);
    answer(&conn, &id, ids[1], &[Some(vec![track("bl", "Blinding Lights", "The Weeknd", 200_000)])]);
    let revision = playlists::get(&conn, &pid).unwrap().playlist.revision;

    let used = job::decide(&conn, &id, ids[0], "use", None, 2000).unwrap();
    assert_eq!(used.decision.as_deref(), Some("use"));
    assert_eq!(playlist_tracks(&conn, &pid), ["lv", "bl"], "the proposal lands at its source position");
    assert_eq!(playlists::get(&conn, &pid).unwrap().playlist.revision, revision + 1);

    let other = track("lv2", "Levels", "Avicii", 199_000);
    job::decide(&conn, &id, ids[0], "pick", Some(&other), 2001).unwrap();
    assert_eq!(playlist_tracks(&conn, &pid), ["lv2", "bl"]);
    job::decide(&conn, &id, ids[1], "remove", None, 2002).unwrap();
    assert_eq!(playlist_tracks(&conn, &pid), ["lv2"]);
    assert_eq!(job::decide(&conn, &id, ids[1], "keep", None, 2003).unwrap().decision.as_deref(), Some("keep"));
    assert!(matches!(job::decide(&conn, &id, ids[1], "use", None, 2004), Err(StoreError::Invalid(_))), "only Missing rows use a proposal");
    assert!(matches!(job::decide(&conn, &id, ids[1], "maybe", None, 2004), Err(StoreError::Invalid(_))));
    assert_eq!(job::summary(&conn, &id).unwrap().needs_review, 0);
}

#[test]
fn a_liked_target_likes_in_source_order_and_remove_unlikes() {
    let (_dir, conn) = open();
    library::like(&conn, "e2", Some(track("e2", "Song e2", "A", 200_000)), 1).unwrap();
    let source = Parsed { source_kind: "spotify-library", label: "Liked songs".into(), liked: true, rows: vec![exact_row("e1"), exact_row("e2"), exact_row("e3")] };
    let summary = job::start(&conn, &source, &[], None, 5000).unwrap();
    assert_eq!((summary.target_kind.as_str(), summary.target_id.as_deref()), ("liked", None));
    assert_eq!((summary.counts.exact, summary.counts.already, summary.status.as_str()), (2, 1, "done"));
    let page = library::liked_page(&conn, 10, None).unwrap();
    assert_eq!(page.items.iter().map(|i| i.track["id"].as_str().unwrap()).collect::<Vec<_>>(), ["e1", "e3", "e2"]);
    let first = row_ids(&conn, &summary.id)[0];
    job::decide(&conn, &summary.id, first, "remove", None, 6000).unwrap();
    assert!(!library::is_liked(&conn, "e1").unwrap());
    assert!(library::is_liked(&conn, "e2").unwrap(), "a track liked before the import stays liked");
}

#[test]
fn bulk_actions() {
    let (_dir, conn) = open();
    let id = job::start(&conn, &parsed(vec![meta_row("Song Title Here Tomorrowland", "Weeknd", Some(200_000)), meta_row("Down", "X", None)]), &[], None, 1000).unwrap().id;
    let ids = row_ids(&conn, &id);
    answer(&conn, &id, ids[0], &[Some(vec![track("st", "Song Title Here", "Weaknd", 206_000)])]);
    answer(&conn, &id, ids[1], &[None, None, None, None, None]);
    let after = job::bulk(&conn, &id, "accept-check").unwrap();
    assert_eq!(after.needs_review, 1);
    let retried = job::bulk(&conn, &id, "retry-failed").unwrap();
    assert_eq!((retried.status.as_str(), retried.done, retried.counts.missing), ("running", 1, 0));
    assert!(matches!(job::next(&conn, &id, 2000).unwrap(), ImportNext::Search { row_id, .. } if row_id == ids[1]));
    assert!(matches!(job::bulk(&conn, &id, "everything"), Err(StoreError::Invalid(_))));
}

#[test]
fn the_report_filters_pages_and_exports_csv() {
    let (_dir, conn) = open();
    let mut source = vec![meta_row("=HYPERLINK(\"x\")", "Evil, Inc", Some(1000)), meta_row("Plain", "B", None)];
    source.extend((0..5).map(|i| exact_row(&format!("e{i}"))));
    let id = job::start(&conn, &parsed(source), &[], None, 1000).unwrap().id;
    let ids = row_ids(&conn, &id);
    answer(&conn, &id, ids[0], &[]);
    answer(&conn, &id, ids[1], &[]);
    assert_eq!(job::rows(&conn, &id, "review", None, 100).unwrap().items.len(), 2);
    assert_eq!(job::rows(&conn, &id, "matched", None, 100).unwrap().items.len(), 5);
    let first = job::rows(&conn, &id, "all", None, 3).unwrap();
    let second = job::rows(&conn, &id, "all", first.next_cursor.as_deref(), 3).unwrap();
    assert_eq!((first.items[2].position, second.items[0].position), (2, 3));
    assert!(matches!(job::rows(&conn, &id, "odd", None, 3), Err(StoreError::Invalid(_))));

    let csv = job::report_csv(&conn, &id).unwrap();
    let lines: Vec<&str> = csv.lines().collect();
    assert_eq!(lines[0], "position,source_title,source_artists,source_album,source_duration_ms,label,score,reason,decision,match_id,match_title,match_artists,match_duration_ms,match_source");
    assert_eq!(lines[1], "0,\"'=HYPERLINK(\"\"x\"\")\",\"Evil, Inc\",,1000,missing,,no_catalog_candidates,,,,,,");
    assert_eq!(lines[3], "2,Song e0,A,,,exact,,exact,,e0,Song e0,A,200000,youtube");
    assert_eq!(lines.len(), 8);
}

#[test]
fn legacy_reviews_arrive_as_missing_rows() {
    let (_dir, conn) = open();
    let pid = playlists::create(&conn, &nuvo_contracts::CreatePlaylist { title: "Old".into(), description: None, is_public: false }, 1).unwrap().id;
    let rows = vec![
        json!({"title": "Song", "artists": ["A"], "durationMs": 200000, "reason": "ambiguous_match", "proposal": track("p1", "Song", "A", 201_000)}),
        json!({"title": "Other", "artists": [], "reason": "no_catalog_candidates"}),
    ];
    let (parsed, legacy) = job::parse_rows("legacy", "Old review", &rows).unwrap();
    let summary = job::start(&conn, &parsed, &legacy, Some(Target::Playlist(pid.clone())), 1000).unwrap();
    assert_eq!((summary.status.as_str(), summary.counts.missing, summary.target_id.as_deref()), ("done", 2, Some(pid.as_str())));
    let row = &job::rows(&conn, &summary.id, "all", None, 10).unwrap().items[0];
    assert_eq!((row.reason.as_deref(), row.track.as_ref().map(|t| t["id"].clone())), (Some("ambiguous_match"), Some(json!("p1"))));

    assert!(job::parse_rows("legacy", "x", &[json!({"title": "t", "reason": "made_up"})]).is_err());
    assert!(job::parse_rows("napster", "x", &[]).is_err());
    assert!(job::parse_rows("youtube-music", "  ", &[]).is_err());
    assert!(matches!(job::start(&conn, &parsed, &legacy, Some(Target::Playlist("gone".into())), 1), Err(StoreError::NotFound(_))));
}

#[test]
fn a_deleted_target_ends_the_job_and_bad_answers_are_refused() {
    let (_dir, conn) = open();
    let summary = job::start(&conn, &parsed(vec![meta_row("One", "A", None)]), &[], Some(Target::New), 1000).unwrap();
    let row = row_ids(&conn, &summary.id)[0];
    let too_many: Vec<Value> = (0..101).map(|i| track(&format!("c{i}"), "x", "y", 1)).collect();
    assert!(matches!(job::post_candidates(&conn, &summary.id, row, 0, too_many, false, 1), Err(StoreError::Invalid(_))));
    assert!(matches!(job::post_candidates(&conn, &summary.id, row, 0, vec![json!({"title": "no id"})], false, 1), Err(StoreError::Invalid(_))));
    assert!(matches!(job::post_candidates(&conn, &summary.id, 9999, 0, vec![], false, 1), Err(StoreError::NotFound(_))));
    playlists::delete(&conn, summary.target_id.as_deref().unwrap()).unwrap();
    assert!(matches!(job::next(&conn, &summary.id, 2000), Err(StoreError::NotFound("playlist"))));
    job::delete(&conn, &summary.id).unwrap();
    assert!(matches!(job::summary(&conn, &summary.id), Err(StoreError::NotFound(_))));
    assert!(job::list(&conn).unwrap().is_empty());
}

#[test]
fn a_batch_bumps_the_revision_once() {
    let (_dir, conn) = open();
    let pid = playlists::create(&conn, &nuvo_contracts::CreatePlaylist { title: "Mine".into(), description: None, is_public: false }, 1).unwrap().id;
    let before = playlists::get(&conn, &pid).unwrap().playlist.revision;
    job::start(&conn, &parsed(vec![exact_row("a"), exact_row("b"), exact_row("c")]), &[], Some(Target::Playlist(pid.clone())), 1000).unwrap();
    assert_eq!(playlists::get(&conn, &pid).unwrap().playlist.revision, before + 1);
}

#[test]
fn a_long_report_pages_through_the_csv_and_the_list_totals_each_import() {
    let (_dir, conn) = open();
    let rows: Vec<SourceRow> = (0..1203).map(|i| exact_row(&format!("t{i}"))).collect();
    let big = job::start(&conn, &parsed(rows), &[], None, 1000).unwrap();
    let small = job::start(&conn, &parsed(vec![meta_row("One", "A", None)]), &[], None, 2000).unwrap();
    let csv = job::report_csv(&conn, &big.id).unwrap();
    assert_eq!(csv.lines().count(), 1204);
    assert!(csv.lines().nth(1203).unwrap().starts_with("1202,Song t1202,"));
    let all = job::list(&conn).unwrap();
    assert_eq!(all.iter().map(|s| (s.id.as_str(), s.total, s.done)).collect::<Vec<_>>(), [(small.id.as_str(), 1, 0), (big.id.as_str(), 1203, 1203)]);
}

#[test]
fn nuvo_links_post_rows_like_any_listed_source() {
    let rows = vec![
        json!({"title": "Teardrop", "artists": ["Massive Attack"], "durationMs": 330000, "track": track("u7K72X4eo_s", "Teardrop", "Massive Attack", 330000)}),
        json!({"title": "Группа крови", "artists": ["Кино"]}),
    ];
    let (parsed, legacy) = job::parse_rows("nuvo-link", "Вечерний плейлист", &rows).unwrap();
    assert_eq!((parsed.source_kind, parsed.label.as_str(), parsed.rows.len(), legacy.len()), ("nuvo-link", "Вечерний плейлист", 2, 2));
    assert!(parsed.rows[0].track.is_some() && parsed.rows[1].track.is_none());

    let (_dir, conn) = open();
    let summary = job::start(&conn, &parsed, &legacy, None, 1_000).unwrap();
    assert_eq!((summary.source_kind.as_str(), summary.total, summary.counts.exact), ("nuvo-link", 2, 1));
}

#[test]
fn appended_pages_continue_the_source_order_and_keep_what_was_posted() {
    let (_dir, conn) = open();
    let first = job::start(&conn, &parsed(vec![exact_row("p1"), exact_row("p2")]), &[], None, 1000).unwrap();
    let pid = first.target_id.clone().unwrap();
    let second = job::append(&conn, &first.id, &[exact_row("p3"), meta_row("Wait", "B", None), exact_row("p1")], &[], 2000).unwrap();
    assert_eq!((second.total, second.done, second.counts.exact, second.counts.already, second.status.as_str()), (5, 4, 3, 1, "running"));
    assert_eq!(playlist_tracks(&conn, &pid), ["p1", "p2", "p3"]);
    assert_eq!(row_ids(&conn, &first.id).len(), 5);
}

#[test]
fn appending_past_the_row_cap_or_to_a_missing_import_is_refused() {
    let (_dir, conn) = open();
    assert!(matches!(job::append(&conn, "nope", &[exact_row("a")], &[], 1).unwrap_err(), StoreError::NotFound(_)));
    let first = job::start(&conn, &parsed(vec![meta_row("One", "A", None)]), &[], None, 1000).unwrap();
    let many: Vec<SourceRow> = (0..nuvo_import::MAX_ROWS).map(|i| meta_row(&format!("T{i}"), "A", None)).collect();
    assert!(matches!(job::append(&conn, &first.id, &many, &[], 2000).unwrap_err(), StoreError::Invalid(_)));
}

#[test]
fn a_liked_import_skips_a_second_copy_of_a_song_already_liked() {
    let (_dir, conn) = open();
    let copy = |id: &str, title: &str, ms: i64| SourceRow { title: title.into(), artists: vec!["A".into()], track: Some(track(id, title, "A", ms)), ..Default::default() };
    let summary = job::start(&conn, &parsed(vec![copy("single00001", "Skyline", 200_000), copy("albumcopy01", "Skyline (Album Version)", 201_000), copy("livecut0001", "Skyline (Live)", 200_000)]), &[], Some(Target::Liked), 1000).unwrap();
    assert_eq!((summary.counts.exact, summary.counts.already), (2, 1));
    let again = job::start(&conn, &parsed(vec![copy("albumcopy02", "Skyline", 200_500)]), &[], Some(Target::Liked), 2000).unwrap();
    assert_eq!((again.counts.exact, again.counts.already), (0, 1));
}
