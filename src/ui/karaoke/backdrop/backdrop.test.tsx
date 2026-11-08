import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { applyWindowVisibility } from "@/data/platform/visibility";
import { Backdrop } from "./Backdrop";
import { FRAME_MS, shouldAnimate, stillBackground } from "./flow";
import { useEffectsStore } from "../../effects";
import type { FlowRenderer } from "./shader";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const gpu = vi.hoisted(() => ({ renderer: null as FlowRenderer | null }));
vi.mock("./shader", () => ({ createFlowRenderer: () => gpu.renderer }));
vi.mock("@/data/covers/colors", () => ({
  colorsFor: vi.fn(async () => ({ color1: "rgb(1, 2, 3)", color2: "rgb(4, 5, 6)" })),
  DEFAULT_COVER_COLORS: { color1: "rgb(24, 26, 32)", color2: "rgb(128, 144, 176)" },
}));

function fakeRenderer() {
  return { setCover: vi.fn(), settle: vi.fn(), draw: vi.fn(), resize: vi.fn(), dispose: vi.fn() };
}

/** Animation frames driven by hand, one per call of step(ms). */
function fakeFrames() {
  let now = 0;
  let next = 1;
  const queue = new Map<number, FrameRequestCallback>();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    queue.set(next, callback);
    return next++;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => queue.delete(id));
  return {
    pending: () => queue.size,
    step(ms: number) {
      now += ms;
      const due = [...queue.values()];
      queue.clear();
      for (const callback of due) callback(now);
    },
  };
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  gpu.renderer = null;
  host = document.createElement("div");
  root = createRoot(host);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  // jsdom never decodes images; the cover counts as loaded at once
  Object.defineProperty(HTMLImageElement.prototype, "decode", { configurable: true, value: () => Promise.resolve() });
});

