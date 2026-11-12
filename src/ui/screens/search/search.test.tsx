// @vitest-environment jsdom
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation, useNavigate, type NavigateFunction } from "react-router-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { encodeShare } from "@/links/shareCodec";
import { useToastStore } from "../../feedback/toastStore";
import { useSearchHistoryStore } from "../../ports/search";
import { useImportsUi } from "../imports/importsUi";
import { Search } from "./Search";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => {
  const track = (id: string, title: string, artists: string) => ({ id, title, artists, coverUrl: "", durationMs: 200_000, playCount: 0 });
  const ytTrack = (id: string, title: string) => ({ kind: "track", id, title, artists: [{ id: "q", name: "Queen" }], durationMs: 200_000, explicit: false });
  return {
    track,
    ytTrack,
    state: { online: true, offlineMode: false, browserOnline: null as boolean | null },
    liked: [track("l1", "Bohemian Rhapsody", "Queen"), track("l2", "Ёлка", "Звери")],
    search: vi.fn(),
    scSearch: vi.fn(),
    startImport: vi.fn(),
    engine: {
      playTrack: vi.fn(() => Promise.resolve()),
      primeUserGesture: vi.fn(),
      playNext: vi.fn(),
      addToQueue: vi.fn(),
      startRadioStation: vi.fn(),
    },
  };
});

vi.mock("@/youtubeBoot", () => ({ getYoutube: () => ({ catalog: { search: mocks.search } }) }));
vi.mock("../../ports/i18n", () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, string | number>) => (vars ? `${key}(${Object.values(vars).join(",")})` : key),
  }),
}));
vi.mock("../../ports/covers", () => ({ coverSrc: (src: string) => src }));
vi.mock("../../ports/network", () => ({
  useStreamingReachable: () => mocks.state.online,
  useOnline: () => mocks.state.browserOnline ?? mocks.state.online,
  useOfflineMode: () => mocks.state.offlineMode,
}));
vi.mock("@/data/search/soundcloudSearch", async () => {
  const { useSearch } = await import("@/data/search/catalogSearch");
  return { useSoundCloudSearch: (query: string, options: object) => useSearch(query, mocks.scSearch, options) };
});
vi.mock("../../ports/catalog", () => ({ useCachedTrackIds: () => null }));
vi.mock("../../ports/player", () => ({
  playerEngine: mocks.engine,
  isSoundCloudId: (id: string) => id.startsWith("sc:"),
  usePlayerStore: (select: (state: { currentTrack: null }) => unknown) => select({ currentTrack: null }),
}));
vi.mock("../../ports/links", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../ports/links")>();
  return {
    ...original,
    createLinkPorts: (catalog: Parameters<typeof original.createLinkPorts>[0]) => ({
      ...original.createLinkPorts(catalog),
      startImport: mocks.startImport,
    }),
    youtubeCatalog: {
      searchTracks: async () => [],
      track: async (id: string) =>
        id === "gone0000000" ? null : { id, title: "Never Gonna Give You Up", artists: [{ id: "", name: "Rick Astley" }], durationMs: 213_000 },
    },
  };
});
vi.mock("../../ports/library", () => ({
  useLikedTracks: () => ({ data: { tracks: mocks.liked, total: 2 }, isLoading: false }),
  usePlaylistsList: () => ({ data: { playlists: [], total: 0 }, isLoading: false }),
  useIsTrackLiked: () => false,
  useLikeTrack: () => ({ mutate: vi.fn() }),
  useUnlikeTrack: () => ({ mutate: vi.fn() }),
}));

let root: Root | null = null;
let host: HTMLDivElement;
const seen: { location: string; navigate?: NavigateFunction } = { location: "" };
beforeAll(async () => {
  // jsdom lacks the compression streams Chromium has; Node's are the same implementation family
  const web = await import("node:stream/web");
  globalThis.CompressionStream ??= web.CompressionStream as unknown as typeof CompressionStream;
  globalThis.DecompressionStream ??= web.DecompressionStream as unknown as typeof DecompressionStream;
});

let mockHistoryAdd: ReturnType<typeof vi.spyOn>;
// each test starts minutes after the last, past the minute a left query is kept
let clock = Date.now();

function LocationProbe() {
  const current = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    seen.navigate = navigate;
    seen.location = current.pathname + current.search;
  });
  return null;
}

