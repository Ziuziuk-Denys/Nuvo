// Whisper's encoder and a teacher-forced decoder that also returns the raw cross-attention scores

use std::collections::HashMap;

use gemm::{Parallelism, gemm};

use crate::AlignError;
use crate::ggml::{Hparams, ModelFile, Tensor};
use crate::tokenizer::{MULTILINGUAL_VOCAB, Tokenizer};

const LAYER_NORM_EPS: f32 = 1e-5;

/// Row-major matrix view: `rows` rows of `cols` values, `stride` apart.
#[derive(Clone, Copy)]
struct View<'a> {
    data: &'a [f32],
    rows: usize,
    cols: usize,
    stride: usize,
}

impl<'a> View<'a> {
    fn new(data: &'a [f32], rows: usize, cols: usize) -> Self {
        Self { data, rows, cols, stride: cols }
    }

    fn columns(data: &'a [f32], rows: usize, from: usize, cols: usize, stride: usize) -> Self {
        Self { data: &data[from..], rows, cols, stride }
    }

    fn fits(&self) -> bool {
        self.rows == 0 || self.cols == 0 || (self.rows - 1) * self.stride + self.cols <= self.data.len()
    }
}

/// `out = a · b`, or `a · bᵀ` when `b_transposed`; `out` rows are `out_stride` apart.
fn product(a: View, b: View, b_transposed: bool, out: &mut [f32], out_stride: usize) {
    let (m, k) = (a.rows, a.cols);
    let n = if b_transposed { b.rows } else { b.cols };
    assert_eq!(k, if b_transposed { b.cols } else { b.rows }, "inner sizes");
    assert!(a.fits() && b.fits(), "views inside their data");
    assert!(m == 0 || n == 0 || (m - 1) * out_stride + n <= out.len(), "output inside its buffer");
    let (b_col_stride, b_row_stride) = if b_transposed { (b.stride, 1) } else { (1, b.stride) };
    // SAFETY: the asserts above keep every index gemm touches inside the three slices
    unsafe {
        gemm(
            m,
            n,
            k,
            out.as_mut_ptr(),
            1,
            out_stride as isize,
            false,
            a.data.as_ptr(),
            1,
            a.stride as isize,
            b.data.as_ptr(),
            b_col_stride as isize,
            b_row_stride as isize,
            0.0,
            1.0,
            false,
            false,
            false,
            Parallelism::Rayon(0),
        );
    }
}

struct Linear {
    weight: Vec<f32>,
    bias: Option<Vec<f32>>,
    inputs: usize,
    outputs: usize,
}

impl Linear {
    fn forward(&self, x: &[f32], rows: usize) -> Vec<f32> {
        let mut out = vec![0.0; rows * self.outputs];
        product(View::new(x, rows, self.inputs), View::new(&self.weight, self.outputs, self.inputs), true, &mut out, self.outputs);
        if let Some(bias) = &self.bias {
            for row in out.chunks_exact_mut(self.outputs) {
                row.iter_mut().zip(bias).for_each(|(v, b)| *v += b);
            }
        }
        out
    }
}

struct Norm {
    weight: Vec<f32>,
    bias: Vec<f32>,
}

impl Norm {
    fn forward(&self, x: &[f32]) -> Vec<f32> {
        let width = self.weight.len();
        let mut out = x.to_vec();
        for row in out.chunks_exact_mut(width) {
            let mean = row.iter().sum::<f32>() / width as f32;
            let variance = row.iter().map(|v| (v - mean) * (v - mean)).sum::<f32>() / width as f32;
            let scale = 1.0 / (variance + LAYER_NORM_EPS).sqrt();
            for ((v, w), b) in row.iter_mut().zip(&self.weight).zip(&self.bias) {
                *v = (*v - mean) * scale * w + b;
            }
        }
        out
    }
}

struct Attention {
    query: Linear,
    key: Linear,
    value: Linear,
    out: Linear,
    heads: usize,
}

struct Block {
    attn_ln: Norm,
    attn: Attention,
    cross: Option<(Norm, Attention)>,
    mlp_ln: Norm,
    mlp_in: Linear,
    mlp_out: Linear,
}

