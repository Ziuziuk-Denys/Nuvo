mod common;

#[tokio::test(flavor = "multi_thread")]
async fn a_sidecar_lrc_answers_first_and_is_not_cached() {
    let core = common::local_core();
    let music = tempfile::tempdir().unwrap();
    common::write_wav(&music.path().join("Band - One.wav"), 1);
    std::fs::write(music.path().join("Band - One.lrc"), "[00:01.00]first line\n").unwrap();
    common::add_folder(&core, music.path()).await;
    let page = common::wait_tracks(&core, |p| p["total"] == 1 && p["items"][0]["hasLyrics"] == true).await;
    let id = page["items"][0]["track"]["id"].as_str().unwrap().to_string();
    let (_, body, _) = common::send(&core.app, common::request("GET", &format!("/v1/tracks/{id}/lyrics"), None)).await;
    let text = String::from_utf8(body).unwrap();
    assert!(text.contains("\"provider\":\"local_file\""), "{text}");
    assert!(text.contains("first line"));
    assert!(text.contains("line_synced"));

    std::fs::write(music.path().join("Band - One.lrc"), "plain words\n").unwrap();
    let (_, body, _) = common::send(&core.app, common::request("GET", &format!("/v1/tracks/{id}/lyrics"), None)).await;
    assert!(String::from_utf8(body).unwrap().contains("plain words"), "an edited sidecar shows at once");
}