afterEach(() => {
  act(() => root.unmount());
  applyWindowVisibility(true);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("backdrop rules", () => {
  it("moves only while open, visible and allowed", () => {
    expect(shouldAnimate(true, true, false)).toBe(true);
    expect(shouldAnimate(false, true, false)).toBe(false);
    expect(shouldAnimate(true, false, false)).toBe(false);
    expect(shouldAnimate(true, true, true)).toBe(false);
  });

  it("the still background is a two-colour field", () => {
    const field = stillBackground({ color1: "rgb(1, 2, 3)", color2: "rgb(4, 5, 6)" });
    expect(field).toContain("rgb(1, 2, 3)");
    expect(field).toContain("rgb(4, 5, 6)");
  });
});

describe("Backdrop", () => {
  it("shows the still field when WebGL2 is missing", async () => {
    await act(async () => root.render(<Backdrop cover="c.jpg" open />));
    const still = host.querySelector("[data-still]") as HTMLElement;
    expect(still).not.toBeNull();
    expect(still.style.background).toContain("rgb(4, 5, 6)");
  });

  it("falls back to the still field when the context is lost", async () => {
    gpu.renderer = fakeRenderer();
    fakeFrames();
    await act(async () => root.render(<Backdrop cover="c.jpg" open />));
    expect(host.querySelector("[data-still]")).toBeNull();
    expect(gpu.renderer.setCover).toHaveBeenCalledTimes(1);
    await act(async () => host.querySelector("canvas")!.dispatchEvent(new Event("webglcontextlost", { cancelable: true })));
    expect(host.querySelector("[data-still]")).not.toBeNull();
  });

  it("no cover shows the still field and never draws", async () => {
    gpu.renderer = fakeRenderer();
    const frames = fakeFrames();
    await act(async () => root.render(<Backdrop cover="" open />));
    expect(host.querySelector("[data-still]")).not.toBeNull();
    expect(frames.pending()).toBe(0);
  });

  it("draws at most once per frame budget while it moves", async () => {
    const renderer = fakeRenderer();
    gpu.renderer = renderer;
    const frames = fakeFrames();
    await act(async () => root.render(<Backdrop cover="c.jpg" open />));
    renderer.draw.mockClear();
    // one second of a 120 Hz display
    act(() => {
      for (let i = 0; i < 120; i += 1) frames.step(1000 / 120);
    });
    const drawn = renderer.draw.mock.calls.length;
    expect(drawn).toBeGreaterThanOrEqual(Math.floor(1000 / FRAME_MS) - 2);
    expect(drawn).toBeLessThanOrEqual(Math.ceil(1000 / FRAME_MS));
  });

  it("draws at the chosen frame rate", async () => {
    const renderer = fakeRenderer();
    gpu.renderer = renderer;
    const frames = fakeFrames();
    act(() => useEffectsStore.getState().setFps(30));
    await act(async () => root.render(<Backdrop cover="c.jpg" open />));
    renderer.draw.mockClear();
    act(() => {
      for (let i = 0; i < 120; i += 1) frames.step(1000 / 120);
    });
    expect(renderer.draw.mock.calls.length).toBeGreaterThanOrEqual(28);
    expect(renderer.draw.mock.calls.length).toBeLessThanOrEqual(30);
    act(() => useEffectsStore.getState().setFps(15));
  });

  it("stops asking for frames when closed or when the window hides", async () => {
    const renderer = fakeRenderer();
    gpu.renderer = renderer;
    const frames = fakeFrames();
    await act(async () => root.render(<Backdrop cover="c.jpg" open />));
    expect(frames.pending()).toBe(1);

    act(() => applyWindowVisibility(false));
    expect(frames.pending()).toBe(0);
    renderer.draw.mockClear();
    act(() => frames.step(100));
    expect(renderer.draw).not.toHaveBeenCalled();

    act(() => applyWindowVisibility(true));
    expect(frames.pending()).toBe(1);
    await act(async () => root.render(<Backdrop cover="c.jpg" open={false} />));
    expect(frames.pending()).toBe(0);
  });

  it("reduced motion keeps one still frame of the cover", async () => {
    const renderer = fakeRenderer();
    gpu.renderer = renderer;
    const frames = fakeFrames();
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("reduce"), addEventListener() {}, removeEventListener() {} }));
    await act(async () => root.render(<Backdrop cover="c.jpg" open />));
    expect(renderer.setCover).toHaveBeenCalledTimes(1);
    expect(renderer.draw).toHaveBeenCalled();
    expect(frames.pending()).toBe(0);
    expect(host.querySelector("[data-still]")).toBeNull();
  });

  it("a new cover under reduced motion is shown at once, not faded", async () => {
    const renderer = fakeRenderer();
    gpu.renderer = renderer;
    fakeFrames();
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("reduce"), addEventListener() {}, removeEventListener() {} }));
    await act(async () => root.render(<Backdrop cover="a.jpg" open />));
    await act(async () => root.render(<Backdrop cover="b.jpg" open />));
    expect(renderer.setCover).toHaveBeenCalledTimes(2);
    expect(renderer.setCover.mock.calls[1][1] ?? 0).toBe(0);
  });

  it("a new cover while the window is hidden or closed is shown at once", async () => {
    const renderer = fakeRenderer();
    gpu.renderer = renderer;
    fakeFrames();
    await act(async () => root.render(<Backdrop cover="a.jpg" open />));
    await act(async () => root.render(<Backdrop cover="b.jpg" open={false} />));
    expect(renderer.setCover.mock.calls[1][1] ?? 0).toBe(0);
  });

  it("a new cover while it moves fades in", async () => {
    const renderer = fakeRenderer();
    gpu.renderer = renderer;
    fakeFrames();
    await act(async () => root.render(<Backdrop cover="a.jpg" open />));
    await act(async () => root.render(<Backdrop cover="b.jpg" open />));
    expect(renderer.setCover.mock.calls[1][1]).toBeGreaterThan(0);
  });

  it("stopping mid-fade finishes the fade and draws", async () => {
    const renderer = fakeRenderer();
    gpu.renderer = renderer;
    fakeFrames();
    await act(async () => root.render(<Backdrop cover="a.jpg" open />));
    renderer.draw.mockClear();
    act(() => applyWindowVisibility(false));
    expect(renderer.settle).toHaveBeenCalled();
    expect(renderer.draw).toHaveBeenCalled();
  });

  it("reduced motion read from the media query listener stops the loop", async () => {
    gpu.renderer = fakeRenderer();
    const frames = fakeFrames();
    let listener: (() => void) | undefined;
    let reduced = false;
    vi.stubGlobal("matchMedia", () => ({
      get matches() {
        return reduced;
      },
      addEventListener: (_type: string, callback: () => void) => (listener = callback),
      removeEventListener() {},
    }));
    await act(async () => root.render(<Backdrop cover="c.jpg" open />));
    expect(frames.pending()).toBe(1);
    reduced = true;
    act(() => listener!());
    expect(frames.pending()).toBe(0);
  });

  it("the Reduce effects switch stops the loop too", async () => {
    gpu.renderer = fakeRenderer();
    const frames = fakeFrames();
    await act(async () => root.render(<Backdrop cover="c.jpg" open />));
    expect(frames.pending()).toBe(1);
    act(() => useEffectsStore.getState().setReduce(true));
    expect(frames.pending()).toBe(0);
    act(() => useEffectsStore.getState().setReduce(false));
  });

  it("a cover the canvas cannot take (tainted) shows the still field in the cover's colours", async () => {
    const renderer = fakeRenderer();
    renderer.setCover.mockReturnValue(false);
    gpu.renderer = renderer;
    fakeFrames();
    await act(async () => root.render(<Backdrop cover="c.jpg" open />));
    const still = host.querySelector("[data-still]") as HTMLElement;
    expect(still).not.toBeNull();
    expect(still.style.background).toContain("rgb(4, 5, 6)");
  });

  it("a restored context brings the moving field back with the cover redrawn", async () => {
    const renderer = fakeRenderer();
    gpu.renderer = renderer;
    fakeFrames();
    await act(async () => root.render(<Backdrop cover="c.jpg" open />));
    const canvas = host.querySelector("canvas")!;
    await act(async () => canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true })));
    expect(host.querySelector("[data-still]")).not.toBeNull();
    await act(async () => canvas.dispatchEvent(new Event("webglcontextrestored")));
    expect(host.querySelector("[data-still]")).toBeNull();
    expect(renderer.setCover).toHaveBeenCalledTimes(2);
    expect(renderer.draw).toHaveBeenCalled();
  });
});