/// Keys and values of the encoded audio, once per decoder layer.
pub struct Cross {
    keys: Vec<Vec<f32>>,
    values: Vec<Vec<f32>>,
    frames: usize,
}

pub struct Decoded {
    /// Final hidden states, one row per input token.
    hidden: Vec<f32>,
    /// Raw scaled scores of each alignment head, `[head][token][frame]`.
    pub scores: Vec<f32>,
}

pub struct Whisper {
    pub hparams: Hparams,
    pub mel_filters: Vec<f32>,
    pub tokenizer: Tokenizer,
    conv1: Linear,
    conv2: Linear,
    encoder_positions: Vec<f32>,
    encoder: Vec<Block>,
    encoder_ln: Norm,
    token_embedding: Vec<f32>,
    decoder_positions: Vec<f32>,
    decoder: Vec<Block>,
    decoder_ln: Norm,
    pub alignment_heads: Vec<(usize, usize)>,
}

/// The cross-attention heads that follow the words, from the reference implementation.
fn alignment_heads(hparams: &Hparams) -> Option<Vec<(usize, usize)>> {
    let heads: &[(usize, usize)] = match (hparams.n_text_layer, hparams.n_text_state) {
        (4, 384) => &[(2, 2), (3, 0), (3, 2), (3, 3), (3, 4), (3, 5)],
        (6, 512) => &[(3, 1), (4, 2), (4, 3), (4, 7), (5, 1), (5, 2), (5, 4), (5, 6)],
        (12, 768) => &[(5, 3), (5, 9), (8, 0), (8, 4), (8, 7), (8, 8), (9, 0), (9, 7), (9, 9), (10, 5)],
        _ => return None,
    };
    Some(heads.to_vec())
}

struct Weights(HashMap<String, Tensor>);

impl Weights {
    fn take(&mut self, name: &str, shape: &[usize]) -> Result<Vec<f32>, AlignError> {
        let tensor = self.0.remove(name).ok_or(AlignError::BadModel("a tensor is missing"))?;
        let elements: usize = shape.iter().product();
        if tensor.data.len() != elements || tensor.shape.iter().product::<usize>() != elements {
            return Err(AlignError::BadModel("a tensor has the wrong shape"));
        }
        Ok(tensor.data)
    }

    fn linear(&mut self, name: &str, inputs: usize, outputs: usize, bias: bool) -> Result<Linear, AlignError> {
        let weight = self.take(&format!("{name}.weight"), &[outputs, inputs])?;
        let bias = if bias { Some(self.take(&format!("{name}.bias"), &[outputs])?) } else { None };
        Ok(Linear { weight, bias, inputs, outputs })
    }

    fn norm(&mut self, name: &str, width: usize) -> Result<Norm, AlignError> {
        Ok(Norm { weight: self.take(&format!("{name}.weight"), &[width])?, bias: self.take(&format!("{name}.bias"), &[width])? })
    }

    fn attention(&mut self, name: &str, width: usize, heads: usize) -> Result<Attention, AlignError> {
        Ok(Attention {
            query: self.linear(&format!("{name}.query"), width, width, true)?,
            key: self.linear(&format!("{name}.key"), width, width, false)?,
            value: self.linear(&format!("{name}.value"), width, width, true)?,
            out: self.linear(&format!("{name}.out"), width, width, true)?,
            heads,
        })
    }

    fn block(&mut self, name: &str, width: usize, heads: usize, cross: bool) -> Result<Block, AlignError> {
        let cross = if cross { Some((self.norm(&format!("{name}.cross_attn_ln"), width)?, self.attention(&format!("{name}.cross_attn"), width, heads)?)) } else { None };
        Ok(Block {
            attn_ln: self.norm(&format!("{name}.attn_ln"), width)?,
            attn: self.attention(&format!("{name}.attn"), width, heads)?,
            cross,
            mlp_ln: self.norm(&format!("{name}.mlp_ln"), width)?,
            mlp_in: self.linear(&format!("{name}.mlp.0"), width, 4 * width, true)?,
            mlp_out: self.linear(&format!("{name}.mlp.2"), 4 * width, width, true)?,
        })
    }
}

