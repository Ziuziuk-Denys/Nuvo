import type { Placement, Ring } from "./ring";
import { FLOOR_FRAGMENT, FRAGMENT, VERTEX } from "./roomShader";

const CORNERS = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
const SLAB_LAYERS = 4;
const SLAB_DEPTH = 7;
const RADIUS = 8;
const FADE_MS = 260;
const FAR_BLUR = 5;

export interface RoomCard {
  slot: number;
  offset: number;
  spot: Placement;
}

export interface RoomView {
  ring: Ring;
  floor: number;
  cards: RoomCard[];
  lean: number;
  tilt: { x: number; y: number; amount: number };
  light: boolean;
}

export interface Room {
  resize(width: number, height: number, ratio: number): void;
  load(slot: number, url: string): void;
  settled(slot: number): boolean;
  draw(view: RoomView, now: number): boolean;
  dispose(): void;
}

interface Art {
  url: string;
  texture: WebGLTexture;
  since: number;
}

type Uniforms = Record<string, WebGLUniformLocation | null>;

function program(gl: WebGL2RenderingContext, vertex: string, fragment: string): { id: WebGLProgram; at: Uniforms } | null {
  const id = gl.createProgram();
  for (const [type, source] of [
    [gl.VERTEX_SHADER, vertex],
    [gl.FRAGMENT_SHADER, fragment],
  ] as const) {
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    gl.attachShader(id, shader);
    gl.deleteShader(shader);
  }
  gl.bindAttribLocation(id, 0, "corner");
  gl.linkProgram(id);
  if (!gl.getProgramParameter(id, gl.LINK_STATUS)) return null;
  const at: Uniforms = {};
  const count = gl.getProgramParameter(id, gl.ACTIVE_UNIFORMS) as number;
  for (let index = 0; index < count; index += 1) {
    const { name } = gl.getActiveUniform(id, index)!;
    at[name] = gl.getUniformLocation(id, name);
  }
  return { id, at };
}

