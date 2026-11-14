// @vitest-environment jsdom
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { useNotInterestedStore } from "../../recs/notInterested";
import { useTour } from "../../tour/tourStore";
import { useShellStore } from "../shellStore";
import { Island } from "./Island";
import { volumeGlyph } from "./VolumeLadder";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => {
  const track = { id: "t1", title: "Teardrop", artists: "Massive Attack", coverUrl: "", durationMs: 330_000 };
  const player = {
    status: "playing",
    currentTrack: track as typeof track | null,
    positionMs: 42_000,
    durationMs: 330_000,
    volume: 0.49,
    playbackRate: 1,
    pitchSemitones: 0,
    isPitchLinked: true,
    keepSpeedAcrossTracks: true,
    isReverbEnabled: false,
    reverbLevel: 0.35,
    queue: [] as { title: string }[],
    currentIndex: 0,
    playbackContext: "Late night drive" as string | null,
    autoplayFrom: null as number | null,
    shuffle: false,
    repeat: "off",
    outputSilent: null as string | null,
    setFullscreen: vi.fn(),
  };
  const engine = {
    togglePlayPause: vi.fn(),
    skipPrevious: vi.fn(),
    skipNext: vi.fn(),
    seek: vi.fn(),
    setVolume: vi.fn(),
    setShuffle: vi.fn(),
    setRepeat: vi.fn(),
  };
  const settle = (_id: string, options: { onSettled(): void }) => options.onSettled();
  const like = { liked: false, like: vi.fn(settle), unlike: vi.fn(settle) };
  const look = { preset: "nuvo" };
  const network = { reachable: true };
  const cache = { ids: new Set<string>() };
  const pick = { track: null as typeof track | null, reason: null as { kind: string; name?: string } | null };
  return { player, engine, like, look, network, cache, pick };
});