impl Whisper {
    pub fn from_file(file: ModelFile) -> Result<Self, AlignError> {
        let h = file.hparams;
        if h.n_vocab != MULTILINGUAL_VOCAB || h.n_audio_state != h.n_text_state || h.n_audio_ctx * 2 != crate::mel::FRAMES || file.n_fft_bins != crate::mel::N_FFT / 2 + 1 {
            return Err(AlignError::BadModel("only the multilingual tiny, base and small models are supported"));
        }
        let heads = alignment_heads(&h).ok_or(AlignError::BadModel("only the multilingual tiny, base and small models are supported"))?;
        let width = h.n_audio_state;
        let mut w = Weights(file.tensors);
        let conv = |w: &mut Weights, name: &str, inputs: usize| -> Result<Linear, AlignError> {
            let weight = w.take(&format!("encoder.{name}.weight"), &[width, inputs, 3])?;
            let bias = w.take(&format!("encoder.{name}.bias"), &[width])?;
            Ok(Linear { weight, bias: Some(bias), inputs: inputs * 3, outputs: width })
        };
        let conv1 = conv(&mut w, "conv1", h.n_mels)?;
        let conv2 = conv(&mut w, "conv2", width)?;
        let encoder_positions = w.take("encoder.positional_embedding", &[h.n_audio_ctx, width])?;
        let encoder = (0..h.n_audio_layer).map(|i| w.block(&format!("encoder.blocks.{i}"), width, h.n_audio_head, false)).collect::<Result<_, _>>()?;
        let encoder_ln = w.norm("encoder.ln_post", width)?;
        let token_embedding = w.take("decoder.token_embedding.weight", &[h.n_vocab, width])?;
        let decoder_positions = w.take("decoder.positional_embedding", &[h.n_text_ctx, width])?;
        let decoder = (0..h.n_text_layer).map(|i| w.block(&format!("decoder.blocks.{i}"), width, h.n_text_head, true)).collect::<Result<_, _>>()?;
        let decoder_ln = w.norm("decoder.ln", width)?;
        Ok(Self {
            hparams: h,
            tokenizer: Tokenizer::new(&file.vocab),
            mel_filters: file.mel_filters,
            conv1,
            conv2,
            encoder_positions,
            encoder,
            encoder_ln,
            token_embedding,
            decoder_positions,
            decoder,
            decoder_ln,
            alignment_heads: heads,
        })
    }

    fn width(&self) -> usize {
        self.hparams.n_audio_state
    }

    /// Encodes a 3000-frame log-mel window into 1500 audio states; `stop` is asked between layers.
    pub fn encode(&self, mel: &[f32], stop: &dyn Fn() -> bool) -> Result<Vec<f32>, AlignError> {
        let (bands, frames, width) = (self.hparams.n_mels, crate::mel::FRAMES, self.width());
        assert_eq!(mel.len(), bands * frames, "mel window size");
        let columns = im2col(frames, bands, 1, |t, c| mel[c * frames + t]);
        let mut x = self.conv1.forward(&columns, frames);
        x.iter_mut().for_each(|v| *v = gelu(*v));
        let positions = self.hparams.n_audio_ctx;
        let columns = im2col(positions, width, 2, |t, c| x[t * width + c]);
        let mut x = self.conv2.forward(&columns, positions);
        for (v, p) in x.iter_mut().zip(&self.encoder_positions) {
            *v = gelu(*v) + p;
        }
        for block in &self.encoder {
            if stop() {
                return Err(AlignError::Cancelled);
            }
            self.block(block, &mut x, positions, None, &mut |_, _| {});
        }
        Ok(self.encoder_ln.forward(&x))
    }

    /// Keys and values of the audio for every decoder layer, reused by each decoder pass on the window.
    pub fn cross(&self, audio: &[f32]) -> Cross {
        let frames = self.hparams.n_audio_ctx;
        let (keys, values) = self
            .decoder
            .iter()
            .map(|block| {
                let (_, attention) = block.cross.as_ref().expect("decoder blocks attend to the audio");
                (attention.key.forward(audio, frames), attention.value.forward(audio, frames))
            })
            .unzip();
        Cross { keys, values, frames }
    }