export function createRoom(canvas: HTMLCanvasElement, changed: () => void): Room | null {
  const gl = canvas.getContext("webgl2", { alpha: true, antialias: false, depth: false, premultipliedAlpha: true, failIfMajorPerformanceCaveat: true });
  if (!gl) return null;
  const cards = program(gl, VERTEX, FRAGMENT);
  const floors = program(gl, VERTEX, FLOOR_FRAGMENT);
  if (!cards || !floors) return null;

  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, CORNERS, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

  const sharper = gl.getExtension("EXT_texture_filter_anisotropic");
  const arts = new Map<number, Art>();
  const blank = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, blank);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([22, 22, 24, 255]));
  let disposed = false;
  let width = 0;
  let height = 0;
  let ratio = 1;

  const upload = (slot: number, url: string, image: HTMLImageElement) => {
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, image);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (sharper) gl.texParameterf(gl.TEXTURE_2D, sharper.TEXTURE_MAX_ANISOTROPY_EXT, 8);
    const old = arts.get(slot);
    if (old) gl.deleteTexture(old.texture);
    arts.set(slot, { url, texture, since: performance.now() });
  };

  const wanted = new Map<number, string>();
  const missing = new Set<number>();
  const load = (slot: number, url: string) => {
    if (wanted.get(slot) === url) return;
    wanted.set(slot, url);
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.src = url;
    void image.decode().then(
      () => {
        if (disposed || gl.isContextLost() || wanted.get(slot) !== url) return;
        upload(slot, url, image);
        changed();
      },
      () => {
        if (wanted.get(slot) !== url) return;
        missing.add(slot);
        changed();
      },
    );
  };

  const place = (at: Uniforms, view: RoomView, spot: Placement, size: number, turnDeg: number, back: number, flat: number) => {
    const { ring } = view;
    const turn = (turnDeg * Math.PI) / 180;
    gl.uniform2f(at.view, width, height);
    gl.uniform2f(at.at, spot.x, spot.y);
    gl.uniform4f(at.spin, Math.cos(spot.tilt), Math.sin(spot.tilt), Math.cos(turn), Math.sin(turn));
    gl.uniform1f(at.cover, size);
    gl.uniform1f(at.scale, spot.scale);
    gl.uniform1f(at.back, back);
    gl.uniform2f(at.spread, 1, flat);
    gl.uniform2f(at.floorLine, ring.vanishY, view.floor);
  };

  const draw = (view: RoomView, now: number): boolean => {
    let fading = false;
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const order = [...view.cards].sort((left, right) => Math.abs(right.offset) - Math.abs(left.offset));
    const bind = (card: RoomCard): number => {
      const art = arts.get(card.slot);
      gl.bindTexture(gl.TEXTURE_2D, art?.texture ?? blank);
      const shown = art ? Math.min(1, (now - art.since) / FADE_MS) : 0;
      if (art && shown < 1) fading = true;
      return shown;
    };

    gl.useProgram(floors.id);
    gl.uniform1f(floors.at.bright, view.light ? 1 : 0);
    gl.uniform1f(floors.at.mirrored, 0);
    for (const card of order) {
      const base = view.ring.vanishY + (view.floor - view.ring.vanishY) * card.spot.scale;
      const reach = card.spot.scale * view.ring.cover;
      const lit = Math.max(0, 1 - Math.abs(card.offset) / 3.2);
      const lifted = Math.max(0, base - (card.spot.y + reach / 2)) / reach;
      gl.uniform1f(floors.at.ready, bind(card));
      place(floors.at, view, { ...card.spot, y: base, tilt: 0 }, view.ring.cover * 2.1, 0, 0, 0.34);
      gl.uniform2f(floors.at.pool, lit * lit * 0.5, (view.light ? 0.34 : 0.55) * Math.exp(-lifted * 5));
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    gl.useProgram(cards.id);
    gl.uniform1f(cards.at.ratio, ratio);
    gl.uniform1f(cards.at.radius, RADIUS);
    gl.uniform1f(cards.at.bright, view.light ? 1 : 0);
    gl.uniform1f(cards.at.mirrorGain, view.light ? 0.34 : 0.5);
    for (const mirrored of [1, 0]) {
      gl.uniform1f(cards.at.mirrored, mirrored);
      for (const card of order) {
        const far = Math.min(1, Math.max(0, Math.abs(card.offset) - 0.6) / 4.4);
        const centre = Math.max(0, 1 - Math.abs(card.offset));
        const turn = card.spot.turn + view.lean + view.tilt.x * view.tilt.amount * centre;
        gl.uniform1f(cards.at.ready, bind(card));
        gl.uniform1f(cards.at.shown, card.spot.shown);
        gl.uniform1f(cards.at.blur, far * FAR_BLUR);
        gl.uniform1f(cards.at.dim, 1 - far * (view.light ? 0.1 : 0.5));
        gl.uniform2f(cards.at.lamp, card.offset > 0 ? -0.55 : card.offset < 0 ? 0.55 : 0, -0.83);
        gl.uniform3f(cards.at.sweep, view.tilt.y * 0.5, 0, view.tilt.amount * centre);
        if (!mirrored) {
          gl.uniform1f(cards.at.slab, 1);
          for (let layer = SLAB_LAYERS; layer > 0; layer -= 1) {
            place(cards.at, view, card.spot, view.ring.cover, turn, (layer / SLAB_LAYERS) * SLAB_DEPTH, 1);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
          }
        }
        gl.uniform1f(cards.at.slab, 0);
        place(cards.at, view, card.spot, view.ring.cover, turn, 0, 1);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }
    }
    return fading;
  };

  return {
    resize(nextWidth, nextHeight, nextRatio) {
      width = nextWidth;
      height = nextHeight;
      ratio = nextRatio;
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
    },
    load,
    settled: (slot) => arts.has(slot) || missing.has(slot),
    draw,
    dispose() {
      disposed = true;
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}
