use std::io::Cursor;

use image::imageops::FilterType;
use image::{DynamicImage, ImageFormat, ImageReader, Limits};

use crate::CoverError;

const MAX_INPUT_BYTES: u64 = 20 * 1024 * 1024;
const MAX_MEGAPIXELS: u32 = 40;
const MAX_DIMENSION: u32 = 6500;
const MAX_ALLOC: u64 = 200 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq)]
pub struct Processed {
    pub bytes: Vec<u8>,
    pub content_type: &'static str,
}

fn mime(format: ImageFormat) -> Option<&'static str> {
    match format {
        ImageFormat::Jpeg => Some("image/jpeg"),
        ImageFormat::Png => Some("image/png"),
        ImageFormat::WebP => Some("image/webp"),
        _ => None,
    }
}

fn undecodable() -> CoverError {
    CoverError::Upstream("the cover image cannot be decoded".into())
}

// Centre square of the 16:9 area: W * 9 / 16 for a letterboxed 4:3 frame, the height for 16:9
pub fn video_square(width: u32, height: u32) -> u32 {
    height.min((u64::from(width) * 9 / 16) as u32)
}

pub fn process(body: Vec<u8>, bucket: u32, video: bool) -> Result<Processed, CoverError> {
    if body.len() as u64 > MAX_INPUT_BYTES {
        return Err(CoverError::Invalid("image too large".into()));
    }
    let reader = ImageReader::new(Cursor::new(&body)).with_guessed_format().map_err(|_| undecodable())?;
    let format = reader.format().ok_or_else(undecodable)?;
    let content_type = mime(format).ok_or_else(undecodable)?;
    let (width, height) = reader.into_dimensions().map_err(|_| undecodable())?;
    if u64::from(width) * u64::from(height) > u64::from(MAX_MEGAPIXELS) * 1_000_000 {
        return Err(CoverError::Invalid("image dimensions too large".into()));
    }
    let crop = video && height > 0 && f64::from(width) / f64::from(height) >= 1.2;
    let edge = if crop { video_square(width, height) } else { width.max(height) };
    if !crop && edge <= bucket {
        return Ok(Processed { bytes: body, content_type });
    }
    let mut limits = Limits::default();
    limits.max_image_width = Some(MAX_DIMENSION);
    limits.max_image_height = Some(MAX_DIMENSION);
    limits.max_alloc = Some(MAX_ALLOC);
    let mut reader = ImageReader::new(Cursor::new(&body)).with_guessed_format().map_err(|_| undecodable())?;
    reader.limits(limits);
    let mut picture = reader.decode().map_err(|_| undecodable())?;
    drop(body);
    if crop {
        let side = video_square(width, height);
        picture = picture.crop_imm((width - side) / 2, (height - side) / 2, side, side);
    }
    if picture.width().max(picture.height()) > bucket {
        picture = picture.resize(bucket, bucket, FilterType::CatmullRom);
    }
    encode(picture, format == ImageFormat::Png)
}

fn encode(picture: DynamicImage, from_png: bool) -> Result<Processed, CoverError> {
    let transparent = from_png && picture.color().has_alpha() && picture.to_rgba8().pixels().any(|p| p.0[3] < 255);
    let mut out = Cursor::new(Vec::new());
    if transparent {
        picture.write_to(&mut out, ImageFormat::Png).map_err(|e| CoverError::Upstream(e.to_string()))?;
        return Ok(Processed { bytes: out.into_inner(), content_type: "image/png" });
    }
    let rgb = DynamicImage::ImageRgb8(picture.to_rgb8());
    drop(picture);
    let encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, 85);
    rgb.write_with_encoder(encoder).map_err(|e| CoverError::Upstream(e.to_string()))?;
    Ok(Processed { bytes: out.into_inner(), content_type: "image/jpeg" })
}