beforeEach(() => {
  clock += 10 * 60_000;
  vi.useFakeTimers({ now: clock });
  localStorage.clear();
  useSearchHistoryStore.setState({ items: [] });
  mockHistoryAdd = vi.spyOn(useSearchHistoryStore.getState(), "addItem");
  mocks.search.mockReset();
  mocks.search.mockReturnValue(new Promise(() => undefined));
  mocks.scSearch.mockReset();
  mocks.scSearch.mockResolvedValue([]);
  host = document.createElement("div");
  document.body.append(host);
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host.remove();
  document.body.innerHTML = "";
  vi.clearAllMocks();
  vi.useRealTimers();
  mocks.state.online = true;
  mocks.state.offlineMode = false;
  mocks.state.browserOnline = null;
});

function renderSearch(entry = "/search") {
  root = createRoot(host);
  act(() =>
    root!.render(
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/search" element={<Search />} />
          <Route path="*" element={null} />
        </Routes>
        <LocationProbe />
      </MemoryRouter>,
    ),
  );
}

const field = () => host.querySelector("input")!;
const text = () => host.textContent ?? "";
const button = (name: string) => [...host.querySelectorAll("button")].find((node) => node.textContent === name || node.getAttribute("aria-label") === name)!;
const rowTitles = () => [...host.querySelectorAll('[role="button"] > span:nth-child(2) > span:first-child')].map((node) => node.textContent);
const progress = () => host.querySelector('[role="progressbar"]');

function typeInto(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function pasteInto(input: HTMLInputElement, value: string) {
  const paste = new Event("paste", { bubbles: true });
  Object.assign(paste, { clipboardData: { getData: () => value } });
  act(() => {
    input.dispatchEvent(paste);
  });
  typeInto(input, value);
}

async function settle(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
    await Promise.resolve();
  });
  await act(async () => {
    await Promise.resolve();
  });
}