    /// Runs the decoder over `tokens` at once and keeps the alignment heads' scores over the first `frames` audio states.
    pub fn decode(&self, tokens: &[u32], cross: &Cross, frames: usize) -> Decoded {
        let (rows, width) = (tokens.len(), self.width());
        assert!(rows <= self.hparams.n_text_ctx && frames <= cross.frames, "decoder input fits its context");
        let mut x = Vec::with_capacity(rows * width);
        for (at, token) in tokens.iter().enumerate() {
            let embedding = &self.token_embedding[*token as usize * width..][..width];
            x.extend(embedding.iter().zip(&self.decoder_positions[at * width..][..width]).map(|(e, p)| e + p));
        }
        let mut scores = vec![0.0; self.alignment_heads.len() * rows * frames];
        for (layer, block) in self.decoder.iter().enumerate() {
            let mut keep = |head: usize, raw: &[f32]| {
                if let Some(slot) = self.alignment_heads.iter().position(|h| *h == (layer, head)) {
                    for (row, values) in raw.chunks_exact(cross.frames).enumerate() {
                        scores[(slot * rows + row) * frames..][..frames].copy_from_slice(&values[..frames]);
                    }
                }
            };
            self.block(block, &mut x, rows, Some((&cross.keys[layer], &cross.values[layer], cross.frames)), &mut keep);
        }
        Decoded { hidden: self.decoder_ln.forward(&x), scores }
    }

    /// Log-probabilities over the vocabulary after the token at `row`.
    pub fn log_probs(&self, decoded: &Decoded, row: usize) -> Vec<f32> {
        let width = self.width();
        let mut logits = vec![0.0; self.hparams.n_vocab];
        product(View::new(&decoded.hidden[row * width..][..width], 1, width), View::new(&self.token_embedding, self.hparams.n_vocab, width), true, &mut logits, self.hparams.n_vocab);
        let top = logits.iter().copied().fold(f32::MIN, f32::max);
        let log_sum = logits.iter().map(|v| (v - top).exp()).sum::<f32>().ln() + top;
        logits.iter_mut().for_each(|v| *v -= log_sum);
        logits
    }

    fn block(&self, block: &Block, x: &mut [f32], rows: usize, cross: Option<(&[f32], &[f32], usize)>, keep: &mut dyn FnMut(usize, &[f32])) {
        let causal = cross.is_some();
        let normed = block.attn_ln.forward(x);
        let attention = &block.attn;
        let (q, k, v) = (attention.query.forward(&normed, rows), attention.key.forward(&normed, rows), attention.value.forward(&normed, rows));
        let mixed = attend(&q, &k, &v, rows, rows, attention.heads, causal, &mut |_, _| {});
        add(x, &attention.out.forward(&mixed, rows));
        if let (Some((ln, attention)), Some((keys, values, frames))) = (&block.cross, cross) {
            let q = attention.query.forward(&ln.forward(x), rows);
            let mixed = attend(&q, keys, values, rows, frames, attention.heads, false, keep);
            add(x, &attention.out.forward(&mixed, rows));
        }
        let mut hidden = block.mlp_in.forward(&block.mlp_ln.forward(x), rows);
        hidden.iter_mut().for_each(|v| *v = gelu(*v));
        add(x, &block.mlp_out.forward(&hidden, rows));
    }
}

/// Rows of a kernel-3, padding-1 convolution input: `[t][c * 3 + k]` holds `x(t * stride + k - 1, c)`.
fn im2col(out_rows: usize, channels: usize, stride: usize, x: impl Fn(usize, usize) -> f32) -> Vec<f32> {
    let in_rows = out_rows * stride;
    let mut columns = vec![0.0; out_rows * channels * 3];
    for t in 0..out_rows {
        for c in 0..channels {
            for k in 0..3 {
                let at = (t * stride + k).checked_sub(1).filter(|at| *at < in_rows);
                if let Some(at) = at {
                    columns[(t * channels + c) * 3 + k] = x(at, c);
                }
            }
        }
    }
    columns
}

