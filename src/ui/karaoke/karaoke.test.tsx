import { act, type JSX } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi, afterEach } from "vitest";
import look from "./look.json";
import { RISE_CURVE, bezierY } from "./rise";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let current: { title: string; artists: string; coverUrl: string; id: string } | null = null;
let lyricsStatus = "none";
let koreanLines = false;
let japaneseLines = false;
const romanizeKana = vi.hoisted(() => (text: string) => text);
let wordTimed = false;
let synced = true;
let twoVersions = false;
let activeVersion = "lrclib";
const timing = vi.hoisted(() => ({
  view: null as null | { enabled: boolean; models: string[]; job?: { trackId: string; model: string; state: string; progress: number; code?: string } },
  setWordTiming: vi.fn(async () => undefined),
  timeWords: vi.fn(async () => undefined),
  auto: vi.fn(),
}));
const pane = vi.hoisted(() => ({ modes: [] as string[] }));
const engine = vi.hoisted(() => ({
  togglePlayPause: vi.fn(),
  skipNext: vi.fn(),
  skipPrevious: vi.fn(),
  seek: vi.fn(),
  setVolume: vi.fn(),
  setShuffle: vi.fn(),
  setRepeat: vi.fn(),
}));
const lyricsCalls = vi.hoisted(() => ({ follow: vi.fn(), nudgeOffset: vi.fn(), clearOffset: vi.fn(), chooseVersion: vi.fn() }));
vi.mock("../ports/player", () => ({
  usePlayerStore: (select: (state: unknown) => unknown) =>
    select({
      currentTrack: current,
      status: "paused",
      positionMs: 42_000,
      durationMs: 157_000,
      volume: 1,
      shuffle: false,
      repeat: "off",
      playbackContext: null,
    }),
  playerEngine: engine,
  nextRepeatMode: () => "all",
  isRadioContext: () => false,
  toVolumeGain: (level: number) => level,
  toVolumeLevel: (gain: number) => gain,
}));
vi.mock("../ports/library", () => ({ useIsTrackLiked: () => true, useLikeTrack: () => ({ mutate: vi.fn() }), useUnlikeTrack: () => ({ mutate: vi.fn() }) }));
vi.mock("../ports/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("../ports/navigation", () => ({
  useWindowState: () => ({ isMaximized: false, isFullScreen: false }),
  canMinimizeWindow: () => true,
  minimizeWindow: vi.fn(),
  toggleMaximizeWindow: vi.fn(),
  closeWindow: vi.fn(),
}));
vi.mock("../ports/escape", () => ({ isEscapeGuarded: () => false }));
vi.mock("../ports/lyrics", () => ({
  useLyrics: (select: (state: unknown) => unknown) =>
    select({
      status: lyricsStatus,
      trackId: current?.id ?? null,
      versions:
        lyricsStatus === "ready"
          ? [
              { provider: "lrclib", label: null, syncLevel: "line_level", quality: 1, topPriority: false },
              ...(twoVersions ? [{ provider: "amll", label: null, syncLevel: "word_level", quality: 0.9, topPriority: false }] : []),
              ...(activeVersion.startsWith("whisper-")
                ? [{ provider: activeVersion, label: null, syncLevel: "word_level", quality: 0.85, topPriority: false }]
                : []),
            ]
          : [],
      activeVersion,
      offsetMs: 0,
      lines: koreanLines ? [{ text: "안녕" }] : japaneseLines ? [{ text: "さよなら" }] : [],
      plainText: null,
      wordTimed,
      synced,
    }),
  lyricsCommands: lyricsCalls,
  lyricsErrorText: () => "error text",
  versionLabel: (version: { syncLevel: string }) => `version ${version.syncLevel}`,
  romanizeKana,
  romanizerFor: (texts: string[]) =>
    texts.some((text) => /[가-힣]/.test(text)) ? (text: string) => text : texts.some((text) => /[ぁ-ん]/.test(text)) ? romanizeKana : null,
}));
vi.mock("./backdrop/Backdrop", () => ({ Backdrop: () => null }));
vi.mock("../ports/wordTiming", () => ({
  useWordTiming: () => timing.view,
  useAutoWordTiming: timing.auto,
  setWordTiming: timing.setWordTiming,
  timeWords: timing.timeWords,
  isLocalTiming: (provider: string | null) => provider === "whisper-base" || provider === "whisper-small",
  isRunning: (job: { trackId: string; state: string } | undefined, trackId: string | null) =>
    job?.trackId === trackId && (job?.state === "waiting" || job?.state === "running"),
}));
const openLyricsTool = vi.hoisted(() => vi.fn());
vi.mock("../screens/lyrics/lyricsTools", () => ({ openLyricsTool }));
vi.mock("./LyricsPane", () => ({
  LyricsPane: ({ mode }: { mode: string }) => {
    pane.modes.push(mode);
    return <div>lyric lines</div>;
  },
}));

