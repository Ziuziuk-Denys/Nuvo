// The whisper.cpp model file: header, mel filters, vocabulary, then named tensors until the end

use std::collections::HashMap;

use crate::AlignError;

const MAGIC: u32 = 0x6767_6d6c;
const Q8_0_BLOCK: usize = 32;
const Q8_0_BYTES: usize = 34;
const Q5_1_BLOCK: usize = 32;
const Q5_1_BYTES: usize = 24;
const MAX_DIMS: usize = 4;
const MAX_NAME: usize = 256;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Hparams {
    pub n_vocab: usize,
    pub n_audio_ctx: usize,
    pub n_audio_state: usize,
    pub n_audio_head: usize,
    pub n_audio_layer: usize,
    pub n_text_ctx: usize,
    pub n_text_state: usize,
    pub n_text_head: usize,
    pub n_text_layer: usize,
    pub n_mels: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    F32,
    F16,
    Q5_1,
    Q8_0,
}

impl Kind {
    fn from_ggml(kind: u32) -> Option<Self> {
        Some(match kind {
            0 => Self::F32,
            1 => Self::F16,
            7 => Self::Q5_1,
            8 => Self::Q8_0,
            _ => return None,
        })
    }

    fn bytes_for(self, elements: usize) -> Option<usize> {
        match self {
            Self::F32 => elements.checked_mul(4),
            Self::F16 => elements.checked_mul(2),
            Self::Q5_1 => elements.is_multiple_of(Q5_1_BLOCK).then(|| elements / Q5_1_BLOCK * Q5_1_BYTES),
            Self::Q8_0 => elements.is_multiple_of(Q8_0_BLOCK).then(|| elements / Q8_0_BLOCK * Q8_0_BYTES),
        }
    }

    fn decode(self, bytes: &[u8]) -> Vec<f32> {
        match self {
            Self::F32 => floats(bytes),
            Self::F16 => halves(bytes),
            Self::Q5_1 => q5_1(bytes),
            Self::Q8_0 => q8_0(bytes),
        }
    }
}

/// Weights stay packed as in the file and are widened to f32 only while a layer uses them.
pub struct Tensor {
    /// Outermost first, like the PyTorch shape.
    pub shape: Vec<usize>,
    kind: Kind,
    bytes: Vec<u8>,
}

impl Tensor {
    pub fn elements(&self) -> usize {
        self.shape.iter().product()
    }

    pub fn to_f32(&self) -> Vec<f32> {
        self.kind.decode(&self.bytes)
    }

    /// Reads 8-bit weights in place instead of widening them.
    pub fn matvec(&self, x: &[f32]) -> Vec<f32> {
        use rayon::prelude::*;
        let rows = self.shape[0];
        let row_bytes = self.bytes.len() / rows;
        let mut out = vec![0.0; rows];
        out.par_chunks_mut(64).enumerate().for_each(|(chunk, out)| {
            for (i, value) in out.iter_mut().enumerate() {
                let row = &self.bytes[(chunk * 64 + i) * row_bytes..][..row_bytes];
                *value = match self.kind {
                    Kind::Q8_0 => row.as_chunks::<Q8_0_BYTES>().0.iter().zip(x.as_chunks::<Q8_0_BLOCK>().0).map(|(block, x)| half_at(block) * block[2..].iter().zip(x).map(|(q, x)| f32::from(*q as i8) * x).sum::<f32>()).sum(),
                    kind => kind.decode(row).iter().zip(x).map(|(w, x)| w * x).sum(),
                };
            }
        });
        out
    }

    /// Rows `range` of the outermost dimension; a row of a quantised tensor always holds whole blocks.
    pub fn rows(&self, range: std::ops::Range<usize>) -> Vec<f32> {
        let row_bytes = self.bytes.len() / self.shape[0];
        self.kind.decode(&self.bytes[range.start * row_bytes..range.end * row_bytes])
    }
}

pub struct ModelFile {
    pub hparams: Hparams,
    pub mel_filters: Vec<f32>,
    pub n_fft_bins: usize,
    pub vocab: Vec<Vec<u8>>,
    pub tensors: HashMap<String, Tensor>,
}