describe("Search", () => {
  it("focuses the field on arrival and keeps ?q= in step with it", () => {
    renderSearch();
    expect(document.activeElement).toBe(field());
    typeInto(field(), "queen");
    expect(seen.location).toBe("/search?q=queen");
    typeInto(field(), "");
    expect(seen.location).toBe("/search");
  });

  it("starts from ?q= in the URL", () => {
    renderSearch("/search?q=abba");
    expect(field().value).toBe("abba");
  });

  it("keeps a query for a minute after leaving search", () => {
    renderSearch();
    typeInto(field(), "abba");
    act(() => root!.unmount());
    vi.advanceTimersByTime(59_000);
    renderSearch();
    expect(field().value).toBe("abba");
    act(() => root!.unmount());
    vi.advanceTimersByTime(61_000);
    renderSearch();
    expect(field().value).toBe("");
  });

  it("lists recent searches; remove and Clear history change the store", () => {
    useSearchHistoryStore.setState({
      items: [
        { id: "query:abba", type: "query", title: "abba", timestamp: 2 },
        { id: "t1", type: "track", title: "Dancing Queen", subtitle: "ABBA", timestamp: 1 },
      ],
    });
    renderSearch();
    expect(text()).toContain("ui.search.recent");
    expect(rowTitles()).toEqual(["abba", "Dancing Queen"]);

    act(() => button("ui.search.remove").click());
    expect(useSearchHistoryStore.getState().items.map((item) => item.id)).toEqual(["t1"]);
    expect(rowTitles()).toEqual(["Dancing Queen"]);

    act(() => button("ui.search.clear_history").click());
    expect(useSearchHistoryStore.getState().items).toEqual([]);
    expect(text()).toContain("ui.search.hint");
  });

  it("says so when a search finds nothing", async () => {
    mocks.search.mockResolvedValue([]);
    renderSearch();
    typeInto(field(), "zzqxv");
    await settle(320);
    expect(mocks.search).toHaveBeenCalledWith("zzqxv", "all", expect.any(AbortSignal));
    expect(text()).toContain("ui.search.none(zzqxv)");
  });

  it("offline, says so under the field and searches the library only", () => {
    mocks.state.online = false;
    renderSearch();
    expect(text()).toContain("ui.search.offline");
    typeInto(field(), "queen");
    vi.advanceTimersByTime(1000);
    expect(mocks.search).not.toHaveBeenCalled();
    expect(rowTitles()).toContain("Bohemian Rhapsody");
  });

  it("offline mode: asks the catalog nothing even with a network, and searches the library only", () => {
    mocks.state.offlineMode = true;
    renderSearch();
    expect(text()).toContain("ui.search.offline_mode");
    typeInto(field(), "queen");
    vi.advanceTimersByTime(1000);
    expect(mocks.search).not.toHaveBeenCalled();
    expect(rowTitles()).toContain("Bohemian Rhapsody");
  });

  it("shows the progress line once a search has run 300 ms", () => {
    renderSearch();
    typeInto(field(), "queen");
    act(() => vi.advanceTimersByTime(299));
    expect(progress()).toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(progress()).not.toBeNull();
  });

  it("draws placeholder rows while a query is in flight, then the results in their place", async () => {
    let answer!: (items: unknown[]) => void;
    mocks.search.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    renderSearch();
    typeInto(field(), "q");
    expect(host.querySelector("[data-placeholder]")).toBeNull();
    typeInto(field(), "queen");
    expect(host.querySelectorAll("[data-placeholder] > *")).toHaveLength(5);
    await settle(320);
    await act(async () => answer([mocks.ytTrack("s1", "Bohemian Rhapsody")]));
    expect(host.querySelector("[data-placeholder]")).toBeNull();
    expect(rowTitles()).toContain("Bohemian Rhapsody");
  });

  it("fades the content in again on a tab change and keeps it in place for new rows of the same tab", async () => {
    mocks.search.mockResolvedValue([mocks.ytTrack("s1", "Bohemian Rhapsody")]);
    renderSearch();
    typeInto(field(), "queen");
    await settle(320);
    const results = host.querySelector("[data-swap]")!;
    expect(results.getAttribute("data-swap")).toBe("results");
    typeInto(field(), "queen live");
    expect(host.querySelector("[data-swap]")).toBe(results);
    act(() => button("ui.search.tab_songs").closest("button")!.click());
    expect(host.querySelector("[data-swap]")).not.toBe(results);
  });

  it("plays a song result alone and files it in the history", async () => {
    mocks.search.mockResolvedValue([mocks.ytTrack("s1", "Bohemian Rhapsody"), mocks.ytTrack("s2", "Under Pressure")]);
    renderSearch();
    typeInto(field(), "queen");
    await settle(320);
    expect(text()).toContain("ui.search.top");

    const song = [...host.querySelectorAll('[role="button"]')].find((row) => row.textContent?.includes("Under Pressure"))!;
    act(() => song.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    const [played, queue] = mocks.engine.playTrack.mock.calls[0] as unknown as [{ id: string }, { id: string }[]];
    expect(played.id).toBe("s2");
    expect(queue).toEqual([played]);
    expect(mockHistoryAdd).toHaveBeenCalledWith(expect.objectContaining({ id: "s2", type: "track" }));
  });

  it("paints the last results at once on a return, while it asks again", async () => {
    mocks.search.mockResolvedValue([mocks.ytTrack("s1", "Bohemian Rhapsody")]);
    renderSearch();
    typeInto(field(), "queen");
    await settle(320);
    act(() => root!.unmount());
    mocks.search.mockReturnValue(new Promise(() => undefined));
    renderSearch("/search?q=queen");
    expect(rowTitles()).toEqual(["Bohemian Rhapsody"]);
  });

  it("Enter files the query in the history", () => {
    renderSearch();
    typeInto(field(), "  queen ");
    act(() => field().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(mockHistoryAdd).toHaveBeenCalledWith({ id: "query:queen", type: "query", title: "queen" });
  });

  it("walks the rows with the arrow keys and returns to the field from the first", async () => {
    mocks.search.mockResolvedValue([mocks.ytTrack("s1", "Bohemian Rhapsody"), mocks.ytTrack("s2", "Under Pressure")]);
    renderSearch();
    typeInto(field(), "queen");
    await settle(320);
    const rows = [...host.querySelectorAll<HTMLElement>('[role="button"]')];
    const press = (target: Element, key: string) => act(() => target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true })));
    press(field(), "ArrowDown");
    expect(document.activeElement).toBe(rows[0]);
    press(rows[0], "ArrowDown");
    expect(document.activeElement).toBe(rows[1]);
    press(rows[1], "ArrowUp");
    press(rows[0], "ArrowUp");
    expect(document.activeElement).toBe(field());
  });
  it("a pasted link shows the link block, searches nothing and saves no history", async () => {
    renderSearch();
    pasteInto(field(), "https://youtu.be/dQw4w9WgXcQ");
    await settle(400);
    expect(host.querySelector('[aria-label="YouTube"]')).not.toBeNull();
    expect(text()).toContain("Never Gonna Give You Up");
    expect(text()).not.toContain("ui.search.tab_all");
    act(() => field().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    await settle(400);
    expect(mocks.search).not.toHaveBeenCalled();
    expect(mockHistoryAdd).not.toHaveBeenCalled();
  });

  it("a pasted playlist link opens the import sheet with that link", async () => {
    renderSearch();
    pasteInto(field(), "https://www.deezer.com/en/playlist/908622995");
    await settle(400);
    expect(useImportsUi.getState().sheet).toEqual({ initialLink: "https://www.deezer.com/en/playlist/908622995" });
    act(() => useImportsUi.getState().close());
  });

  it("Enter on a typed link opens the block too", async () => {
    renderSearch();
    typeInto(field(), "https://youtu.be/dQw4w9WgXcQ");
    act(() => field().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    await settle(400);
    expect(host.querySelector('[aria-label="YouTube"]')).not.toBeNull();
    expect(mockHistoryAdd).not.toHaveBeenCalled();
  });

  it("typing over the link returns to normal search", async () => {
    renderSearch();
    pasteInto(field(), "https://youtu.be/dQw4w9WgXcQ");
    typeInto(field(), "queen");
    expect(host.querySelector('[aria-label="YouTube"]')).toBeNull();
    await settle(320);
    expect(mocks.search).toHaveBeenCalledWith("queen", "all", expect.any(AbortSignal));
  });

  it("Escape closes the block and empties the field", async () => {
    renderSearch();
    pasteInto(field(), "https://youtu.be/dQw4w9WgXcQ");
    act(() => field().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(host.querySelector('[aria-label="YouTube"]')).toBeNull();
    expect(field().value).toBe("");
    await settle(400);
    expect(mocks.search).not.toHaveBeenCalled();
  });

  it("Down from the field enters the link's row and Up returns", async () => {
    renderSearch();
    pasteInto(field(), "https://youtu.be/dQw4w9WgXcQ");
    await settle(400);
    const row = host.querySelector<HTMLElement>('[aria-label="YouTube"] [role="button"]')!;
    const press = (target: Element, key: string) => act(() => target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true })));
    press(field(), "ArrowDown");
    expect(document.activeElement).toBe(row);
    press(row, "ArrowUp");
    expect(document.activeElement).toBe(field());
  });
});

