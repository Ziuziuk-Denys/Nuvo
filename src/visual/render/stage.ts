import { BANDS, WAVE, type Features } from "../signal/features";
import { RING_POINTS, createRing } from "../signal/ring";
import { evaluate } from "../template/bindings";
import type { Aspect, Layer, Template } from "../template/schema";
import { createProgram, createQuad, createTarget, createTexture, deleteTarget, getContext, uploadFloats, type GlCanvas, type Program, type Target } from "./gl";
import type { Pulse, Signals } from "../type/animations/types";
import type { Palette, Rgb } from "./palette";
import { COMMON } from "./shaders/common";
import { SHADERS } from "./shaders/library";

export const HISTORY_ROWS = 128;
export const HISTORY_RATE = 30;
export const GLYPHS = " .·:-=+*xo%#@";
const GLYPH_PX = 64;

const FINISH = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uScene;
uniform float uGrain;
uniform float uMono;
uniform float uTime;
uniform float uHit;
float hash(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}
vec3 srgb(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
void main() {
  vec2 shake = (vec2(hash(vec2(uTime * 61.0, 1.0)), hash(vec2(uTime * 53.0, 2.0))) - 0.5) * 0.012 * uHit;
  vec3 linear = vec3(0.0);
  for (int i = 0; i < 8; i++) linear += texture(uScene, 0.5 + (vUv + shake - 0.5) * (1.0 - float(i) * 0.011 * uHit)).rgb;
  linear /= 8.0;
  vec3 c = srgb(mix(linear, vec3(dot(linear, vec3(0.2126, 0.7152, 0.0722))), uMono));
  float n = hash(gl_FragCoord.xy + fract(uTime * 0.37) * 517.0) - 0.5;
  float m = hash(gl_FragCoord.yx * 1.3 + fract(uTime * 0.71) * 311.0) - 0.5;
  c += n * uGrain + (n + m) / 255.0;
  outColor = vec4(c, 1.0);
}`;

const COPY = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uSource;
void main() { outColor = texture(uSource, vUv); }`;

export interface Stage {
  setTemplate(template: Template, aspect: Aspect): void;
  prepare(shader: string): void;
  setCover(image: TexImageSource, palette: Palette): void;
  setText(text: TexImageSource | null): void;
  setImage(image: TexImageSource | null, width: number, height: number): void;
  step(timeMs: number, features: Features): Pulse;
  render(signals: Signals, reduced?: boolean): void;
  resize(width: number, height: number): void;
  reset(): void;
  dispose(): void;
}

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const linear = (rgb: Rgb) => rgb.map(toLinear) as Rgb;

function fragmentFor(id: string): string {
  const def = SHADERS[id];
  if (!def) throw new Error(`unknown shader ${id}`);
  const params = Object.keys(def.params)
    .map((name) => `uniform float u_${name};`)
    .join("\n");
  return `${COMMON}\n${params}\n${def.body}\nvoid main() { outColor = layer(); }`;
}

export function createStage(canvas: GlCanvas): Stage | null {
  const gl = getContext(canvas);
  if (!gl) return null;
  const quad = createQuad(gl);
  const programs = new Map<string, Program>();
  const finish = createProgram(gl, FINISH);
  const copy = createProgram(gl, COPY);

  const cover = createTexture(gl, gl.LINEAR_MIPMAP_LINEAR, gl.MIRRORED_REPEAT);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.SRGB8_ALPHA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([20, 22, 28, 255]));
  const text = createTexture(gl, gl.LINEAR_MIPMAP_LINEAR);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
  const bands = createTexture(gl, gl.LINEAR);
  const wave = createTexture(gl, gl.LINEAR);
  const history = createTexture(gl, gl.LINEAR, gl.REPEAT);
  const ringTexture = createTexture(gl, gl.LINEAR, gl.REPEAT);
  const ring = createRing();
  uploadFloats(gl, ringTexture, RING_POINTS, 1, new Float32Array(RING_POINTS));
  const historyData = new Float32Array(BANDS * HISTORY_ROWS);
  uploadFloats(gl, history, BANDS, HISTORY_ROWS, historyData);
  uploadFloats(gl, bands, BANDS, 1, new Float32Array(BANDS));
  uploadFloats(gl, wave, WAVE, 1, new Float32Array(WAVE));

  const image = createTexture(gl, gl.LINEAR_MIPMAP_LINEAR);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.SRGB8_ALPHA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
  let imageAspect = 1;
  let hasImage = 0;
  const glyphs = createTexture(gl, gl.LINEAR);
  const atlas = new OffscreenCanvas(GLYPH_PX * GLYPHS.length, GLYPH_PX);
  const atlasCtx = atlas.getContext("2d")!;
  atlasCtx.fillStyle = "#fff";
  atlasCtx.textAlign = "center";
  atlasCtx.textBaseline = "middle";
  atlasCtx.font = `700 ${GLYPH_PX * 0.9}px ui-monospace, "DejaVu Sans Mono", monospace`;
  [...GLYPHS].forEach((glyph, i) => atlasCtx.fillText(glyph, (i + 0.5) * GLYPH_PX, GLYPH_PX * 0.55));
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, atlas);

  let template: Template | null = null;
  let aspect: Aspect = "tall";
  let palette: Record<keyof Palette, Rgb> | null = null;
  let scene: Target | null = null;
  let backdrop: Target | null = null;
  const feedback = new Map<number, [Target, Target]>();
  let width = 1;
  let height = 1;

  let lastMs: number | null = null;
  let cuts = 0;
  let cutAtMs = -Infinity;
  let drive = 0;
  let historyHead = 0;
  let historyDue = 0;
  let frameMs = 0;
  let frameDelta = 0;
  let frameFeatures: Features | null = null;
  let signals: Signals = { invert: 0, flash: 0, strobe: 0, blackout: 0 };

  function program(id: string): Program {
    let found = programs.get(id);
    if (!found) {
      found = createProgram(gl!, fragmentFor(id));
      programs.set(id, found);
    }
    return found;
  }

  function dropTargets(): void {
    if (scene) deleteTarget(gl!, scene);
    scene = null;
    if (backdrop) deleteTarget(gl!, backdrop);
    backdrop = null;
    for (const [a, b] of feedback.values()) {
      deleteTarget(gl!, a);
      deleteTarget(gl!, b);
    }
    feedback.clear();
  }

  function reset(): void {
    lastMs = null;
    cuts = 0;
    cutAtMs = -Infinity;
    drive = 0;
    historyHead = 0;
    historyDue = 0;
    historyData.fill(0);
    ring.reset();
    uploadFloats(gl!, history, BANDS, HISTORY_ROWS, historyData);
    for (const pair of feedback.values()) {
      for (const target of pair) {
        gl!.bindFramebuffer(gl!.FRAMEBUFFER, target.framebuffer);
        gl!.clearColor(0, 0, 0, 0);
        gl!.clear(gl!.COLOR_BUFFER_BIT);
      }
    }
    gl!.bindFramebuffer(gl!.FRAMEBUFFER, null);
  }

  function advance(timeMs: number, features: Features): number {
    const delta = lastMs === null ? 1000 / 60 : Math.max(0, Math.min(250, timeMs - lastMs));
    lastMs = timeMs;
    if (features.onset === 1) {
      cuts += 1;
      cutAtMs = timeMs;
    }
    drive += (delta / 1000) * (0.25 + features.level + 1.5 * features.onset);
    historyDue += delta;
    while (historyDue >= 1000 / HISTORY_RATE) {
      historyDue -= 1000 / HISTORY_RATE;
      historyHead = (historyHead + 1) % HISTORY_ROWS;
      historyData.set(features.bands, historyHead * BANDS);
    }
    uploadFloats(gl!, history, BANDS, HISTORY_ROWS, historyData);
    uploadFloats(gl!, bands, BANDS, 1, features.bands);
    uploadFloats(gl!, wave, WAVE, 1, features.wave);
    uploadFloats(gl!, ringTexture, RING_POINTS, 1, ring.step(delta, features));
    return delta / 1000;
  }

  function bindCommon(p: Program, timeMs: number, delta: number, features: Features): void {
    const u = p.uniforms;
    const frame = template!.layouts[aspect];
    const set1 = (name: string, value: number) => {
      const location = u.get(name);
      if (location) gl!.uniform1f(location, value);
    };
    const set3 = (name: string, value: Rgb) => {
      const location = u.get(name);
      if (location) gl!.uniform3f(location, value[0], value[1], value[2]);
    };
    const resolution = u.get("uResolution");
    if (resolution) gl!.uniform2f(resolution, width, height);
    const focus = u.get("uFocus");
    if (focus) gl!.uniform2f(focus, frame.focus[0], frame.focus[1]);
    set1("uScale", frame.scale);
    set1("uTime", timeMs / 1000);
    set1("uDelta", delta);
    set1("uDrive", drive);
    set1("uBass", features.bass);
    set1("uMid", features.mid);
    set1("uHigh", features.high);
    set1("uLevel", features.level);
    set1("uFlux", features.flux);
    set1("uOnset", features.onset);
    set1("uBeat", features.beat);
    set1("uCut", cuts);
    set1("uCutAge", (timeMs - cutAtMs) / 1000);
    set1("uHistoryHead", (historyHead + 0.5) / HISTORY_ROWS);
    set1("uImageAspect", imageAspect);
    set1("uHasImage", hasImage);
    set1("uGlyphCount", GLYPHS.length);
    set1("uInvert", signals.invert);
    set1("uFlash", signals.flash);
    set1("uStrobe", signals.strobe);
    set1("uBlackout", signals.blackout);
    const custom = template!.colors;
    set1("uCustom", custom ? 1 : 0);
    if (custom) {
      set3("uColorA", linear(custom.a));
      set3("uColorB", linear(custom.b));
    }
    if (palette) {
      set3("uDeep", palette.deep);
      set3("uKey", palette.key);
      set3("uCool", palette.cool);
      set3("uLight", palette.light);
    }
    const textures: [string, WebGLTexture][] = [
      ["uCover", cover],
      ["uBands", bands],
      ["uWave", wave],
      ["uHistory", history],
      ["uText", text],
      ["uImage", image],
      ["uGlyphs", glyphs],
      ["uRing", ringTexture],
    ];
    textures.forEach(([name, texture], unit) => {
      const location = u.get(name);
      if (!location) return;
      gl!.activeTexture(gl!.TEXTURE0 + unit);
      gl!.bindTexture(gl!.TEXTURE_2D, texture);
      gl!.uniform1i(location, unit);
    });
  }

  function setBlend(layer: Layer): void {
    gl!.enable(gl!.BLEND);
    if (layer.blend === "add") gl!.blendFunc(gl!.ONE, gl!.ONE);
    else if (layer.blend === "screen") gl!.blendFunc(gl!.ONE, gl!.ONE_MINUS_SRC_COLOR);
    else if (layer.blend === "multiply") gl!.blendFunc(gl!.DST_COLOR, gl!.ONE_MINUS_SRC_ALPHA);
    else gl!.blendFunc(gl!.ONE, gl!.ONE_MINUS_SRC_ALPHA);
  }

  function drawLayer(layer: Layer, index: number, timeMs: number, delta: number, features: Features, reduced: boolean): void {
    const def = SHADERS[layer.shader];
    if (def.backdrop) {
      if (!backdrop) backdrop = createTarget(gl!, width, height);
      gl!.bindFramebuffer(gl!.READ_FRAMEBUFFER, scene!.framebuffer);
      gl!.bindFramebuffer(gl!.DRAW_FRAMEBUFFER, backdrop.framebuffer);
      gl!.blitFramebuffer(0, 0, width, height, 0, 0, width, height, gl!.COLOR_BUFFER_BIT, gl!.NEAREST);
      gl!.bindFramebuffer(gl!.FRAMEBUFFER, scene!.framebuffer);
    }
    const p = program(layer.shader);
    gl!.useProgram(p.program);
    bindCommon(p, timeMs, delta, features);
    for (const [name, spec] of Object.entries(def.params)) {
      const location = p.uniforms.get(`u_${name}`);
      if (!location) continue;
      const value = layer.params[name];
      gl!.uniform1f(location, value === undefined ? spec.value : evaluate(value, features, reduced));
    }
    const backdropAt = p.uniforms.get("uBackdrop");
    if (backdropAt && backdrop) {
      gl!.activeTexture(gl!.TEXTURE10);
      gl!.bindTexture(gl!.TEXTURE_2D, backdrop.texture);
      gl!.uniform1i(backdropAt, 10);
    }
    if (!def.feedback) {
      setBlend(layer);
      gl!.drawArrays(gl!.TRIANGLES, 0, 3);
      return;
    }
    let pair = feedback.get(index);
    if (!pair) {
      pair = [createTarget(gl!, width, height), createTarget(gl!, width, height)];
      feedback.set(index, pair);
    }
    const [read, write] = pair;
    const prev = p.uniforms.get("uPrev");
    if (prev) {
      gl!.activeTexture(gl!.TEXTURE9);
      gl!.bindTexture(gl!.TEXTURE_2D, read.texture);
      gl!.uniform1i(prev, 9);
    }
    gl!.disable(gl!.BLEND);
    gl!.bindFramebuffer(gl!.FRAMEBUFFER, write.framebuffer);
    gl!.drawArrays(gl!.TRIANGLES, 0, 3);
    feedback.set(index, [write, read]);
    gl!.bindFramebuffer(gl!.FRAMEBUFFER, scene!.framebuffer);
    gl!.useProgram(copy.program);
    gl!.activeTexture(gl!.TEXTURE0);
    gl!.bindTexture(gl!.TEXTURE_2D, write.texture);
    gl!.uniform1i(copy.uniforms.get("uSource")!, 0);
    setBlend(layer);
    gl!.drawArrays(gl!.TRIANGLES, 0, 3);
  }

  return {
    setTemplate(next, nextAspect) {
      if (template?.id !== next.id || aspect !== nextAspect) {
        for (const [a, b] of feedback.values()) {
          deleteTarget(gl, a);
          deleteTarget(gl, b);
        }
        feedback.clear();
      }
      template = next;
      aspect = nextAspect;
      for (const layer of [next.background, ...next.layers]) program(layer.shader);
    },
    prepare(shader) {
      program(shader);
    },
    setCover(image, nextPalette) {
      gl.bindTexture(gl.TEXTURE_2D, cover);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.SRGB8_ALPHA8, gl.RGBA, gl.UNSIGNED_BYTE, image);
      gl.generateMipmap(gl.TEXTURE_2D);
      palette = { deep: linear(nextPalette.deep), key: linear(nextPalette.key), cool: linear(nextPalette.cool), light: linear(nextPalette.light) };
    },
    setText(source) {
      gl.bindTexture(gl.TEXTURE_2D, text);
      if (!source) {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
        return;
      }
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, source);
      gl.generateMipmap(gl.TEXTURE_2D);
    },
    setImage(source, sourceWidth, sourceHeight) {
      hasImage = source ? 1 : 0;
      if (!source) return;
      imageAspect = sourceWidth / sourceHeight;
      gl.bindTexture(gl.TEXTURE_2D, image);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.SRGB8_ALPHA8, gl.RGBA, gl.UNSIGNED_BYTE, source);
      gl.generateMipmap(gl.TEXTURE_2D);
    },
    step(timeMs, features) {
      frameDelta = advance(timeMs, features);
      frameMs = timeMs;
      frameFeatures = features;
      return { cuts, cutAgeMs: timeMs - cutAtMs, drive, onset: features.onset, level: features.level };
    },
    render(nextSignals, reduced = false) {
      const features = frameFeatures;
      if (!template || !features || gl.isContextLost()) return;
      signals = nextSignals;
      const timeMs = frameMs;
      const delta = frameDelta;
      if (!scene) scene = createTarget(gl, width, height);
      gl.bindVertexArray(quad);
      gl.viewport(0, 0, width, height);
      gl.bindFramebuffer(gl.FRAMEBUFFER, scene.framebuffer);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      [template.background, ...template.layers].forEach((layer, index) => {
        drawLayer(layer, index, timeMs, delta, features, reduced);
        gl.bindFramebuffer(gl.FRAMEBUFFER, scene!.framebuffer);
      });
      gl.disable(gl.BLEND);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.useProgram(finish.program);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, scene.texture);
      gl.uniform1i(finish.uniforms.get("uScene")!, 0);
      gl.uniform1f(finish.uniforms.get("uGrain")!, template.grain);
      gl.uniform1f(finish.uniforms.get("uMono")!, template.mono ?? 0);
      const hit = features.onset * features.onset * Math.min(1, Math.max(0, (features.level - 0.55) / 0.35));
      gl.uniform1f(finish.uniforms.get("uHit")!, (template.impact ?? 0) * hit);
      gl.uniform1f(finish.uniforms.get("uTime")!, timeMs / 1000);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    resize(nextWidth, nextHeight) {
      const w = Math.max(1, Math.round(nextWidth));
      const h = Math.max(1, Math.round(nextHeight));
      if (w === width && h === height) return;
      width = w;
      height = h;
      canvas.width = w;
      canvas.height = h;
      dropTargets();
    },
    reset,
    dispose() {
      dropTargets();
      for (const p of programs.values()) gl.deleteProgram(p.program);
      gl.deleteProgram(finish.program);
      gl.deleteProgram(copy.program);
      for (const texture of [cover, text, bands, wave, history, image, glyphs, ringTexture]) gl.deleteTexture(texture);
      gl.deleteVertexArray(quad);
    },
  };
}