struct Reader<'a> {
    bytes: &'a [u8],
    at: usize,
}

impl<'a> Reader<'a> {
    fn take(&mut self, n: usize) -> Result<&'a [u8], AlignError> {
        let end = self.at.checked_add(n).filter(|end| *end <= self.bytes.len()).ok_or(AlignError::BadModel("the file ends early"))?;
        let slice = &self.bytes[self.at..end];
        self.at = end;
        Ok(slice)
    }

    fn u32(&mut self) -> Result<u32, AlignError> {
        Ok(u32::from_le_bytes(self.take(4)?.try_into().expect("four bytes")))
    }

    fn count(&mut self, limit: usize) -> Result<usize, AlignError> {
        let value = self.u32()? as usize;
        if value > limit {
            return Err(AlignError::BadModel("a size in the header is out of range"));
        }
        Ok(value)
    }

    fn done(&self) -> bool {
        self.at == self.bytes.len()
    }
}

pub fn parse(bytes: &[u8]) -> Result<ModelFile, AlignError> {
    let mut reader = Reader { bytes, at: 0 };
    if reader.u32()? != MAGIC {
        return Err(AlignError::BadModel("not a whisper model file"));
    }
    let mut field = || reader.count(1 << 20);
    let hparams = Hparams {
        n_vocab: field()?,
        n_audio_ctx: field()?,
        n_audio_state: field()?,
        n_audio_head: field()?,
        n_audio_layer: field()?,
        n_text_ctx: field()?,
        n_text_state: field()?,
        n_text_head: field()?,
        n_text_layer: field()?,
        n_mels: field()?,
    };
    let _ftype = reader.u32()?;
    let n_mels = reader.count(512)?;
    let n_fft_bins = reader.count(4096)?;
    let mel_filters = floats(reader.take(n_mels * n_fft_bins * 4)?);
    if n_mels != hparams.n_mels {
        return Err(AlignError::BadModel("the mel filters do not match the model"));
    }
    let n_tokens = reader.count(1 << 20)?;
    let mut vocab = Vec::with_capacity(n_tokens);
    for _ in 0..n_tokens {
        let length = reader.count(1024)?;
        vocab.push(reader.take(length)?.to_vec());
    }
    let mut tensors = HashMap::new();
    while !reader.done() {
        let n_dims = reader.count(MAX_DIMS)?;
        let name_length = reader.count(MAX_NAME)?;
        let kind = reader.u32()?;
        let mut shape = Vec::with_capacity(n_dims);
        for _ in 0..n_dims {
            shape.push(reader.count(1 << 24)?);
        }
        shape.reverse();
        let name = String::from_utf8(reader.take(name_length)?.to_vec()).map_err(|_| AlignError::BadModel("a tensor name is not text"))?;
        let elements: usize = shape.iter().product();
        let unsupported = || AlignError::BadModel("a tensor has an unsupported type");
        let kind = Kind::from_ggml(kind).ok_or_else(unsupported)?;
        let size = kind.bytes_for(elements).ok_or_else(unsupported)?;
        if shape.first().is_some_and(|rows| *rows == 0 || size % rows != 0) || shape.is_empty() {
            return Err(AlignError::BadModel("a tensor has an empty or uneven shape"));
        }
        tensors.insert(name, Tensor { shape, kind, bytes: reader.take(size)?.to_vec() });
    }
    Ok(ModelFile { hparams, mel_filters, n_fft_bins, vocab, tensors })
}

fn floats(bytes: &[u8]) -> Vec<f32> {
    bytes.as_chunks::<4>().0.iter().map(|b| f32::from_le_bytes(*b)).collect()
}

fn half_at(bytes: &[u8]) -> f32 {
    half::f16::from_le_bytes([bytes[0], bytes[1]]).to_f32()
}

fn halves(bytes: &[u8]) -> Vec<f32> {
    bytes.as_chunks::<2>().0.iter().map(|b| half::f16::from_le_bytes(*b).to_f32()).collect()
}