describe("shared playlist links", () => {
  async function until<T>(find: () => T | undefined | null): Promise<T> {
    for (let i = 0; i < 100; i++) {
      const found = find();
      if (found) return found;
      await act(async () => new Promise((resolve) => setTimeout(resolve, 10)));
    }
    throw new Error("never appeared");
  }
  const dialog = () => document.querySelector('[role="dialog"]');
  const inDialog = (name: string) => [...(dialog()?.querySelectorAll("button") ?? [])].find((node) => node.textContent === name)!;

  async function mixLink(): Promise<string> {
    return `nuvo://share?id=${await encodeShare({
      title: "Mix",
      tracks: [
        { source: "youtube", id: "dQw4w9WgXcQ" },
        { source: "youtube", id: "gone0000000" },
        { source: "text", artist: "Кино", title: "Группа крови" },
      ],
    })}`;
  }

  it("a link from the inbox opens the preview; Import opens the new playlist and says what was left out", async () => {
    vi.useRealTimers();
    mocks.startImport.mockResolvedValue({ items: [{ id: "i1", label: "Mix", targetKind: "new", targetId: "pl1", status: "running", total: 2 }] });
    const link = await mixLink();
    renderSearch(`/search?link=1&q=${encodeURIComponent(link)}`);
    await until(dialog);
    expect(dialog()!.textContent).toContain("Mix");
    expect(field().value).toBe(link);
    expect(mocks.startImport).not.toHaveBeenCalled();
    await act(async () => inDialog("ui.links.preview.import").click());
    await until(() => seen.location === "/library/playlist?id=pl1");
    act(() => void seen.navigate!("/search"));
    expect(field().value).toBe("");
    expect(dialog()).toBeNull();
    expect(mocks.startImport).toHaveBeenCalledWith(expect.objectContaining({ source: "nuvo-link", target: { kind: "new" } }), expect.anything());
    expect(useToastStore.getState().queue.map((toast) => toast.message)).toContain("ui.links.preview.unreadable(1)");
  });

  it("a link that arrives while search is open replaces the query; Liked songs opens Liked songs", async () => {
    vi.useRealTimers();
    mocks.startImport.mockResolvedValue({ items: [{ id: "i2", label: "Mix", targetKind: "liked", status: "running", total: 2 }] });
    renderSearch();
    typeInto(field(), "queen");
    const link = await mixLink();
    act(() => void seen.navigate!(`/search?link=1&q=${encodeURIComponent(link)}`));
    await until(dialog);
    expect(field().value).toBe(link);
    act(() => inDialog("ui.links.preview.target_liked").click());
    await act(async () => inDialog("ui.links.preview.import").click());
    await until(() => seen.location === "/library/playlist?id=likes");
  });

  it("closing the preview drops the link", async () => {
    vi.useRealTimers();
    renderSearch(`/search?link=1&q=${encodeURIComponent(await mixLink())}`);
    await until(dialog);
    act(() => inDialog("common.cancel").click());
    await until(() => !dialog());
    expect(field().value).toBe("");
  });
});

