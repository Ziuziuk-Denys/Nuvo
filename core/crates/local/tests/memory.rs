mod common;

use std::alloc::{GlobalAlloc, Layout, System};
use std::sync::atomic::{AtomicUsize, Ordering};

use lofty::config::WriteOptions;
use lofty::picture::{MimeType, Picture, PictureType};
use lofty::prelude::*;
use lofty::tag::{Tag, TagType};
use nuvo_local::tags::{read_cover, read_meta};

struct Counting;

static LIVE: AtomicUsize = AtomicUsize::new(0);
static PEAK: AtomicUsize = AtomicUsize::new(0);

unsafe impl GlobalAlloc for Counting {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        let live = LIVE.fetch_add(layout.size(), Ordering::SeqCst) + layout.size();
        PEAK.fetch_max(live, Ordering::SeqCst);
        unsafe { System.alloc(layout) }
    }

    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        LIVE.fetch_sub(layout.size(), Ordering::SeqCst);
        unsafe { System.dealloc(ptr, layout) }
    }

    unsafe fn realloc(&self, ptr: *mut u8, layout: Layout, new_size: usize) -> *mut u8 {
        if new_size >= layout.size() {
            let live = LIVE.fetch_add(new_size - layout.size(), Ordering::SeqCst) + new_size - layout.size();
            PEAK.fetch_max(live, Ordering::SeqCst);
        } else {
            LIVE.fetch_sub(layout.size() - new_size, Ordering::SeqCst);
        }
        unsafe { System.realloc(ptr, layout, new_size) }
    }
}

#[global_allocator]
static ALLOCATOR: Counting = Counting;

/// Peak extra heap while `work` runs. This file holds a single test, so nothing else allocates.
fn peak_during(work: impl FnOnce()) -> usize {
    let base = LIVE.load(Ordering::SeqCst);
    PEAK.store(base, Ordering::SeqCst);
    work();
    PEAK.load(Ordering::SeqCst) - base
}

#[test]
fn a_big_embedded_picture_is_never_pulled_into_memory() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("a.wav");
    common::write_wav(&path, 1);
    let mut tag = Tag::new(TagType::Id3v2);
    tag.push_picture(Picture::unchecked(vec![9; 12 * 1024 * 1024]).pic_type(PictureType::CoverFront).mime_type(MimeType::Png).build());
    tag.save_to_path(&path, WriteOptions::default()).unwrap();

    let mut cover = Some(vec![1]);
    let peak = peak_during(|| cover = read_cover(&path).unwrap());
    assert!(cover.is_none(), "a 12 MiB picture is over the cap");
    assert!(peak < 4 * 1024 * 1024, "reading the cover allocated {peak} bytes");

    // Tag reading cannot skip a picture, so a 12 MiB one is read (and dropped), never more.
    let peak = peak_during(|| {
        read_meta(&path).unwrap();
    });
    assert!(peak < 20 * 1024 * 1024, "reading the tags allocated {peak} bytes");

    let mut tag = Tag::new(TagType::Id3v2);
    tag.push_picture(Picture::unchecked(vec![9; 40 * 1024 * 1024]).pic_type(PictureType::CoverFront).mime_type(MimeType::Png).build());
    tag.save_to_path(&path, WriteOptions::default()).unwrap();
    let peak = peak_during(|| {
        let _ = read_meta(&path);
        let _ = read_cover(&path);
    });
    assert!(peak < 4 * 1024 * 1024, "a 40 MiB picture allocated {peak} bytes");
}
