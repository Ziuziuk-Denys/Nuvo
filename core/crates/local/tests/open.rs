//! `open_inside` walks from the registered folder without following a link at any component.

#![cfg(unix)]
use std::os::unix::fs::symlink;

use nuvo_local::open::open_inside;

#[test]
fn a_regular_file_inside_the_folder_opens() {
    let root = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(root.path().join("a/b")).unwrap();
    std::fs::write(root.path().join("a/b/song.mp3"), b"x").unwrap();
    assert!(open_inside(&root.path().join("a/b/song.mp3"), root.path()).is_ok());
}

#[test]
fn links_anywhere_on_the_way_and_paths_outside_are_refused() {
    let root = tempfile::tempdir().unwrap();
    let outside = tempfile::tempdir().unwrap();
    std::fs::write(outside.path().join("secret.mp3"), b"x").unwrap();
    symlink(outside.path(), root.path().join("dir")).unwrap();
    symlink(outside.path().join("secret.mp3"), root.path().join("file.mp3")).unwrap();
    for path in [root.path().join("dir/secret.mp3"), root.path().join("file.mp3"), root.path().join("../x.mp3"), outside.path().join("secret.mp3")] {
        assert!(open_inside(&path, root.path()).is_err(), "{}", path.display());
    }
    assert!(open_inside(root.path(), root.path()).is_err(), "the folder itself is not a file");
}