describe("Search with SoundCloud", () => {
  const hits = () => [
    { track: mocks.track("sc:88335161", "Get Lucky [Original Version]", "DJ KB"), preview: false },
    { track: mocks.track("sc:254111945", "Get Lucky", "Daft Punk"), preview: true },
  ];
  const marks = () => host.querySelectorAll('[aria-label="ui.search.from_soundcloud"]').length;
  const tabs = (label: string) => [...host.querySelectorAll(`[role="tablist"][aria-label="${label}"] [role="tab"]`)].map((tab) => tab.textContent);
  const sourcePill = () => host.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')!;
  const chooseSource = (id: string) => {
    act(() => sourcePill().click());
    const item = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((node) => node.textContent === `ui.search.source_${id}`)!;
    act(() => item.click());
  };

  it("lists SoundCloud songs in their own group, marked, with previews named", async () => {
    mocks.search.mockResolvedValue([mocks.ytTrack("s1", "Get Lucky")]);
    mocks.scSearch.mockResolvedValue(hits());
    renderSearch();
    typeInto(field(), "get lucky");
    await settle(320);
    expect(mocks.scSearch).toHaveBeenCalledWith("get lucky", expect.any(AbortSignal));
    expect(host.querySelector('[aria-label="ui.search.source_soundcloud"]')?.textContent).toContain("Get Lucky [Original Version]");
    expect(marks()).toBe(2);
    expect(host.querySelectorAll('[title="ui.search.preview_hint"]')).toHaveLength(1);
    expect(sourcePill().getAttribute("aria-label")).toBe("ui.search.sources: ui.search.source_all");
  });

  it("the SoundCloud source asks SoundCloud only, offers its kinds only and plays its tracks", async () => {
    mocks.search.mockResolvedValue([mocks.ytTrack("s1", "Get Lucky")]);
    mocks.scSearch.mockResolvedValue(hits());
    renderSearch();
    typeInto(field(), "get lucky");
    act(() => button("ui.search.tab_artists").click());
    chooseSource("soundcloud");
    await settle(320);
    expect(mocks.search).not.toHaveBeenCalled();
    expect(tabs("ui.search.tabs")).toEqual(["ui.search.tab_all", "ui.search.tab_songs"]);
    expect(sourcePill().getAttribute("aria-label")).toBe("ui.search.sources: ui.search.source_soundcloud");
    expect(rowTitles()).toHaveLength(2);
    expect(rowTitles()[0]).toBe("Get Lucky [Original Version]");
    const row = [...host.querySelectorAll('[role="button"]')].find((node) => node.textContent?.includes("[Original Version]"))!;
    act(() => row.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect((mocks.engine.playTrack.mock.calls[0] as unknown as [{ id: string }])[0].id).toBe("sc:88335161");
  });

  it("the YouTube source never asks SoundCloud", async () => {
    mocks.search.mockResolvedValue([mocks.ytTrack("s1", "Get Lucky")]);
    renderSearch();
    typeInto(field(), "get lucky");
    chooseSource("youtube");
    await settle(320);
    expect(mocks.scSearch).not.toHaveBeenCalled();
    expect(marks()).toBe(0);
  });

  it("still finds SoundCloud songs when YouTube cannot be reached", async () => {
    mocks.state.online = false;
    mocks.state.browserOnline = true;
    mocks.scSearch.mockResolvedValue(hits());
    renderSearch();
    typeInto(field(), "get lucky");
    await settle(320);
    expect(text()).not.toContain("ui.search.offline");
    expect(marks()).toBe(2);
  });
});