vi.mock("../../ports/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("../../ports/covers", () => ({ coverSrc: (src: string) => src }));
vi.mock("../../ports/karaoke", () => ({
  MorphPlayIcon: ({ playing }: { playing: boolean }) => <i data-morph={playing ? "pause" : "play"} />,
}));
const unmuteOutput = vi.hoisted(() => vi.fn(async () => undefined));
const dislike = vi.hoisted(() => vi.fn(async () => ({ suppressionId: 1, offerHideArtist: false })));
const standIn = vi.hoisted(() => ({ current: null as { source: string; restarted: boolean; hover: string } | null }));
const keepVersion = vi.hoisted(() => vi.fn(async () => true));
const rejectVersion = vi.hoisted(() => vi.fn(async (_id: string) => undefined));

vi.mock("../../ports/player", () => ({
  usePlayerState: () => mocks.player,
  usePlayerStore: (select: (state: typeof mocks.player) => unknown) => select(mocks.player),
  playerEngine: mocks.engine,
  playerOutputs: { unmute: unmuteOutput },
  toVolumeGain: (level: number) => level * level,
  toVolumeLevel: (gain: number) => Math.sqrt(gain),
  currentStreamFormat: () => ({ codec: "opus", bitrate: 160_000 }),
  currentFallback: () => standIn.current,
  keepVersion: () => keepVersion(),
  rejectVersion: (id: string) => rejectVersion(id),
  isRadioContext: () => false,
  nextRepeatMode: (mode: string) => ({ off: "all", all: "one", one: "off" })[mode],
}));
vi.mock("../../ports/recs", () => ({ recsEnabled: true, useCurrentPick: () => mocks.pick, dislike, recs: { undo: vi.fn() } }));
vi.mock("../../ports/catalog", () => ({ useCachedTrackIds: () => mocks.cache.ids }));
vi.mock("../../ports/network", () => ({ useStreamingReachable: () => mocks.network.reachable }));
vi.mock("../../ports/sound", () => ({
  useSleepTimer: () => ({ remainingMs: null }),
  useAbLoopStore: (select: (state: { a: null; b: null }) => unknown) => select({ a: null, b: null }),
}));
vi.mock("../../ports/theme", () => ({ useLook: () => ({ preset: mocks.look.preset, mode: "dark" }) }));
vi.mock("../../ports/library", () => ({
  useIsTrackLiked: () => mocks.like.liked,
  useLikeTrack: () => ({ mutate: mocks.like.like }),
  useUnlikeTrack: () => ({ mutate: mocks.like.unlike }),
  usePlaylistsList: () => ({ data: { playlists: [] }, isLoading: false }),
  useAddPlaylistTracks: () => ({ mutateAsync: vi.fn() }),
  useModalStore: (select: (state: { openCreatePlaylist: () => void }) => unknown) => select({ openCreatePlaylist: vi.fn() }),
  ApiError: class extends Error {},
}));
vi.mock("../popovers/SoundPopover", () => ({
  SOUND_TABS: [
    { id: "eq", width: 560 },
    { id: "speed", width: 440 },
    { id: "sleep", width: 440 },
  ],
  SoundPopover: () => <div data-testid="sound" />,
  SoundTrailing: () => null,
}));

let root: Root;
let host: HTMLDivElement;

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  vi.clearAllMocks();
  mocks.player.currentTrack = { id: "t1", title: "Teardrop", artists: "Massive Attack", coverUrl: "", durationMs: 330_000 };
  mocks.like.liked = false;
  mocks.player.queue = ["One", "Two", "Three", "Four", "Five"].map((title) => ({ title }));
  mocks.player.currentIndex = 0;
  mocks.player.playbackContext = "Late night drive";
  mocks.player.autoplayFrom = null;
  mocks.player.shuffle = false;
  mocks.player.repeat = "off";
  mocks.look.preset = "nuvo";
  mocks.network.reachable = true;
  mocks.cache.ids = new Set();
  mocks.pick.track = null;
  mocks.pick.reason = null;
  useNotInterestedStore.setState({ notice: null });
  useShellStore.setState({ queueOpen: false });
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

const mount = () => act(() => root.render(<Island />));
const button = (name: string) => document.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`);
const click = (target: Element) =>
  act(() => {
    target.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    (target as HTMLElement).click();
  });
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');

const hintOver = (target: Element) => {
  act(() => {
    target.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    vi.advanceTimersByTime(600);
  });
  return document.querySelector('[role="tooltip"]')?.textContent ?? null;
};

describe("Island", () => {
  it("a dislike beside the like records the playing song", async () => {
    act(() => root.render(<Island />));
    const button = host.querySelector<HTMLButtonElement>("[data-dislike]")!;
    expect(button.getAttribute("aria-label")).toBe("ui.recs.dislike");
    await act(async () => button.click());
    expect(dislike).toHaveBeenCalledWith(expect.objectContaining({ id: "t1" }), "exact");
  });

  it("offers Not interested on right click", () => {
    mocks.pick.track = { id: "t1", title: "Teardrop", artists: "Massive Attack", coverUrl: "", durationMs: 330_000 };
    mount();
    act(() => {
      button("ui.island.open_lyrics")!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 20, clientY: 20 }));
    });
    expect([...document.querySelectorAll('[role="menuitem"]')].map((b) => b.textContent)).toEqual([
      "ui.recs.menu.exact",
      "ui.recs.menu.work",
      "ui.recs.menu.artist",
    ]);
  });

  it("says what was hidden on the quiet line, with Undo beside it", () => {
    const track = { id: "t1", title: "Teardrop", artists: "Massive Attack", coverUrl: "", durationMs: 330_000 };
    mount();
    act(() => useNotInterestedStore.getState().setNotice({ id: 1, track, scope: "work", failure: null, suppressionId: 3, offerHideArtist: false }));
    const line = document.querySelector("[data-state-line]");
    expect(line?.textContent).toBe("ui.recs.notice.work");
    expect(line?.getAttribute("role")).toBeNull();
    expect(button("ui.recs.notice.undo") ?? [...document.querySelectorAll("button")].find((b) => b.textContent === "ui.recs.notice.undo")).toBeTruthy();
  });

  it("a playing track the system mixer muted says so instead of looking like it plays, and Unmute lifts it", () => {
    mocks.player.outputSilent = "system_muted";
    try {
      mount();
      expect(document.querySelector("[data-state-line]")?.textContent).toBe("ui.island.state.system_muted");
      expect(document.querySelector('[aria-live="polite"]')?.textContent).toBe("ui.island.state.system_muted");
      const unmute = [...document.querySelectorAll("button")].find((b) => b.textContent === "ui.island.unmute")!;
      act(() => unmute.click());
      expect(unmuteOutput).toHaveBeenCalledTimes(1);
    } finally {
      mocks.player.outputSilent = null;
    }
  });

  it("a stopped audio output is named without an Unmute offer", () => {
    mocks.player.outputSilent = "output_stopped";
    try {
      mount();
      expect(document.querySelector("[data-state-line]")?.textContent).toBe("ui.island.state.output_stopped");
      expect([...document.querySelectorAll("button")].some((b) => b.textContent === "ui.island.unmute")).toBe(false);
    } finally {
      mocks.player.outputSilent = null;
    }
  });

  it("announces the notice through a live region that is mounted before the notice", () => {
    const track = { id: "t1", title: "Teardrop", artists: "Massive Attack", coverUrl: "", durationMs: 330_000 };
    mount();
    const region = document.querySelector('[aria-live="polite"]')!;
    expect(region).not.toBeNull();
    expect(region.textContent).toBe("");
    act(() => useNotInterestedStore.getState().setNotice({ id: 1, track, scope: "exact", failure: null, suppressionId: 3, offerHideArtist: false }));
    expect(document.querySelector('[aria-live="polite"]')).toBe(region);
    expect(region.textContent).toBe("ui.recs.notice.exact");
  });

  it("returns focus to the like button when Undo goes away", async () => {
    const track = { id: "t1", title: "Teardrop", artists: "Massive Attack", coverUrl: "", durationMs: 330_000 };
    mount();
    act(() => useNotInterestedStore.getState().setNotice({ id: 1, track, scope: "exact", failure: null, suppressionId: 3, offerHideArtist: false }));
    const undo = [...document.querySelectorAll("button")].find((b) => b.textContent === "ui.recs.notice.undo")!;
    undo.focus();
    await act(async () => undo.click());
    expect(document.activeElement).toBe(button("ui.island.like"));
  });

  it("drops a notice when nothing plays, so it cannot come back with the next track", () => {
    const track = { id: "t1", title: "Teardrop", artists: "Massive Attack", coverUrl: "", durationMs: 330_000 };
    useNotInterestedStore.setState({ notice: { id: 1, track, scope: "exact", failure: null, suppressionId: 3, offerHideArtist: false } });
    mocks.player.currentTrack = null;
    mount();
    expect(useNotInterestedStore.getState().notice).toBeNull();
  });

  it("words the pick's reason on the quiet line", () => {
    mocks.pick.track = { id: "t1", title: "Teardrop", artists: "Massive Attack", coverUrl: "", durationMs: 330_000 };
    mocks.pick.reason = { kind: "session", name: "Roygbiv" };
    mount();
    expect(document.querySelector("[data-state-line]")?.textContent).toBe("ui.recs.reason.session");
  });

  it("says quietly when another source stands in and offers to keep or refuse it", () => {
    standIn.current = { source: "SoundCloud", restarted: false, hover: "" };
    mount();
    expect(document.querySelector("[data-state-line]")?.textContent).toContain("ui.island.state.played_from");
    const open = () =>
      act(() => {
        button("ui.island.open_lyrics")!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 20, clientY: 20 }));
      });
    const item = (label: string) => [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((b) => b.textContent === label)!;
    open();
    act(() => item("ui.island.keep_version").click());
    expect(keepVersion).toHaveBeenCalledTimes(1);
    open();
    act(() => item("ui.island.reject_version").click());
    expect(rejectVersion).toHaveBeenCalledTimes(1);
    standIn.current = null;
  });

  it("renders nothing without a current track", () => {
    mocks.player.currentTrack = null;
    mount();
    expect(host.innerHTML).toBe("");
  });

  it("shows the tour's sample song while a player chapter runs on a first launch, and drops it after", () => {
    mocks.player.currentTrack = null;
    act(() => useTour.setState({ phase: "chapter", chapterIds: ["search", "player"], chapter: 1 }));
    mount();
    expect(document.querySelector("[data-island-title]")?.textContent).toBe("ui.tour.demo.title");
    expect(document.querySelector('[data-tour="like"]')).not.toBeNull();
    act(() => useTour.setState({ chapter: 0 }));
    expect(host.innerHTML).toBe("");
    act(() => useTour.setState({ phase: "off", chapterIds: [], chapter: 0 }));
  });

  it("the play button's label and glyph follow the player: Pause while playing, Play while paused", () => {
    mount();
    expect(button("ui.island.pause")!.querySelector("[data-morph]")!.getAttribute("data-morph")).toBe("pause");
    expect(button("ui.island.play")).toBeNull();
    mocks.player.status = "paused";
    mount();
    expect(button("ui.island.play")!.querySelector("[data-morph]")!.getAttribute("data-morph")).toBe("play");
    expect(button("ui.island.pause")).toBeNull();
    mocks.player.status = "playing";
  });

  it("plays, pauses and skips through the engine", () => {
    mount();
    click(button("ui.island.pause")!);
    expect(mocks.engine.togglePlayPause).toHaveBeenCalledTimes(1);
    click(button("ui.island.previous")!);
    expect(mocks.engine.skipPrevious).toHaveBeenCalledTimes(1);
    click(button("ui.island.next")!);
    expect(mocks.engine.skipNext).toHaveBeenCalledTimes(1);
  });

  it("likes and unlikes the track, and the label and coloured state follow", () => {
    mount();
    expect(button("ui.island.like")!.hasAttribute("data-liked")).toBe(false);
    click(button("ui.island.like")!);
    expect(mocks.like.like).toHaveBeenCalledWith(expect.objectContaining({ id: "t1" }), expect.anything());
    expect(button("ui.island.like")!.hasAttribute("data-pop")).toBe(true);
    mocks.like.liked = true;
    mount();
    expect(button("ui.island.like")).toBeNull();
    expect(button("ui.island.unlike")!.hasAttribute("data-liked")).toBe(true);
    click(button("ui.island.unlike")!);
    expect(mocks.like.unlike).toHaveBeenCalledWith("t1", expect.anything());
    expect(button("ui.island.unlike")!.hasAttribute("data-pop")).toBe(false);
  });

  it("moves one popover between its buttons and closes it from the open one", () => {
    vi.useFakeTimers();
    mount();
    click(button("ui.island.add")!);
    const first = dialog();
    expect(first?.getAttribute("aria-label")).toBe("ui.add.title");
    click(button("ui.island.sound")!);
    expect(dialog()).toBe(first);
    expect(first?.getAttribute("aria-label")).toBe("ui.sound.title");
    act(() => {
      button("ui.island.sound")!.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
      vi.advanceTimersByTime(600);
    });
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
    click(button("ui.island.sound")!);
    act(() => vi.advanceTimersByTime(200));
    expect(dialog()).toBeNull();
  });

  it("steps the volume with the wheel over the button and over the open popover", () => {
    mount();
    act(() => {
      button("ui.island.volume")!.dispatchEvent(new WheelEvent("wheel", { deltaY: -100, bubbles: true }));
    });
    expect(mocks.engine.setVolume).toHaveBeenLastCalledWith(0.75 * 0.75);
    click(button("ui.island.volume")!);
    act(() => {
      dialog()!
        .querySelector('[role="slider"]')!
        .dispatchEvent(new WheelEvent("wheel", { deltaY: 100, bubbles: true }));
    });
    expect(mocks.engine.setVolume).toHaveBeenLastCalledWith(0.65 * 0.65);
  });

  it("opens the karaoke view from the cover and title", () => {
    mount();
    click(button("ui.island.open_lyrics")!);
    expect(mocks.player.setFullscreen).toHaveBeenCalledWith(true);
  });

  it("seeks 5 s with ArrowRight and tints the played part from the left", () => {
    mount();
    const scrubber = document.querySelector<HTMLElement>('[role="slider"][aria-label="ui.island.seek"]')!;
    act(() => {
      scrubber.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    });
    expect(mocks.engine.seek).toHaveBeenCalledWith(47_000);
    act(() => {
      scrubber.dispatchEvent(new KeyboardEvent("keydown", { key: "PageDown", bubbles: true }));
    });
    expect(mocks.engine.seek).toHaveBeenLastCalledWith(12_000);
    const fill = scrubber.firstElementChild as HTMLElement;
    expect(parseFloat(fill.style.transform.replace("translateX(", "")) / 100 + 1).toBeCloseTo(42_000 / 330_000, 5);
    expect(fill.style.getPropertyValue("--tint")).toBe("rgba(255, 255, 255, 0.12)");
  });

  it("marks Queue pressed while the store has the queue open", () => {
    mount();
    expect(button("ui.island.queue")!.getAttribute("aria-pressed")).toBe("false");
    act(() => useShellStore.getState().toggleQueue());
    expect(button("ui.island.queue")!.getAttribute("aria-pressed")).toBe("true");
    click(button("ui.island.queue")!);
    expect(useShellStore.getState().queueOpen).toBe(false);
  });

  it("says radio continues once playback passes the end of the queue", () => {
    mocks.player.autoplayFrom = 3;
    mocks.player.currentIndex = 2;
    mount();
    expect(document.querySelector("[data-state-line]")).toBeNull();
    mocks.player.currentIndex = 3;
    mount();
    expect(document.querySelector("[data-state-line]")?.textContent).toBe("ui.island.state.radio_queue");
  });

  it("says offline before anything else", () => {
    mocks.player.autoplayFrom = 3;
    mocks.player.currentIndex = 3;
    mocks.network.reachable = false;
    mount();
    expect(document.querySelector("[data-state-line]")?.textContent).toBe("ui.island.state.offline");
  });

  it("toggles shuffle and steps repeat through the engine, lighting the mode that is on", () => {
    mount();
    const shuffle = button("player.shuffle_off")!;
    expect(shuffle.className).not.toMatch(/(^| )_on_/);
    click(shuffle);
    expect(mocks.engine.setShuffle).toHaveBeenCalledWith(true);
    click(button("player.repeat_off")!);
    expect(mocks.engine.setRepeat).toHaveBeenCalledWith("all");
    mocks.player.shuffle = true;
    mocks.player.repeat = "one";
    mount();
    expect(button("player.shuffle_on")!.className).toMatch(/(^| )_on_/);
    expect(button("player.repeat_one")!.className).toMatch(/(^| )_on_/);
  });

  it("keeps the square cover under the vinyl look", () => {
    mocks.look.preset = "vinyl";
    mount();
    expect(button("ui.island.open_lyrics")!.firstElementChild!.className).not.toContain("vinyl");
  });

  it("lays the bar out as cover and title, the transport in the middle, then the tools", () => {
    mount();
    const bar = document.querySelector<HTMLElement>("[data-island]")!;
    const [now, centre, actions] = Array.from(bar.children);
    expect(now.contains(button("ui.island.open_lyrics"))).toBe(true);
    expect(now.contains(button("ui.island.like"))).toBe(true);
    expect(centre.querySelectorAll("button")[0].getAttribute("aria-label")).toBe("ui.island.previous");
    expect(bar.querySelector('[role="slider"]')).not.toBeNull();
    const labels = Array.from(actions.querySelectorAll("button")).map((element) => element.getAttribute("aria-label"));
    expect(labels).toEqual([
      "player.shuffle_off",
      "player.repeat_off",
      "ui.island.sound",
      "ui.island.add",
      "ui.island.volume",
      "player.open_player",
      "ui.island.queue",
    ]);
  });

  it("shows the speaker for the volume level: crossed out at zero, one wave below a third", () => {
    // gain 0.49 is level 0.7
    mount();
    expect(button("ui.island.volume")!.dataset.level).toBe("0.70");
    expect(volumeGlyph(0.7)).toBe("volume-high");
    expect(volumeGlyph(0.2)).toBe("volume-low");
    expect(volumeGlyph(0)).toBe("volume-mute");
  });

  it("hints the stream format on hover, or that the track is saved on this device", () => {
    vi.useFakeTimers();
    mount();
    const artist = () => [...document.querySelectorAll("span")].find((element) => element.textContent === "Massive Attack")!;
    expect(hintOver(artist())).toBe("ui.island.bitrate");
    act(() => artist().dispatchEvent(new MouseEvent("mouseout", { bubbles: true })));
    mocks.cache.ids = new Set(["t1"]);
    mount();
    expect(hintOver(artist())).toBe("ui.island.cached");
  });
});
