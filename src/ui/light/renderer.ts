import type { LightObject } from "./objects";
import { AT, type LightState, type View } from "./scene";
import { FRAGMENT, MAX_OBJECTS, VERTEX } from "./shader";
import type { Vec3 } from "./readLight";

export interface Frame {
  state: LightState;
  view: View;
  scale: number;
  base: Vec3;
  dark: boolean;
  foot: readonly [number, number];
  objects: readonly LightObject[];
}

export interface Renderer {
  readonly slow: boolean;
  draw(frame: Frame): ImageBitmap | null;
}

const SETTERS = { 1: "uniform1fv", 2: "uniform2fv", 3: "uniform3fv", 4: "uniform4fv" } as const;
const CONTEXT: WebGLContextAttributes = { antialias: false, alpha: false, depth: false, powerPreference: "low-power" };

function build(gl: WebGL2RenderingContext): WebGLProgram | null {
  const program = gl.createProgram();
  for (const [type, source] of [
    [gl.VERTEX_SHADER, VERTEX],
    [gl.FRAGMENT_SHADER, FRAGMENT],
  ] as const) {
    const shader = gl.createShader(type);
    if (!program || !shader) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    gl.attachShader(program, shader);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
  gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, "position");
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
  return program;
}

function create(onRestored: () => void): Renderer | null {
  if (typeof OffscreenCanvas === "undefined") return null;
  const canvas = new OffscreenCanvas(1, 1);
  const fast = canvas.getContext("webgl2", { ...CONTEXT, failIfMajorPerformanceCaveat: true });
  const gl = fast ?? canvas.getContext("webgl2", CONTEXT);
  if (!gl) return null;
  let program = build(gl);
  if (!program) return null;
  const places = new Map<string, WebGLUniformLocation | null>();
  const boxes = new Float32Array(MAX_OBJECTS * 4);
  const bodies = new Float32Array(MAX_OBJECTS * 2);

  const at = (name: string) => {
    if (!places.has(name)) places.set(name, gl.getUniformLocation(program!, name));
    return places.get(name)!;
  };
  canvas.addEventListener("webglcontextlost", (event) => {
    event.preventDefault();
    program = null;
  });
  canvas.addEventListener("webglcontextrestored", () => {
    places.clear();
    program = build(gl);
    onRestored();
  });

  return {
    slow: fast === null,
    draw({ state, view, scale, base, dark, foot, objects }) {
      const width = Math.round(view.width * scale);
      const height = Math.round(view.height * scale);
      if (!program || width < 1 || height < 1) return null;
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
      gl.viewport(0, 0, width, height);
      for (const [name, [start, length]] of Object.entries(AT)) {
        const part = state.subarray(start, start + length);
        if (name === "cells") gl.uniform3fv(at(name), part);
        else gl[SETTERS[length as keyof typeof SETTERS]](at(name), part);
      }
      const shown = objects.slice(0, MAX_OBJECTS);
      shown.forEach((object, i) => {
        boxes.set([object.x + object.width / 2, object.y + object.height / 2, object.width / 2, object.height / 2], i * 4);
        bodies.set([object.radius, object.lift], i * 2);
      });
      gl.uniform1i(at("count"), shown.length);
      gl.uniform4fv(at("box"), boxes);
      gl.uniform2fv(at("body"), bodies);
      gl.uniform2f(at("size"), view.width, height / scale);
      gl.uniform1f(at("scale"), scale);
      gl.uniform3f(at("base"), base[0], base[1], base[2]);
      gl.uniform1f(at("dark"), dark ? 1 : 0);
      gl.uniform2f(at("foot"), foot[0], foot[1]);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      return canvas.transferToImageBitmap();
    },
  };
}

let shared: Renderer | null | undefined;
const restored = new Set<() => void>();

export function sharedRenderer(): Renderer | null {
  if (shared === undefined) shared = create(() => restored.forEach((redraw) => redraw()));
  return shared;
}

export function onRendererRestored(redraw: () => void): () => void {
  restored.add(redraw);
  return () => restored.delete(redraw);
}
