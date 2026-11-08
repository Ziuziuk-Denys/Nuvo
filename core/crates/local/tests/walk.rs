#![cfg(unix)]
use std::fs;
use std::os::unix::fs::symlink;
use std::path::Path;

use nuvo_local::walk::{WalkLimits, folder_art, walk};

fn touch(path: &Path, bytes: &[u8]) {
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, bytes).unwrap();
}

#[test]
fn finds_audio_by_extension_and_pairs_lrc_sidecars() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    touch(&root.join("A/01 One.mp3"), b"x");
    touch(&root.join("A/01 One.LRC"), b"[00:01.00]hi");
    touch(&root.join("A/02 Two.FLAC"), b"xx");
    touch(&root.join("A/notes.txt"), b"no");
    touch(&root.join(".hidden/secret.mp3"), b"x");
    touch(&root.join("B/C/deep.opus"), b"x");
    let found = walk(root, WalkLimits::DEFAULT);
    let names: Vec<String> = found.files.iter().map(|f| f.path.strip_prefix(root).unwrap().display().to_string()).collect();
    assert_eq!(names, ["A/01 One.mp3", "A/02 Two.FLAC", "B/C/deep.opus"]);
    assert_eq!(found.files[0].lrc.as_deref(), Some(root.join("A/01 One.LRC").as_path()));
    assert_eq!(found.files[1].lrc, None);
    assert_eq!(found.files[1].size, 2);
    assert!(found.files[0].mtime_ms > 0);
}

#[test]
fn marks_the_files_of_a_folder_with_a_cover_image() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    touch(&root.join("A/one.mp3"), b"x");
    touch(&root.join("A/Cover.JPG"), b"x");
    touch(&root.join("B/two.mp3"), b"x");
    touch(&root.join("B/photo.jpg"), b"x");
    let found = walk(root, WalkLimits::DEFAULT);
    assert!(found.files[0].folder_art);
    assert!(!found.files[1].folder_art);
}

#[test]
fn never_follows_symlinks() {
    let dir = tempfile::tempdir().unwrap();
    let outside = tempfile::tempdir().unwrap();
    touch(&outside.path().join("private.mp3"), b"x");
    touch(&dir.path().join("real.mp3"), b"x");
    symlink(outside.path(), dir.path().join("escape")).unwrap();
    symlink(outside.path().join("private.mp3"), dir.path().join("link.mp3")).unwrap();
    symlink(dir.path(), dir.path().join("loop")).unwrap();
    let found = walk(dir.path(), WalkLimits::DEFAULT);
    assert_eq!(found.files.len(), 1);
    assert_eq!(found.skipped_links, 3);
}

#[test]
fn stops_at_the_limits() {
    let dir = tempfile::tempdir().unwrap();
    for i in 0..5 {
        touch(&dir.path().join(format!("{i}.mp3")), b"x");
    }
    touch(&dir.path().join("a/b/deep.mp3"), b"x");
    let capped = walk(dir.path(), WalkLimits { max_depth: 32, max_files: 3 });
    assert_eq!(capped.files.len(), 3);
    assert!(capped.truncated);
    let shallow = walk(dir.path(), WalkLimits { max_depth: 2, max_files: 100 });
    assert_eq!(shallow.files.len(), 5, "a/b is two levels down, past max_depth 2");
}

#[test]
fn folder_art_prefers_cover_and_ignores_links() {
    let dir = tempfile::tempdir().unwrap();
    touch(&dir.path().join("Folder.PNG"), b"p");
    touch(&dir.path().join("cover.jpg"), b"j");
    assert_eq!(folder_art(dir.path()), Some(dir.path().join("cover.jpg")));
    let other = tempfile::tempdir().unwrap();
    touch(&other.path().join("x.jpg"), b"j");
    symlink(other.path().join("x.jpg"), other.path().join("cover.jpg")).unwrap();
    assert_eq!(folder_art(other.path()), None);
}

#[test]
fn cyrillic_names_and_a_missing_root() {
    let dir = tempfile::tempdir().unwrap();
    touch(&dir.path().join("Музыка/Земфира - Бессонница.mp3"), b"x");
    touch(&dir.path().join("Музыка/Земфира - Бессонница.lrc"), b"x");
    let found = walk(dir.path(), WalkLimits::DEFAULT);
    assert_eq!(found.files.len(), 1);
    assert!(found.files[0].lrc.is_some());
    let missing = walk(&dir.path().join("nope"), WalkLimits::DEFAULT);
    assert!(missing.files.is_empty());
    assert_eq!(missing.unreadable_dirs, 1);
}

#[test]
fn a_symlinked_root_is_not_entered() {
    let real = tempfile::tempdir().unwrap();
    touch(&real.path().join("a.mp3"), b"x");
    let holder = tempfile::tempdir().unwrap();
    let link = holder.path().join("root");
    symlink(real.path(), &link).unwrap();
    let found = walk(&link, WalkLimits::DEFAULT);
    assert!(found.files.is_empty());
}
