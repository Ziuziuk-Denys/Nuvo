// @vitest-environment jsdom
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { PaletteField } from "./Palette";
import { useGateStore } from "../lock/gateState";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => {
  const EN: Record<string, string> = {
    "ui.palette.field": "Search songs, artists or paste a link",
    "ui.palette.suggested": "Suggested",
    "ui.palette.actions": "Actions",
    "ui.palette.search": "Search",
    "ui.palette.settings": "Open Settings",
    "ui.palette.play_pause": "Play or pause",
    "ui.palette.next": "Next track",
    "ui.palette.lyrics": "Open lyrics",
    "ui.palette.setting": "Settings: {title}",
    "ui.search.none": "Nothing found for “{query}”.",
    "ui.search.top": "Top result",
    "ui.search.tab_songs": "Songs",
    "ui.palette.collections": "Playlists and albums",
    "settings.cover_glow.title": "Cover glow",
  };
  const current = { id: "t1", title: "Song" };
  const song = (id: string, title: string) => ({
    kind: "song",
    id,
    title,
    subtitle: "Lorde",
    cover: "",
    track: { id, title, artists: "Lorde", durationMs: 200_000 },
  });
  return {
    EN,
    catalog: [
      { kind: "artist", id: "lorde", title: "Lorde", subtitle: "", cover: "", href: "/artist?id=lorde" },
      song("s1", "Liability"),
      song("s2", "Supercut"),
      { kind: "album", id: "m", title: "Melodrama", subtitle: "Lorde", cover: "", href: "/collection?type=album&id=m" },
    ],
    player: { setFullscreen: vi.fn() },
    engine: {
      togglePlayPause: vi.fn(),
      skipNext: vi.fn(),
      skipPrevious: vi.fn(),
      startRadioStation: vi.fn(),
      setShuffle: vi.fn(),
      setRepeat: vi.fn(),
      primeUserGesture: vi.fn(),
      playTrack: vi.fn(() => Promise.resolve()),
      addToQueue: vi.fn(),
      getSnapshot: () => ({ currentTrack: current, shuffle: false, repeat: "off", playbackContext: null }),
    },
    settings: { openSettings: vi.fn(), openSettingsSection: vi.fn() },
    history: { items: [] as { id: string; type: string; title: string }[], addItem: vi.fn() },
  };
});

vi.mock("../../ports/i18n", () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, string>) =>
      Object.entries(vars ?? {}).reduce((text, [name, value]) => text.replace(`{${name}}`, value), mocks.EN[key] ?? key),
  }),
  getTranslationsForAllLocales: (key: string) => (mocks.EN[key] ? [mocks.EN[key]] : []),
  loadAllLocales: () => Promise.resolve(),
}));
vi.mock("../../ports/player", () => ({
  playerEngine: mocks.engine,
  usePlayerStore: Object.assign((select: (state: typeof mocks.player) => unknown) => select(mocks.player), { getState: () => mocks.player }),
  nextRepeatMode: () => "all",
  isRadioContext: () => false,
}));
vi.mock("../../ports/navigation", async () => {
  const { create } = await import("zustand");
  const useModalStore = create<{ searchOpen: boolean; openSearch(): void; closeSearch(): void } & typeof mocks.settings>((set) => ({
    searchOpen: false,
    openSearch: () => set({ searchOpen: true }),
    closeSearch: () => set({ searchOpen: false }),
    ...mocks.settings,
  }));
  return { useModalStore, toggleWindowFullscreen: () => undefined };
});
vi.mock("../../ports/library", () => ({
  useLikedTracks: () => ({ data: { tracks: [] } }),
  usePlaylistsList: () => ({ data: { playlists: [] } }),
}));
vi.mock("../../ports/network", () => ({ useOfflineMode: () => false, useStreamingReachable: () => true }));
vi.mock("../../ports/search", () => ({
  useSearchAll: (query: string) => ({ items: query.trim() === "lorde" ? mocks.catalog : [], loading: false, hasLoaded: true, runNow: () => undefined }),
  toSearchResult: (item: unknown) => item,
  useSearchHistoryStore: (select: (state: typeof mocks.history) => unknown) => select(mocks.history),
  loadSearchHistory: () => Promise.resolve(),
  normalizeForSearch: (text: string) => text.toLowerCase(),
  filterTracks: () => [],
  songResult: () => null,
}));
vi.mock("../settings/settingItems", () => ({
  SETTING_ITEMS: [{ tabId: "Appearance", titleKey: "settings.cover_glow.title" }],
}));
vi.mock("../../ports/shortcuts", () => {
  const bindings: Record<string, string> = {
    "player.toggle": "Space",
    "player.next": "Control+Right",
    "player.previous": "Control+Left",
    "nav.search": "/",
    "nav.lyrics": "F",
  };
  return {
    useShortcutBindings: () => (id: string) => bindings[id] ?? null,
    useRecorderState: () => ({ kind: "idle" }),
    shortcutKeycaps: (accelerator: string) => accelerator.split("+").map((text) => ({ text, label: text })),
  };
});

let root: Root;
let host: HTMLDivElement;