fn add(x: &mut [f32], delta: &[f32]) {
    x.iter_mut().zip(delta).for_each(|(v, d)| *v += d);
}

/// Multi-head attention of `rows` queries over `cols` keys; `keep` sees each head's scaled scores before the softmax.
#[allow(clippy::too_many_arguments)]
fn attend(q: &[f32], k: &[f32], v: &[f32], rows: usize, cols: usize, heads: usize, causal: bool, keep: &mut dyn FnMut(usize, &[f32])) -> Vec<f32> {
    let width = q.len() / rows;
    let size = width / heads;
    let scale = 1.0 / (size as f32).sqrt();
    let mut out = vec![0.0; rows * width];
    let mut scores = vec![0.0; rows * cols];
    for head in 0..heads {
        let from = head * size;
        product(View::columns(q, rows, from, size, width), View::columns(k, cols, from, size, width), true, &mut scores, cols);
        scores.iter_mut().for_each(|s| *s *= scale);
        keep(head, &scores);
        for (row, values) in scores.chunks_exact_mut(cols).enumerate() {
            if causal {
                values[row + 1..].fill(f32::NEG_INFINITY);
            }
            softmax(values);
        }
        product(View::new(&scores, rows, cols), View::columns(v, cols, from, size, width), false, &mut out[from..], width);
    }
    out
}

pub fn softmax(values: &mut [f32]) {
    let top = values.iter().copied().fold(f32::NEG_INFINITY, f32::max);
    let mut sum = 0.0;
    for v in values.iter_mut() {
        *v = (*v - top).exp();
        sum += *v;
    }
    values.iter_mut().for_each(|v| *v /= sum);
}

fn gelu(x: f32) -> f32 {
    0.5 * x * (1.0 + erf(x / std::f32::consts::SQRT_2))
}

/// Abramowitz and Stegun 7.1.26; error below 1.5e-7.
fn erf(x: f32) -> f32 {
    let t = 1.0 / (1.0 + 0.327_591_1 * x.abs());
    let poly = t * (0.254_829_6 + t * (-0.284_496_74 + t * (1.421_413_7 + t * (-1.453_152_1 + t * 1.061_405_4))));
    (1.0 - poly * (-x * x).exp()).copysign(x)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn products_follow_strides_and_transposes() {
        let a = [1.0, 2.0, 9.0, 3.0, 4.0, 9.0];
        let b = [5.0, 6.0, 7.0, 8.0];
        let mut out = [0.0; 4];
        product(View { data: &a, rows: 2, cols: 2, stride: 3 }, View::new(&b, 2, 2), false, &mut out, 2);
        assert_eq!(out, [19.0, 22.0, 43.0, 50.0]);
        product(View { data: &a, rows: 2, cols: 2, stride: 3 }, View::new(&b, 2, 2), true, &mut out, 2);
        assert_eq!(out, [17.0, 23.0, 39.0, 53.0]);
    }

    #[test]
    fn gelu_matches_the_exact_form() {
        assert!((gelu(1.0) - 0.841_344_7).abs() < 1e-5);
        assert!((gelu(-2.0) + 0.045_500_26).abs() < 1e-5);
        assert_eq!(gelu(0.0), 0.0);
    }

    #[test]
    fn causal_attention_ignores_later_tokens() {
        let q = [1.0, 1.0];
        let k = [1.0, 5.0];
        let v = [2.0, 100.0];
        let out = attend(&q, &k, &v, 2, 2, 1, true, &mut |_, _| {});
        assert_eq!(out[0], 2.0, "the first token sees only itself");
        assert!(out[1] > 90.0);
    }

    #[test]
    fn convolution_rows_pad_the_edges() {
        let columns = im2col(2, 1, 2, |t, _| t as f32 + 1.0);
        assert_eq!(columns, [0.0, 1.0, 2.0, 2.0, 3.0, 4.0]);
    }
}