import { setHighlightMode } from "./highlightMode";
import { Karaoke } from "./Karaoke";
import { KaraokeOverlay } from "./KaraokeOverlay";

function mount(node: JSX.Element) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(node));
  return {
    host,
    unmount: () => {
      act(() => root.unmount());
      host.remove();
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
  pane.modes.length = 0;
  act(() => setHighlightMode("fill"));
  wordTimed = false;
  synced = true;
  twoVersions = false;
  lyricsStatus = "none";
  koreanLines = false;
  japaneseLines = false;
});

describe("karaoke view", () => {
  it("the rise curve over the measured duration follows the measured samples", () => {
    const { samples, sampleTimesMs, durationMs } = look.overlay;
    const points = samples
      .map((top, i) => [sampleTimesMs[i], top] as const)
      .filter(([, top]) => top < 1)
      .slice(1);
    const error = (startMs: number) =>
      Math.max(...points.map(([at, top]) => Math.abs(top - (1 - bezierY(Math.min(1, Math.max(0, (at - startMs) / durationMs)), RISE_CURVE)))));
    const best = Math.min(...Array.from({ length: sampleTimesMs[1] + 1 }, (_, startMs) => error(startMs)));
    expect(best).toBeLessThan(0.03);
  });

  it("shows title, artist, times and every control with no cover", () => {
    current = { id: "t", title: "Song", artists: "Ann", coverUrl: "" };
    const view = mount(<Karaoke onClose={() => undefined} />);
    expect(view.host.textContent).toContain("Song");
    expect(view.host.textContent).toContain("Ann");
    expect(view.host.textContent).toContain("0:42");
    expect(view.host.textContent).toContain("2:37");
    const names = [
      "ui.karaoke.close",
      "ui.karaoke.shuffle_off",
      "ui.karaoke.previous",
      "ui.karaoke.play",
      "ui.karaoke.next",
      "ui.karaoke.repeat_off",
      "ui.karaoke.mute",
      "ui.karaoke.unlike",
    ];
    for (const name of names) expect(view.host.querySelector(`button[aria-label="${name}"]`), name).not.toBeNull();
    for (const name of ["ui.karaoke.seek", "ui.karaoke.volume"]) expect(view.host.querySelector(`[role=slider][aria-label="${name}"]`), name).not.toBeNull();
    expect(view.host.querySelector("[data-theme=dark]")).not.toBeNull();
    view.unmount();
  });

  it("no lyrics: one quiet line in the lyric column, no lines; found lyrics show the lines", () => {
    current = { id: "t", title: "Song", artists: "Ann", coverUrl: "" };
    const empty = mount(<Karaoke onClose={() => undefined} />);
    expect(lyricsCalls.follow).toHaveBeenCalledWith(current);
    expect(empty.host.textContent).toContain("ui.karaoke.no_lyrics");
    expect(empty.host.textContent).not.toContain("lyric lines");
    const add = [...empty.host.querySelectorAll("button")].find((button) => button.textContent === "ui.karaoke.add_lyrics")!;
    act(() => add.click());
    expect(openLyricsTool).toHaveBeenCalledWith(current, "edit");
    empty.unmount();
    lyricsStatus = "ready";
    const found = mount(<Karaoke onClose={() => undefined} />);
    expect(found.host.textContent).toContain("lyric lines");
    expect(found.host.querySelector('button[aria-label="ui.karaoke.earlier"]')).not.toBeNull();
    found.unmount();
  });

  it("the top bar names no lyrics provider; Earlier, the offset and Later stay", () => {
    current = { id: "t", title: "Song", artists: "Ann", coverUrl: "" };
    lyricsStatus = "ready";
    const view = mount(<Karaoke onClose={() => undefined} />);
    const header = view.host.querySelector("header")!;
    expect(header.textContent).not.toMatch(/lrclib/i);
    for (const label of ["ui.karaoke.earlier", "ui.karaoke.offset", "ui.karaoke.later"]) {
      expect(header.querySelector(`button[aria-label="${label}"]`)).not.toBeNull();
    }
    expect(lyricsCalls.chooseVersion).not.toHaveBeenCalled();
    view.unmount();
  });

  it("the lyrics version menu shows only with two or more versions and switches to the picked one", () => {
    current = { id: "t", title: "Song", artists: "Ann", coverUrl: "" };
    lyricsStatus = "ready";
    const single = mount(<Karaoke onClose={() => undefined} />);
    expect(single.host.querySelector('button[aria-label="ui.karaoke.version"]')).toBeNull();
    single.unmount();
    twoVersions = true;
    const view = mount(<Karaoke onClose={() => undefined} />);
    const button = view.host.querySelector<HTMLButtonElement>('header button[aria-label="ui.karaoke.version"]')!;
    expect(button).not.toBeNull();
    act(() => button.click());
    const items = [...document.querySelectorAll<HTMLButtonElement>('[role="menu"] [role="menuitem"]')];
    expect(items.map((item) => item.textContent)).toEqual(["version line_level", "version word_level"]);
    expect(items.map((item) => item.querySelector("svg") !== null)).toEqual([true, false]);
    act(() => items[1].click());
    expect(lyricsCalls.chooseVersion).toHaveBeenCalledWith("amll");
    view.unmount();
  });

  it("the romanization switch shows for Korean lyrics only and its choice is kept", () => {
    current = { id: "t", title: "Song", artists: "Ann", coverUrl: "" };
    lyricsStatus = "ready";
    const plain = mount(<Karaoke onClose={() => undefined} />);
    expect(plain.host.querySelector('button[aria-label="ui.karaoke.romanize"]')).toBeNull();
    plain.unmount();
    koreanLines = true;
    const korean = mount(<Karaoke onClose={() => undefined} />);
    const toggle = korean.host.querySelector<HTMLButtonElement>('button[aria-label="ui.karaoke.romanize"]')!;
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    act(() => toggle.click());
    expect(korean.host.querySelector('button[aria-label="ui.karaoke.romanize"]')!.getAttribute("aria-pressed")).toBe("true");
    expect(localStorage.getItem("nuvo.lyricsRomanized")).toBe("1");
    act(() => korean.host.querySelector<HTMLButtonElement>('button[aria-label="ui.karaoke.romanize"]')!.click());
    korean.unmount();
  });

  it("a Japanese song's switch says that only the kana is romanized", () => {
    current = { id: "t", title: "Song", artists: "Ann", coverUrl: "" };
    lyricsStatus = "ready";
    japaneseLines = true;
    const view = mount(<Karaoke onClose={() => undefined} />);
    expect(view.host.querySelector('button[aria-label="ui.karaoke.romanize_kana"]')).not.toBeNull();
    view.unmount();
  });

  it("arrow keys on the timeline move 5 s, the transport buttons reach the player", () => {
    current = { id: "t", title: "Song", artists: "Ann", coverUrl: "" };
    const view = mount(<Karaoke onClose={() => undefined} />);
    const seek = view.host.querySelector<HTMLElement>('[role=slider][aria-label="ui.karaoke.seek"]')!;
    act(() => {
      seek.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    });
    expect(engine.seek).toHaveBeenLastCalledWith(47_000);
    act(() => view.host.querySelector<HTMLButtonElement>('button[aria-label="ui.karaoke.play"]')!.click());
    expect(engine.togglePlayPause).toHaveBeenCalled();
    act(() => view.host.querySelector<HTMLButtonElement>('button[aria-label="ui.karaoke.mute"]')!.click());
    expect(engine.setVolume).toHaveBeenLastCalledWith(0);
    view.unmount();
  });

  it("Escape and F close it unless a guard or a field holds the key", () => {
    current = { id: "t", title: "Song", artists: "Ann", coverUrl: "" };
    const onClose = vi.fn();
    const view = mount(<Karaoke onClose={onClose} />);
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "f" }));
    });
    expect(onClose).toHaveBeenCalledTimes(2);
    const handled = new KeyboardEvent("keydown", { key: "Escape", cancelable: true });
    handled.preventDefault();
    act(() => {
      window.dispatchEvent(handled);
    });
    expect(onClose).toHaveBeenCalledTimes(2);
    view.unmount();
  });

  it("the overlay rises in, then stays mounted until it has gone back down", () => {
    vi.useFakeTimers();
    current = { id: "t", title: "Song", artists: "Ann", coverUrl: "" };
    const host = document.createElement("div");
    const root = createRoot(host);
    act(() => root.render(<KaraokeOverlay open={false} onClose={() => undefined} />));
    expect(host.firstElementChild).toBeNull();
    act(() => root.render(<KaraokeOverlay open onClose={() => undefined} />));
    const overlay = host.firstElementChild as HTMLElement;
    expect(overlay.dataset.theme).toBe("dark");
    act(() => vi.advanceTimersByTime(100));
    expect(overlay.dataset.phase).toBe("open");
    act(() => root.render(<KaraokeOverlay open={false} onClose={() => undefined} />));
    expect((host.firstElementChild as HTMLElement).dataset.phase).toBe("leaving");
    act(() => vi.advanceTimersByTime(look.overlay.durationMs + 10));
    expect(host.firstElementChild).toBeNull();
    act(() => root.unmount());
  });
});

