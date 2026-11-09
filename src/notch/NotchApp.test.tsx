import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import NotchApp from "./NotchApp";
import { DEFAULT_NOTCH_SETTINGS, type NotchHello, type NotchLyrics, type NotchSettings, type NotchState } from "./contracts";
import { ISLAND_SIZES, grownRect, islandPath, islandRect } from "./lib/geometry";
import { MORPH_SPRING, simulateSpring, springEasing } from "./lib/spring";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const MORPH_MS = springEasing(MORPH_SPRING).durationMs;
const OVERSHOOT = Math.max(...simulateSpring(MORPH_SPRING).values) - 1;

function makeState(overrides: Partial<NotchState> = {}): NotchState {
  return {
    track: {
      id: "t1",
      title: "Midnight City",
      artist: "M83",
      coverUrl: "https://example.com/cover.jpg",
      durationMs: 240_000,
    },
    status: "playing",
    positionMs: 1_000,
    sampledAt: Date.now(),
    liked: false,
    upNext: [],
    ...overrides,
  };
}

interface Harness {
  api: {
    notchHello: ReturnType<typeof vi.fn>;
    notchAction: ReturnType<typeof vi.fn>;
    notchSetShape: ReturnType<typeof vi.fn>;
    notchSetCapture: ReturnType<typeof vi.fn>;
  };
  pushState: (state: NotchState) => void;
  pushLyrics: (lyrics: NotchLyrics) => void;
  pushSettings: (settings: NotchSettings) => void;
}

function installApi(hello: NotchHello): Harness {
  const stateListeners: Array<(state: NotchState) => void> = [];
  const lyricsListeners: Array<(lyrics: NotchLyrics) => void> = [];
  const settingsListeners: Array<(settings: NotchSettings) => void> = [];
  const subscribe =
    <T,>(list: Array<(value: T) => void>) =>
    (cb: (value: T) => void) => {
      list.push(cb);
      return () => list.splice(list.indexOf(cb), 1);
    };
  const api = {
    notchHello: vi.fn(async () => hello),
    onNotchState: subscribe(stateListeners),
    onNotchLyrics: subscribe(lyricsListeners),
    onNotchSettings: subscribe(settingsListeners),
    notchAction: vi.fn(),
    notchSetShape: vi.fn(),
    notchSetCapture: vi.fn(),
  };
  (window as unknown as { nuvoElectron: unknown }).nuvoElectron = api;
  return {
    api,
    pushState: (state) => act(() => stateListeners.forEach((cb) => cb(state))),
    pushLyrics: (lyrics) => act(() => lyricsListeners.forEach((cb) => cb(lyrics))),
    pushSettings: (settings) => act(() => settingsListeners.forEach((cb) => cb(settings))),
  };
}

let host: HTMLElement;
let root: Root;

async function mount() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root.render(<NotchApp />);
  });
  await act(async () => {
    await Promise.resolve();
  });
}

const island = () => host.querySelector<HTMLElement>("[data-mode]")!;
const mode = () => island().dataset.mode;
const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms));
const enter = () => act(() => island().dispatchEvent(new MouseEvent("mouseover", { bubbles: true })));
const leave = () => act(() => island().dispatchEvent(new MouseEvent("mouseout", { bubbles: true })));
const click = (el: Element) => act(() => el.dispatchEvent(new MouseEvent("click", { bubbles: true })));
const button = (label: string) => host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;

async function expand(harness: Harness, state = makeState()) {
  harness.pushState(state);
  click(island());
  expect(mode()).toBe("expanded");
}

