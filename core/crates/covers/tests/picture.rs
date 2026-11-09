use std::io::Cursor;

use image::{DynamicImage, ImageFormat, Rgb, RgbImage, Rgba, RgbaImage};
use nuvo_covers::picture::{process, video_square};

fn jpeg(img: RgbImage) -> Vec<u8> {
    let mut out = Cursor::new(Vec::new());
    DynamicImage::ImageRgb8(img).write_to(&mut out, ImageFormat::Jpeg).unwrap();
    out.into_inner()
}

fn decode(bytes: &[u8]) -> RgbImage {
    image::load_from_memory(bytes).unwrap().to_rgb8()
}

fn letterboxed(width: u32, height: u32) -> RgbImage {
    let bar = (height - width * 9 / 16) / 2;
    RgbImage::from_fn(width, height, |_, y| if y < bar || y >= height - bar { Rgb([0, 0, 0]) } else { Rgb([250, 250, 250]) })
}

#[test]
fn letterboxed_thumbnails_become_bar_free_squares() {
    assert_eq!(video_square(480, 360), 270);
    let out = process(jpeg(letterboxed(480, 360)), 256, true).unwrap();
    assert_eq!(out.content_type, "image/jpeg");
    let img = decode(&out.bytes);
    assert_eq!(img.dimensions(), (256, 256));
    for y in [0, 128, 255] {
        assert!(img.get_pixel(128, y).0[0] > 200, "row {y} must not be black");
    }
}

#[test]
fn wide_frames_are_cropped_to_their_height() {
    let out = process(jpeg(RgbImage::from_pixel(1280, 720, Rgb([10, 200, 10]))), 1024, true).unwrap();
    assert_eq!(decode(&out.bytes).dimensions(), (720, 720));
}

#[test]
fn originals_are_downscaled_to_the_bucket() {
    let out = process(jpeg(RgbImage::from_pixel(3000, 3000, Rgb([200, 10, 10]))), 1024, false).unwrap();
    assert_eq!(decode(&out.bytes).dimensions(), (1024, 1024));
}

#[test]
fn non_square_artwork_is_not_cropped() {
    let out = process(jpeg(RgbImage::from_pixel(600, 400, Rgb([1, 2, 3]))), 512, false).unwrap();
    let (w, h) = decode(&out.bytes).dimensions();
    assert!(w <= 512 && (f64::from(w) / f64::from(h) - 1.5).abs() < 0.01, "{w}x{h}");
}

#[test]
fn images_that_fit_are_kept_byte_for_byte() {
    let body = jpeg(RgbImage::from_pixel(256, 256, Rgb([9, 9, 9])));
    let out = process(body.clone(), 256, false).unwrap();
    assert_eq!((out.bytes, out.content_type), (body, "image/jpeg"));
}

#[test]
fn transparent_png_stays_png_and_garbage_fails() {
    let mut png = Cursor::new(Vec::new());
    DynamicImage::ImageRgba8(RgbaImage::from_pixel(800, 800, Rgba([0, 0, 0, 0]))).write_to(&mut png, ImageFormat::Png).unwrap();
    let out = process(png.into_inner(), 256, false).unwrap();
    assert_eq!(out.content_type, "image/png");
    assert_eq!(image::load_from_memory(&out.bytes).unwrap().width(), 256);
    assert!(process(b"<html>not an image</html>".to_vec(), 256, false).is_err());
}

#[test]
fn oversized_input_is_rejected() {
    let huge = vec![0u8; 21 * 1024 * 1024];
    assert!(process(huge, 256, false).is_err());
}

#[test]
fn image_with_huge_header_dimensions_is_rejected() {
    let mut tiny_png = vec![
        137, 80, 78, 71, 13, 10, 26, 10,
        0, 0, 0, 13, 73, 72, 68, 82,
        127, 255, 255, 255, 127, 255, 255, 255,
        8, 2, 0, 0, 0, 0, 0, 0, 0, 0,
    ];
    tiny_png.extend_from_slice(&[0u8; 100]);
    assert!(process(tiny_png, 256, false).is_err());
}

#[test]
fn video_square_avoids_overflow_with_large_width() {
    let huge_width = u32::MAX;
    let result = video_square(huge_width, 1000);
    assert!(result <= 1000);
}