describe("highlight modes", () => {
  const song = { title: "T", artists: "A", coverUrl: "", id: "t" };
  const switchOf = (host: HTMLElement) => [...host.querySelectorAll<HTMLButtonElement>('[role="group"][aria-label="ui.karaoke.highlight"] button')];
  const pressed = (host: HTMLElement) =>
    switchOf(host)
      .filter((button) => button.getAttribute("aria-pressed") === "true")
      .map((button) => button.textContent);

  it("a song with word timing offers all four and starts on Fill", () => {
    current = song;
    lyricsStatus = "ready";
    wordTimed = true;
    const view = mount(<Karaoke onClose={() => undefined} />);
    expect(switchOf(view.host).map((button) => button.textContent)).toEqual(["line", "word", "fill", "step"].map((mode) => `ui.karaoke.highlight_${mode}`));
    expect(pressed(view.host)).toEqual(["ui.karaoke.highlight_fill"]);
    expect(pane.modes.at(-1)).toBe("fill");
    view.unmount();
  });

  it("a song with line timing only offers nothing that cannot work, says why, and stays on Line", () => {
    current = song;
    lyricsStatus = "ready";
    act(() => setHighlightMode("step"));
    const view = mount(<Karaoke onClose={() => undefined} />);
    expect(switchOf(view.host)).toEqual([]);
    expect(view.host.textContent).toContain("ui.karaoke.highlight_line_only");
    expect(pane.modes.at(-1)).toBe("line");
    view.unmount();
  });

  it("the choice survives a new view and a song without word timing leaves it alone", () => {
    current = song;
    lyricsStatus = "ready";
    wordTimed = true;
    const first = mount(<Karaoke onClose={() => undefined} />);
    act(() => switchOf(first.host)[1].click());
    expect(pane.modes.at(-1)).toBe("word");
    first.unmount();
    expect(localStorage.getItem("nuvo.karaoke.highlight")).toBe("word");

    wordTimed = false;
    const second = mount(<Karaoke onClose={() => undefined} />);
    expect(pane.modes.at(-1)).toBe("line");
    second.unmount();

    wordTimed = true;
    const third = mount(<Karaoke onClose={() => undefined} />);
    expect(pressed(third.host)).toEqual(["ui.karaoke.highlight_word"]);
    third.unmount();
  });

  it("plain lyrics show no switch and no note", () => {
    current = song;
    lyricsStatus = "ready";
    synced = false;
    const view = mount(<Karaoke onClose={() => undefined} />);
    expect(switchOf(view.host)).toEqual([]);
    expect(view.host.textContent).not.toContain("ui.karaoke.highlight_line_only");
    view.unmount();
  });
});

