import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import NotchApp from "./NotchApp";
import {
  DEFAULT_NOTCH_SETTINGS,
  type Cutout,
  type NotchHello,
  type NotchLyrics,
  type NotchPlaylists,
  type NotchPresence,
  type NotchSettings,
  type NotchState,
} from "./contracts";
import { ISLAND_SIZES, grownRect, islandPath, islandRect, islandSizes, pageSize } from "./lib/geometry";
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
  pushPlaylists: (playlists: NotchPlaylists) => void;
  pushSettings: (settings: NotchSettings) => void;
  pushCutout: (cutout: Cutout | null) => void;
  pushPresence: (presence: NotchPresence) => void;
}

function installApi(partial: Omit<NotchHello, "cutout" | "presence" | "playlists"> & { cutout?: Cutout | null; presence?: NotchPresence }): Harness {
  const hello: NotchHello = { cutout: null, presence: "in", playlists: null, ...partial };
  const playlistListeners: Array<(playlists: NotchPlaylists) => void> = [];
  const presenceListeners: Array<(presence: NotchPresence) => void> = [];
  const cutoutListeners: Array<(cutout: Cutout | null) => void> = [];
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
    onNotchPlaylists: subscribe(playlistListeners),
    onNotchSettings: subscribe(settingsListeners),
    onNotchCutout: subscribe(cutoutListeners),
    onNotchPresence: subscribe(presenceListeners),
    notchAction: vi.fn(),
    notchSetShape: vi.fn(),
    notchSetCapture: vi.fn(),
  };
  (window as unknown as { nuvoElectron: unknown }).nuvoElectron = api;
  return {
    api,
    pushState: (state) => act(() => stateListeners.forEach((cb) => cb(state))),
    pushLyrics: (lyrics) => act(() => lyricsListeners.forEach((cb) => cb(lyrics))),
    pushPlaylists: (playlists) => act(() => playlistListeners.forEach((cb) => cb(playlists))),
    pushSettings: (settings) => act(() => settingsListeners.forEach((cb) => cb(settings))),
    pushCutout: (cutout) => act(() => cutoutListeners.forEach((cb) => cb(cutout))),
    pushPresence: (presence) => act(() => presenceListeners.forEach((cb) => cb(presence))),
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

  it("enters and leaves as the app says, starting from hello", async () => {
    const harness = installApi({ state: null, lyrics: null, settings: DEFAULT_NOTCH_SETTINGS, presence: "out" });
    await mount();
    const presence = () => host.querySelector(".notch-stage")!.getAttribute("data-presence");
    expect(presence()).toBe("out");
    harness.pushPresence("in");
    expect(presence()).toBe("in");
    harness.pushPresence("out");
    expect(presence()).toBe("out");
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

  it("on a notched MacBook wraps the camera: wider and taller, nothing drawn under it", async () => {
    const cutout = { width: 200, height: 38 };
    const harness = installApi({ state: null, lyrics: null, settings: DEFAULT_NOTCH_SETTINGS, cutout });
    await mount();
    const sizes = islandSizes(cutout);
    const path = () => host.querySelector("svg path")!.getAttribute("d");
    expect(path()).toBe(islandPath(sizes.idle));
    expect(host.querySelector(".island")!.hasAttribute("data-cutout")).toBe(true);
    harness.pushState(makeState());
    expect(path()).toBe(islandPath(sizes.live));
    enter();
    expect(path()).toBe(islandPath(sizes.hover));
    expect(host.querySelector(".compact-title")).toBeNull();
    harness.pushCutout(null);
    expect(path()).toBe(islandPath(ISLAND_SIZES.hover));
    expect(host.querySelector(".compact-title")).not.toBeNull();
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
    click(button("Next"));
    click(button("Previous"));
    click(button("Like"));
    click(button("Dislike"));
    click(host.querySelector(".expanded .now-title")!);
    expect(harness.api.notchAction.mock.calls.map(([action]) => action)).toEqual([
      { type: "togglePlay" },
      { type: "next" },
      { type: "prev" },
      { type: "like" },
      { type: "dislike" },
      { type: "focusApp" },
    ]);
    expect(mode()).toBe("expanded");
  });

  it("shows a like and a pause at once, and the app has the last word", async () => {
    const harness = installApi({ state: null, lyrics: null, settings: DEFAULT_NOTCH_SETTINGS });
    await mount();
    await expand(harness);
    click(button("Like"));
    expect(button("Like").getAttribute("aria-pressed")).toBe("true");
    click(button("Pause"));
    expect(button("Play")).not.toBeNull();
    harness.pushState(makeState());
    expect(button("Like").getAttribute("aria-pressed")).toBe("false");
    expect(button("Pause")).not.toBeNull();
  });

  it("shows Play while paused", async () => {
    const harness = installApi({ state: null, lyrics: null, settings: DEFAULT_NOTCH_SETTINGS });
    await mount();
    await expand(harness, makeState({ status: "paused" }));
    expect(button("Play")).not.toBeNull();
    expect(button("Pause")).toBeNull();
    harness.pushState(makeState({ status: "loading" }));
    expect(button("Pause")).not.toBeNull();
  });

  it("grows the input shape at once, shrinks it after the morph", async () => {
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
    move(expanded.x + 10, 120);
    expect(capture).toHaveBeenLastCalledWith(true);
    act(() => document.documentElement.dispatchEvent(new MouseEvent("mouseleave")));
    expect(capture).toHaveBeenLastCalledWith(false);
    move(expanded.x + 10, 120);
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

  const view = () => host.querySelector<HTMLElement>(".expanded")!.dataset.view;
  const cover = () => host.querySelector<HTMLButtonElement>(".deck-cover")!;
  const sheets = () => host.querySelectorAll('.sheet[data-on="true"]').length;
  const flip = (deltaX: number) => {
    act(() => island().dispatchEvent(new WheelEvent("wheel", { deltaX, bubbles: true })));
    advance(300);
  };
  const LYRICS: NotchLyrics = {
    trackId: "t1",
    lines: [
      { timeMs: 0, text: "a" },
      { timeMs: 1000, text: "b" },
    ],
  };
  const UP_NEXT = [{ id: "u1", title: "Wait", artist: "M83", coverUrl: null, durationMs: 1 }];

  it("switches the lyric line on time with one timer", async () => {
    const harness = installApi({ state: null, lyrics: null, settings: DEFAULT_NOTCH_SETTINGS });
    await mount();
    harness.pushLyrics(LYRICS);
    await expand(harness, makeState({ positionMs: 900, sampledAt: Date.now() }));
    click(cover());
    const current = () => host.querySelector('.lyrics-line[data-current="true"]')?.textContent;
    expect(current()).toBe("a");
    advance(100);
    expect(current()).toBe("b");
  });

  it("the cover opens the next page, then leads back, and names both", async () => {
    const harness = installApi({ state: null, lyrics: null, settings: DEFAULT_NOTCH_SETTINGS });
    await mount();
    harness.pushLyrics(LYRICS);
    await expand(harness, makeState({ upNext: UP_NEXT }));
    expect(sheets()).toBe(2);
    expect(cover().getAttribute("aria-label")).toBe("Show Lyrics");
    click(cover());
    expect(view()).toBe("lyrics");
    expect(sheets()).toBe(1);
    expect(cover().getAttribute("aria-label")).toBe("Back to the song");
    click(host.querySelector(".deck-next")!);
    expect(view()).toBe("upNext");
    expect(sheets()).toBe(0);
    expect(host.querySelector(".deck-next")).toBeNull();
    click(cover());
    expect(view()).toBe("now");
    expect(harness.api.notchAction).not.toHaveBeenCalled();
  });

  it("skips pages with nothing behind them", async () => {
    const harness = installApi({ state: null, lyrics: null, settings: DEFAULT_NOTCH_SETTINGS });
    await mount();
    harness.pushLyrics({ ...LYRICS, trackId: "other" });
    await expand(harness);
    expect(sheets()).toBe(0);
    flip(60);
    expect(view()).toBe("now");
    click(cover());
    expect(harness.api.notchAction).toHaveBeenLastCalledWith({ type: "focusApp" });

    harness.pushState(makeState({ upNext: UP_NEXT }));
    expect(sheets()).toBe(1);
    flip(60);
    expect(view()).toBe("upNext");

    flip(-60);
    harness.pushLyrics(LYRICS);
    flip(60);
    expect(view()).toBe("lyrics");
    harness.pushSettings({ ...DEFAULT_NOTCH_SETTINGS, showLyrics: false });
    expect(view()).toBe("now");
  });

  it("each page has its own height and the input shape follows it", async () => {
    const harness = installApi({ state: null, lyrics: null, settings: DEFAULT_NOTCH_SETTINGS });
    await mount();
    harness.pushLyrics(LYRICS);
    await expand(harness);
    advance(MORPH_MS);
    const path = () => host.querySelector("svg path")!.getAttribute("d");
    click(cover());
    const lyrics = pageSize(ISLAND_SIZES.expanded, "lyrics");
    expect(path()).toBe(islandPath(lyrics));
    expect(harness.api.notchSetShape).toHaveBeenLastCalledWith(grownRect(ISLAND_SIZES.expanded, lyrics, OVERSHOOT));
    advance(MORPH_MS);
    expect(harness.api.notchSetShape).toHaveBeenLastCalledWith(islandRect(lyrics));
  });

  it("waits for a pointer that a shrinking page left outside", async () => {
    const harness = installApi({ state: null, lyrics: null, settings: DEFAULT_NOTCH_SETTINGS });
    await mount();
    harness.pushLyrics(LYRICS);
    await expand(harness);
    enter();
    click(cover());
    click(cover());
    leave();
    advance(1500);
    expect(mode()).toBe("expanded");
    enter();
    leave();
    advance(200);
    expect(mode()).toBe("live");
  });

  it("adds the song to a playlist, shows the answer and returns", async () => {
    const harness = installApi({ state: null, lyrics: null, settings: DEFAULT_NOTCH_SETTINGS });
    await mount();
    const items = [
      { id: "p1", title: "Late Drive", coverUrl: null, trackCount: 42 },
      { id: "p2", title: "Focus", coverUrl: null, trackCount: 1 },
    ];
    harness.pushPlaylists({ items, outcome: null });
    await expand(harness);
    click(button("Add to playlist"));
    expect(view()).toBe("add");
    const rows = () => [...host.querySelectorAll<HTMLElement>(".add-rows .row")];
    expect(rows().map((row) => row.querySelector(".row-meta")!.textContent)).toEqual(["42 songs", "1 song"]);
    click(rows()[1]);
    expect(harness.api.notchAction).toHaveBeenLastCalledWith({ type: "addToPlaylist", trackId: "t1", playlistId: "p2" });
    harness.pushPlaylists({ items, outcome: { trackId: "t1", playlistId: "p2", kind: "failed" } });
    expect(rows()[1].querySelector(".row-meta")!.textContent).toBe("Couldn't add the song");
    advance(2000);
    expect(view()).toBe("add");
    click(rows()[1]);
    harness.pushPlaylists({ items: [...items].reverse(), outcome: { trackId: "t1", playlistId: "p2", kind: "added" } });
    expect(rows()[1].querySelector(".row-meta")!.textContent).toBe("Added");
    advance(1200);
    expect(view()).toBe("now");
    click(button("Add to playlist"));
    harness.pushState(makeState({ track: { ...makeState().track!, id: "t2" } }));
    expect(view()).toBe("now");
  });

  it("says so when there is no playlist yet", async () => {
    const harness = installApi({ state: null, lyrics: null, settings: DEFAULT_NOTCH_SETTINGS });
    await mount();
    await expand(harness);
    click(button("Add to playlist"));
    expect(host.querySelector(".empty")!.textContent).toBe("No playlists yet.");
    click(button("Back to the song"));
    expect(view()).toBe("now");
  });

  it("nudges the sheets once in a lifetime, the first time pages exist", async () => {
    localStorage.removeItem("nuvo_notch_nudged");
    const harness = installApi({ state: null, lyrics: null, settings: DEFAULT_NOTCH_SETTINGS });
    await mount();
    const nudging = () => host.querySelector(".deck")!.hasAttribute("data-nudge");
    await expand(harness);
    expect(nudging()).toBe(false);
    harness.pushLyrics(LYRICS);
    expect(nudging()).toBe(true);
    advance(1500);
    expect(nudging()).toBe(false);
    enter();
    leave();
    advance(200);
    click(island());
    expect(nudging()).toBe(false);
  });

  it("moves the clock only while expanded and playing", async () => {
    const clock = () => host.querySelector(".scrubber-time")!.textContent;
    const harness = installApi({ state: null, lyrics: null, settings: DEFAULT_NOTCH_SETTINGS });
    await mount();
    await expand(harness, makeState({ status: "paused" }));
    const paused = clock();
    advance(5000);
    expect(clock()).toBe(paused);
    harness.pushState(makeState({ status: "playing", sampledAt: Date.now() }));
    advance(3000);
    const moved = clock();
    expect(moved).not.toBe(paused);
    leave();
    advance(200);
    expect(mode()).toBe("live");
    const left = clock();
    advance(5000);
    expect(clock()).toBe(left);
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

  it("vertical wheel changes the volume, horizontal wheel flips pages both ways", async () => {
    const harness = installApi({ state: null, lyrics: null, settings: DEFAULT_NOTCH_SETTINGS });
    await mount();
    harness.pushLyrics(LYRICS);
    await expand(harness, makeState({ upNext: UP_NEXT }));
    act(() => island().dispatchEvent(new WheelEvent("wheel", { deltaY: -100, bubbles: true })));
    expect(harness.api.notchAction).toHaveBeenLastCalledWith({ type: "volumeDelta", delta: 0.05 });
    expect(host.querySelector(".volume")).not.toBeNull();
    advance(1500);
    expect(host.querySelector(".volume")).toBeNull();
    expect(view()).toBe("now");
    flip(60);
    expect(view()).toBe("lyrics");
    flip(60);
    flip(60);
    expect(view()).toBe("upNext");
    flip(-60);
    expect(view()).toBe("lyrics");
  });

  it("a touch swipe flips pages", async () => {
    const harness = installApi({ state: null, lyrics: null, settings: DEFAULT_NOTCH_SETTINGS });
    await mount();
    harness.pushLyrics(LYRICS);
    await expand(harness);
    const pointer = (type: string, clientX: number) =>
      act(() => host.querySelector(".expanded")!.dispatchEvent(Object.assign(new MouseEvent(type, { bubbles: true, clientX }), { pointerType: "touch" })));
    pointer("pointerdown", 200);
    pointer("pointerup", 120);
    expect(view()).toBe("lyrics");
    pointer("pointerdown", 120);
    pointer("pointerup", 200);
    expect(view()).toBe("now");
  });

  it("an up-next row plays that track", async () => {
    const harness = installApi({ state: null, lyrics: null, settings: DEFAULT_NOTCH_SETTINGS });
    await mount();
    await expand(harness, makeState({ upNext: UP_NEXT }));
    click(cover());
    click(host.querySelector(".upNext .row")!);
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