fn q8_0(bytes: &[u8]) -> Vec<f32> {
    let mut out = Vec::with_capacity(bytes.len() / Q8_0_BYTES * Q8_0_BLOCK);
    for block in bytes.as_chunks::<Q8_0_BYTES>().0 {
        let scale = half_at(block);
        out.extend(block[2..].iter().map(|q| f32::from(*q as i8) * scale));
    }
    out
}

// Four high bits packed in a u32, the low nibbles two per byte
fn q5_1(bytes: &[u8]) -> Vec<f32> {
    let mut out = Vec::with_capacity(bytes.len() / Q5_1_BYTES * Q5_1_BLOCK);
    for block in bytes.as_chunks::<Q5_1_BYTES>().0 {
        let (scale, min) = (half_at(block), half_at(&block[2..]));
        let high = u32::from_le_bytes(block[4..8].try_into().expect("four bytes"));
        let low = &block[8..];
        let value = |nibble: u8, bit: u32| f32::from(nibble | ((((high >> bit) & 1) as u8) << 4)) * scale + min;
        out.extend((0..16).map(|j| value(low[j] & 0x0f, j as u32)));
        out.extend((0..16).map(|j| value(low[j] >> 4, j as u32 + 16)));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn q8_0_scales_each_block() {
        let mut block = half::f16::from_f32(0.5).to_le_bytes().to_vec();
        block.extend((0..32).map(|i| (i as i8 - 16) as u8));
        let values = q8_0(&block);
        assert_eq!(values.len(), 32);
        assert_eq!(values[0], -8.0);
        assert_eq!(values[31], 7.5);
    }

    #[test]
    fn q5_1_joins_the_high_bit() {
        let mut block = half::f16::from_f32(1.0).to_le_bytes().to_vec();
        block.extend(half::f16::from_f32(-16.0).to_le_bytes());
        block.extend(1u32.to_le_bytes());
        block.extend([0x21; 16]);
        let values = q5_1(&block);
        assert_eq!(values[0], 1.0 + 16.0 - 16.0);
        assert_eq!(values[1], 1.0 - 16.0);
        assert_eq!(values[16], 2.0 - 16.0);
    }

    #[test]
    fn packed_rows_widen_on_their_own() {
        let mut bytes = Vec::new();
        for scale in [1.0f32, 2.0] {
            bytes.extend(half::f16::from_f32(scale).to_le_bytes());
            bytes.extend([1u8; 32]);
        }
        let tensor = Tensor { shape: vec![2, 32], kind: Kind::Q8_0, bytes };
        assert_eq!(tensor.rows(1..2), vec![2.0; 32]);
        assert_eq!(tensor.to_f32().len(), 64);
    }

    #[test]
    fn matvec_reads_packed_rows_like_widened_ones() {
        let mut bytes = Vec::new();
        for scale in [0.5f32, -2.0, 1.0] {
            bytes.extend(half::f16::from_f32(scale).to_le_bytes());
            bytes.extend((0..32).map(|i| (i as i8 - 7) as u8));
        }
        let tensor = Tensor { shape: vec![3, 32], kind: Kind::Q8_0, bytes };
        let x: Vec<f32> = (0..32).map(|i| (i % 5) as f32 - 2.0).collect();
        let widened = tensor.to_f32();
        let expected: Vec<f32> = widened.chunks(32).map(|row| row.iter().zip(&x).map(|(w, x)| w * x).sum()).collect();
        assert_eq!(tensor.matvec(&x), expected);
        let floats = Tensor { shape: vec![1, 2], kind: Kind::F32, bytes: [2.0f32, 3.0].iter().flat_map(|v| v.to_le_bytes()).collect() };
        assert_eq!(floats.matvec(&[1.0, 10.0]), [32.0]);
    }

    #[test]
    fn a_truncated_file_is_refused() {
        assert!(matches!(parse(&MAGIC.to_le_bytes()), Err(AlignError::BadModel(_))));
        assert!(matches!(parse(b"nope"), Err(AlignError::BadModel(_))));
    }
}