describe("NotchApp", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    delete (window as unknown as Record<string, unknown>).nuvoElectron;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("stays idle until a state with a track arrives", async () => {
    const harness = installApi({ state: null, lyrics: null, settings: DEFAULT_NOTCH_SETTINGS });
    await mount();
    expect(harness.api.notchHello).toHaveBeenCalledTimes(1);
    expect(mode()).toBe("idle");
    harness.pushState(makeState({ track: null, status: "idle" }));
    expect(mode()).toBe("idle");
    harness.pushState(makeState());
    expect(mode()).toBe("live");
  });

  it("uses the state from hello", async () => {
    installApi({ state: makeState(), lyrics: null, settings: DEFAULT_NOTCH_SETTINGS });
    await mount();
    expect(mode()).toBe("live");
  });

  it("draws the silhouette for the current mode", async () => {
    const harness = installApi({ state: null, lyrics: null, settings: DEFAULT_NOTCH_SETTINGS });
    await mount();
    const path = () => host.querySelector("svg path")!.getAttribute("d");
    expect(path()).toBe(islandPath(ISLAND_SIZES.idle));
    harness.pushState(makeState());
    expect(path()).toBe(islandPath(ISLAND_SIZES.live));
    enter();
    expect(path()).toBe(islandPath(ISLAND_SIZES.hover));
  });

  it("hover, dwell expands, leaving collapses", async () => {
    const harness = installApi({ state: null, lyrics: null, settings: DEFAULT_NOTCH_SETTINGS });
    await mount();
    harness.pushState(makeState());
    enter();
    expect(mode()).toBe("hover");
    advance(350);
    expect(mode()).toBe("expanded");
    leave();
    advance(200);
    expect(mode()).toBe("live");
  });

  it("transport, title and like send actions", async () => {
    const harness = installApi({ state: null, lyrics: null, settings: DEFAULT_NOTCH_SETTINGS });
    await mount();
    await expand(harness);
    click(button("Pause"));
    click(button("Next track"));
    click(button("Previous track"));
    click(button("Like"));
    click(host.querySelector(".expanded .now-title")!);
    expect(harness.api.notchAction.mock.calls.map(([action]) => action)).toEqual([
      { type: "togglePlay" },
      { type: "next" },
      { type: "prev" },
      { type: "like" },
      { type: "focusApp" },
    ]);
    expect(mode()).toBe("expanded");
  });

  it("shows Play while paused", async () => {
    const harness = installApi({ state: null, lyrics: null, settings: DEFAULT_NOTCH_SETTINGS });
    await mount();
    await expand(harness, makeState({ status: "paused" }));
    expect(button("Play")).not.toBeNull();
    expect(button("Pause")).toBeNull();
  });

  it("grows the input shape at once with room for the overshoot, shrinks it after the morph", async () => {
    const harness = installApi({ state: null, lyrics: null, settings: DEFAULT_NOTCH_SETTINGS });
    await mount();
    harness.pushState(makeState());
    const shape = harness.api.notchSetShape;
    expect(shape).toHaveBeenLastCalledWith(grownRect(ISLAND_SIZES.idle, ISLAND_SIZES.live, OVERSHOOT));
    advance(MORPH_MS);
    expect(shape).toHaveBeenLastCalledWith(islandRect(ISLAND_SIZES.live));
    click(island());
    const padded = grownRect(ISLAND_SIZES.live, ISLAND_SIZES.expanded, OVERSHOOT);
    expect(shape).toHaveBeenLastCalledWith(padded);
    expect(padded.height).toBeGreaterThan(islandRect(ISLAND_SIZES.expanded).height + 9);
    advance(MORPH_MS);
    expect(shape).toHaveBeenLastCalledWith(islandRect(ISLAND_SIZES.expanded));
    enter();
    leave();
    advance(200);
    expect(mode()).toBe("live");
    advance(MORPH_MS - 1);
    expect(shape).toHaveBeenLastCalledWith(islandRect(ISLAND_SIZES.expanded));
    advance(1);
    expect(shape).toHaveBeenLastCalledWith(islandRect(ISLAND_SIZES.live));
  });

  it("takes the mouse only over the pill and gives it back past the slop or when the pill shrinks", async () => {
    const harness = installApi({ state: null, lyrics: null, settings: DEFAULT_NOTCH_SETTINGS });
    await mount();
    const capture = harness.api.notchSetCapture;
    const move = (x: number, y: number, buttons = 0) => act(() => window.dispatchEvent(new MouseEvent("mousemove", { clientX: x, clientY: y, buttons })));
    const idle = islandRect(ISLAND_SIZES.idle);
    move(5, 150);
    expect(capture).not.toHaveBeenCalled();
    move(idle.x + 10, 10);
    expect(capture).toHaveBeenLastCalledWith(true);
    move(idle.x - 3, 10);
    expect(capture).toHaveBeenCalledTimes(1);
    move(idle.x - 20, 10);
    expect(capture).toHaveBeenLastCalledWith(false);

    click(island());
    expect(mode()).toBe("idle");
    harness.pushState(makeState());
    click(island());
    expect(mode()).toBe("expanded");
    const expanded = islandRect(ISLAND_SIZES.expanded);
    move(expanded.x + 10, 150);
    expect(capture).toHaveBeenLastCalledWith(true);
    act(() => document.documentElement.dispatchEvent(new MouseEvent("mouseleave")));
    expect(capture).toHaveBeenLastCalledWith(false);
    move(expanded.x + 10, 150);
    expect(capture).toHaveBeenLastCalledWith(true);
    enter();
    leave();
    advance(200);
    expect(mode()).toBe("live");
    expect(capture).toHaveBeenLastCalledWith(true);
    advance(MORPH_MS);
    expect(capture).toHaveBeenLastCalledWith(false);
  });

  it("an interrupted grow still tightens to the exact rect after the morph", async () => {
    const harness = installApi({ state: null, lyrics: null, settings: DEFAULT_NOTCH_SETTINGS });
    await mount();
    harness.pushState(makeState());
    advance(MORPH_MS);
    const shape = harness.api.notchSetShape;
    click(island());
    expect(shape).toHaveBeenLastCalledWith(grownRect(ISLAND_SIZES.live, ISLAND_SIZES.expanded, OVERSHOOT));
    enter();
    leave();
    advance(200);
    expect(mode()).toBe("live");
    click(island());
    expect(mode()).toBe("expanded");
    advance(MORPH_MS);
    expect(shape).toHaveBeenLastCalledWith(islandRect(ISLAND_SIZES.expanded));
  });

  it("switches the lyric line on time with one timer", async () => {
    const harness = installApi({ state: null, lyrics: null, settings: DEFAULT_NOTCH_SETTINGS });
    await mount();
    harness.pushLyrics({
      trackId: "t1",
      lines: [
        { timeMs: 0, text: "a" },
        { timeMs: 1000, text: "b" },
      ],
    });
    await expand(harness, makeState({ positionMs: 900, sampledAt: Date.now() }));
    const current = () => host.querySelector(".lyric-strip .lyric-current")?.textContent;
    expect(current()).toBe("a");
    advance(100);
    expect(current()).toBe("b");
  });

  it("ignores lyrics for another track and hides the strip when disabled", async () => {
    const harness = installApi({ state: null, lyrics: null, settings: DEFAULT_NOTCH_SETTINGS });
    await mount();
    harness.pushLyrics({ trackId: "other", lines: [{ timeMs: 0, text: "x" }] });
    await expand(harness);
    expect(host.querySelector(".lyric-strip")).toBeNull();
    harness.pushLyrics({ trackId: "t1", lines: [{ timeMs: 0, text: "x" }] });
    expect(host.querySelector(".lyric-strip")).not.toBeNull();
    harness.pushSettings({ ...DEFAULT_NOTCH_SETTINGS, showLyrics: false });
    expect(host.querySelector(".lyric-strip")).toBeNull();
  });

  it("runs requestAnimationFrame only while expanded and playing", async () => {
    const raf = vi.spyOn(window, "requestAnimationFrame");
    const harness = installApi({ state: null, lyrics: null, settings: DEFAULT_NOTCH_SETTINGS });
    await mount();
    harness.pushState(makeState());
    advance(1000);
    expect(raf).not.toHaveBeenCalled();
    await expand(harness, makeState({ status: "paused" }));
    advance(1000);
    expect(raf).not.toHaveBeenCalled();
    harness.pushState(makeState({ status: "playing" }));
    advance(100);
    expect(raf).toHaveBeenCalled();
    leave();
    advance(200);
    expect(mode()).toBe("live");
    raf.mockClear();
    advance(1000);
    expect(raf).not.toHaveBeenCalled();
  });

  it("renders the marquee only in hover mode", async () => {
    const harness = installApi({ state: null, lyrics: null, settings: DEFAULT_NOTCH_SETTINGS });
    await mount();
    const title = "x".repeat(200);
    harness.pushState(makeState({ track: { ...makeState().track!, title } }));
    expect(host.querySelector(".marquee")).toBeNull();
    enter();
    expect(host.querySelector(".marquee")?.textContent).toContain(title);
    advance(350);
    expect(host.querySelector(".marquee")).toBeNull();
  });

  it("a cover that fails to load shows the placeholder", async () => {
    const harness = installApi({ state: null, lyrics: null, settings: DEFAULT_NOTCH_SETTINGS });
    await mount();
    harness.pushState(makeState());
    expect(host.querySelector(".cover-placeholder")).toBeNull();
    const img = host.querySelector("img")!;
    expect(img.crossOrigin).toBe("anonymous");
    act(() => img.dispatchEvent(new Event("error")));
    expect(host.querySelector(".cover-placeholder")).not.toBeNull();
  });

  it("vertical wheel changes the volume, horizontal wheel switches views", async () => {
    const harness = installApi({ state: null, lyrics: null, settings: DEFAULT_NOTCH_SETTINGS });
    await mount();
    await expand(harness);
    act(() => island().dispatchEvent(new WheelEvent("wheel", { deltaY: -100, bubbles: true })));
    expect(harness.api.notchAction).toHaveBeenLastCalledWith({ type: "volumeDelta", delta: 0.05 });
    expect(host.querySelector(".volume")).not.toBeNull();
    advance(1500);
    expect(host.querySelector(".volume")).toBeNull();
    const view = () => host.querySelector<HTMLElement>(".expanded")!.dataset.view;
    expect(view()).toBe("now");
    act(() => island().dispatchEvent(new WheelEvent("wheel", { deltaX: 60, bubbles: true })));
    expect(view()).toBe("lyrics");
    click(button("Up next"));
    expect(view()).toBe("upNext");
  });

  it("an up-next row plays that track", async () => {
    const harness = installApi({ state: null, lyrics: null, settings: DEFAULT_NOTCH_SETTINGS });
    await mount();
    const upNext = [{ id: "u1", title: "Wait", artist: "M83", coverUrl: null, durationMs: 1 }];
    await expand(harness, makeState({ upNext }));
    click(button("Up next"));
    click(host.querySelector(".up-next-row")!);
    expect(harness.api.notchAction).toHaveBeenLastCalledWith({ type: "playUpNext", trackId: "u1" });
  });

  it("scrubbing holds the island open and seeks on release", async () => {
    const harness = installApi({ state: null, lyrics: null, settings: DEFAULT_NOTCH_SETTINGS });
    await mount();
    await expand(harness);
    const track = host.querySelector<HTMLElement>(".scrubber-track")!;
    track.getBoundingClientRect = () => ({ left: 100, width: 200, top: 0, height: 4 }) as DOMRect;
    track.setPointerCapture = () => {};
    const pointer = (type: string, clientX: number) => act(() => track.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX })));
    pointer("pointerdown", 150);
    leave();
    advance(1000);
    expect(mode()).toBe("expanded");
    pointer("pointermove", 200);
    pointer("pointerup", 200);
    expect(harness.api.notchAction).toHaveBeenLastCalledWith({ type: "seek", positionMs: 120_000 });
    expect(mode()).toBe("live");
  });
});