describe("word timing in the lyrics view", () => {
  const song = { title: "Song", artists: "Artist", coverUrl: "", id: "t1" };
  const control = (host: HTMLElement) =>
    [...host.querySelectorAll<HTMLButtonElement>("button[aria-pressed]")].find((b) => b.textContent?.startsWith("ui.karaoke.word_timing."));
  const improve = (host: HTMLElement) => {
    act(() => host.querySelector<HTMLButtonElement>('[aria-label="ui.karaoke.version"]')?.click());
    return [...document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((item) => item.textContent?.includes("ui.karaoke.word_timing.improve"));
  };

  afterEach(() => {
    timing.view = null;
    activeVersion = "lrclib";
    timing.setWordTiming.mockClear();
    timing.timeWords.mockClear();
  });

  it("is a switch that turns it on and times the song, next to the line-only note", async () => {
    current = song;
    lyricsStatus = "ready";
    timing.view = { enabled: false, models: [] };
    const view = mount(<Karaoke onClose={() => undefined} />);
    expect(control(view.host)?.getAttribute("aria-pressed")).toBe("false");
    expect(view.host.textContent).toContain("ui.karaoke.highlight_line_only");
    expect(timing.auto).toHaveBeenLastCalledWith("t1", true);
    await act(async () => control(view.host)?.click());
    expect(timing.setWordTiming).toHaveBeenCalledWith(true);
    expect(timing.timeWords).toHaveBeenCalledWith("t1");
    view.unmount();
  });

  it("shows the progress of this song's job on the switch and keeps the row in sight", () => {
    current = song;
    lyricsStatus = "ready";
    timing.view = { enabled: true, models: ["whisper-base"], job: { trackId: "t1", model: "whisper-base", state: "running", progress: 0.4 } };
    const view = mount(<Karaoke onClose={() => undefined} />);
    expect(control(view.host)?.textContent).toBe("ui.karaoke.word_timing.running");
    expect(control(view.host)?.getAttribute("aria-pressed")).toBe("true");
    expect(view.host.querySelector("[data-busy]")).not.toBeNull();
    expect(view.host.textContent).not.toContain("ui.karaoke.highlight_line_only");
    view.unmount();
  });

  it("says why a song could not be timed", () => {
    current = song;
    lyricsStatus = "ready";
    timing.view = { enabled: true, models: [], job: { trackId: "t1", model: "whisper-base", state: "failed", progress: 0, code: "lyrics_mismatch" } };
    const view = mount(<Karaoke onClose={() => undefined} />);
    expect(view.host.textContent).toContain("ui.karaoke.word_timing.mismatch");
    expect(view.host.querySelector("[data-busy]")).toBeNull();
    view.unmount();
  });

  it("offers the larger model in the versions menu once the fast timing is shown", () => {
    current = song;
    lyricsStatus = "ready";
    wordTimed = true;
    activeVersion = "whisper-base";
    timing.view = { enabled: true, models: ["whisper-base"] };
    const view = mount(<Karaoke onClose={() => undefined} />);
    const item = improve(view.host);
    expect(item).toBeDefined();
    act(() => item?.click());
    expect(timing.timeWords).toHaveBeenCalledWith("t1", true);
    activeVersion = "whisper-small";
    view.unmount();
    const better = mount(<Karaoke onClose={() => undefined} />);
    expect(improve(better.host)).toBeUndefined();
    better.unmount();
  });

  it("stays out of the way when the song brings its own word timing", () => {
    current = song;
    lyricsStatus = "ready";
    wordTimed = true;
    activeVersion = "amll";
    timing.view = { enabled: true, models: [] };
    const view = mount(<Karaoke onClose={() => undefined} />);
    expect(control(view.host)).toBeUndefined();
    view.unmount();
  });
});