function Where() {
  const location = useLocation();
  return <output data-testid="where">{location.pathname + location.search}</output>;
}

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  vi.clearAllMocks();
  act(() =>
    root.render(
      <MemoryRouter>
        <PaletteField />
        <Where />
      </MemoryRouter>,
    ),
  );
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');
const input = () => host.querySelector<HTMLInputElement>("input")!;
const options = () => [...dialog()!.querySelectorAll('[role="option"]')].map((row) => row.textContent);
const groups = () => [...dialog()!.querySelectorAll('[role="group"]')].map((group) => group.getAttribute("aria-label"));
const where = () => host.querySelector("[data-testid=where]")!.textContent;

function ctrlK() {
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", code: "KeyK", ctrlKey: true, bubbles: true }));
  });
}

function press(key: string, shiftKey = false) {
  act(() => {
    input().dispatchEvent(new KeyboardEvent("keydown", { key, code: key, shiftKey, bubbles: true }));
  });
}

function type(value: string) {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(input(), value);
    input().dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function settle() {
  await act(() => new Promise((resolve) => setTimeout(resolve, 300)));
}

describe("PaletteField", () => {
  it("opens under the field on Ctrl+K with the field focused and closes on Escape", async () => {
    expect(dialog()).toBeNull();
    expect(input().placeholder).toBe("Search songs, artists or paste a link");
    ctrlK();
    expect(dialog()).not.toBeNull();
    expect(document.activeElement).toBe(input());
    expect(input().getAttribute("aria-expanded")).toBe("true");
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    await settle();
    expect(dialog()).toBeNull();
  });

  it("opens when the field takes focus", () => {
    act(() => input().focus());
    expect(dialog()).not.toBeNull();
  });

  it("suggests five commands with their shortcuts as keycaps before anything is typed", () => {
    ctrlK();
    expect(groups()).toEqual(["Suggested"]);
    expect(options()).toEqual(["Play or pauseSpace", "Open lyricsF", "Search/", "Next trackControlRight", "Open Settings"]);
  });

  it("runs the second command on ArrowDown then Enter and closes", async () => {
    ctrlK();
    press("ArrowDown");
    press("Enter");
    expect(mocks.player.setFullscreen).toHaveBeenCalledWith(true);
    expect(mocks.engine.togglePlayPause).not.toHaveBeenCalled();
    await settle();
    expect(dialog()).toBeNull();
  });

  it("finds a settings entry among the actions and opens its section", () => {
    ctrlK();
    type("cover");
    expect(options()[0]).toBe("Settings: Cover glow");
    press("Enter");
    expect(mocks.settings.openSettingsSection).toHaveBeenCalledWith("Appearance");
  });

  it("shows the top result, songs and albums, plays a song on Enter and queues it on Shift Enter", () => {
    ctrlK();
    type("lorde");
    expect(groups()).toEqual(["Top result", "Songs", "Playlists and albums"]);
    expect(dialog()!.querySelector("[data-top]")!.textContent).toContain("Lorde");
    press("ArrowDown");
    press("Enter", true);
    expect(mocks.engine.addToQueue).toHaveBeenCalledWith(expect.objectContaining({ id: "s1" }));
    ctrlK();
    type("lorde");
    press("ArrowDown");
    press("Enter");
    expect(mocks.engine.playTrack).toHaveBeenCalledWith(expect.objectContaining({ id: "s1" }), [expect.objectContaining({ id: "s1" })], "search");
    expect(mocks.history.addItem).toHaveBeenCalledWith(expect.objectContaining({ id: "s1", type: "track" }));
  });

  it("points the field at the selected row for assistive tech", () => {
    ctrlK();
    type("lorde");
    press("ArrowDown");
    const id = input().getAttribute("aria-activedescendant")!;
    expect(document.getElementById(id)!.textContent).toContain("Liability");
    expect(document.getElementById(input().getAttribute("aria-controls")!)!.getAttribute("role")).toBe("listbox");
  });

  it("jumps to the next section on Tab", () => {
    ctrlK();
    type("lorde");
    press("Tab");
    expect(dialog()!.querySelector("[data-selected]")!.textContent).toContain("Liability");
    press("Tab");
    expect(dialog()!.querySelector("[data-selected]")!.textContent).toContain("Melodrama");
  });

  it("ends with every result on the search page", () => {
    ctrlK();
    type("lorde");
    expect(options().at(-1)).toContain("ui.palette.show_all");
    press("ArrowUp");
    press("Enter");
    expect(where()).toBe("/search?q=lorde");
  });

  it("says so when nothing matches", () => {
    ctrlK();
    type("zzz");
    expect(dialog()!.textContent).toContain("Nothing found for “zzz”.");
  });

  it("sends a pasted link to the search page", () => {
    ctrlK();
    act(() => {
      const paste = new Event("paste", { bubbles: true }) as Event & { clipboardData: { getData(): string } };
      paste.clipboardData = { getData: () => "https://youtu.be/abcdefghijk" };
      input().dispatchEvent(paste);
    });
    expect(where()).toBe(`/search?link=1&q=${encodeURIComponent("https://youtu.be/abcdefghijk")}`);
  });

  it("toggles closed on a second Ctrl+K", async () => {
    ctrlK();
    ctrlK();
    await settle();
    expect(dialog()).toBeNull();
  });

  it("never opens while the library is locked and closes when it locks", async () => {
    useGateStore.setState({ locked: true });
    ctrlK();
    expect(dialog()).toBeNull();
    useGateStore.setState({ locked: false });
    ctrlK();
    expect(dialog()).not.toBeNull();
    act(() => useGateStore.setState({ locked: true }));
    await settle();
    expect(dialog()).toBeNull();
    useGateStore.setState({ locked: false });
  });
});
