// @vitest-environment jsdom
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { notifyLibraryChanged } from "../../ports/library";
import { Library } from "./Library";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => {
  const store = <T extends object>(state: T) => Object.assign((select: (value: T) => unknown) => select(state), { getState: () => state });
  const modal = { openRemoveFromLibrary: vi.fn(), openCreatePlaylist: vi.fn() };
  const pins = { pins: [] as { kind: string; id: string }[], pin: vi.fn(), unpin: vi.fn() };
  const external = (kind: "album" | "artist", id: string, title: string, addedAt: string, creator?: string) => ({
    id,
    title,
    subtitle: "",
    imageUrl: "",
    kind,
    href: `/${kind}?id=${id}`,
    addedAt,
    creator,
    trackCount: kind === "album" ? 10 : undefined,
  });
  return {
    modal,
    pins,
    likedTracks: vi.fn(),
    share: vi.fn(),
    useModalStore: store(modal),
    useHomePinsStore: store(pins),
    playlists: [
      { id: "p1", title: "Morning", trackCount: 24, coverUrl: "", coverUrls: [], updatedAt: "2026-01-01T00:00:00Z", createdAt: "", revision: 1 },
      { id: "p2", title: "Late night drive", trackCount: 300, coverUrl: "", coverUrls: [], updatedAt: "2026-01-03T00:00:00Z", createdAt: "", revision: 1 },
    ],
    albums: [
      external("album", "a1", "Album B", "2026-01-04T00:00:00Z", "Velvet Hour"),
      external("album", "a2", "Album A", "2026-01-02T00:00:00Z", "Northern Lights"),
    ],
    artists: [external("artist", "r1", "Мурашки", "2026-01-05T00:00:00Z")],
    // per-test overrides of what the library holds and how its load went
    summaries: [] as unknown[],
    dismiss: vi.fn(() => Promise.resolve()),
    state: { empty: false, liked: 40, loading: false, error: undefined as unknown, albumsLoaded: true, albumsError: undefined as unknown },
  };
});

import { useImportsUi } from "../imports/importsUi";

vi.mock("../../ports/importsRuntime", () => ({
  useImportSummaries: () => mocks.summaries,
  getImports: () => ({ session: { dismiss: mocks.dismiss, getSnapshot: () => mocks.summaries } }),
}));
vi.mock("../../ports/i18n", async () => {
  const { default: en } = await import("../../../i18n/locales/en.json");
  const { flattenTexts } = await import("../../../i18n/text");
  const texts = flattenTexts(en);
  return {
    useTranslation: () => ({
      // tabs and the filter are built from the tab id, so they read the real text: a missing key shows up here
      t: (key: string, vars?: Record<string, string | number>) => {
        if (/^(ui\.library\.tab_|library\.search_)/.test(key)) return texts.get(key) ?? `missing ${key}`;
        return vars ? `${key}(${Object.values(vars).join(",")})` : key;
      },
    }),
  };
});
vi.mock("../../ports/covers", () => ({ coverSrc: (src: string) => src }));
vi.mock("../../ports/backdrop", () => ({ usePageBackdrop: vi.fn() }));
vi.mock("../local/LocalFiles", () => ({ LocalFiles: () => <p>local files</p> }));
vi.mock("../../ports/exports", () => ({ useDownloadProgress: () => null, saveAsFiles: vi.fn(), exportDocument: vi.fn(), cancelSaves: vi.fn() }));
vi.mock("../../ports/player", () => ({
  usePlayerStore: (select: (state: { playbackContext: string | null }) => unknown) => select({ playbackContext: null }),
}));
vi.mock("../../ports/library", () => ({
  useRecentlyDeleted: (select: (state: { items: unknown[] }) => unknown) => select({ items: [] }),
  restoreDeleted: vi.fn(),
  usePlaylistsList: () => ({
    data: { playlists: mocks.state.empty ? [] : mocks.playlists, total: 2 },
    isLoading: mocks.state.loading,
    error: mocks.state.error,
  }),
  useExternalItems: (type: string) => ({
    data: mocks.state.empty ? [] : type === "album" ? mocks.albums : type === "artist" ? mocks.artists : [],
    loaded: type === "album" ? mocks.state.albumsLoaded : true,
    error: type === "album" ? mocks.state.albumsError : undefined,
  }),
  useYoutubeLibraryItems: () => [],
  useLikedTrackCount: () => ({ data: mocks.state.liked, isLoading: false }),
  useLikesCover: () => "likes.svg",
  notifyLibraryChanged: vi.fn(),
  useModalStore: mocks.useModalStore,
  useHomePinsStore: mocks.useHomePinsStore,
  useRailPinsStore: mocks.useHomePinsStore,
  playLibraryEntry: vi.fn(),
  likedTracks: mocks.likedTracks,
}));
vi.mock("../../sheets/ShareSheet", () => ({
  useShareSheet: { getState: () => ({ show: mocks.share }) },
  shareItemOf: (track: { id: string; title: string }) => ({ id: track.id, title: track.title }),
}));

let root: Root | null = null;
let host: HTMLDivElement;

beforeEach(() => {
  localStorage.clear();
  // rows are easier to read back than tiles; the default (covers) has its own test
  localStorage.setItem("nuvo_library_view_mode", "list");
  host = document.createElement("div");
  document.body.append(host);
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host.remove();
  document.body.innerHTML = "";
  vi.clearAllMocks();
  mocks.summaries = [];
  mocks.state = { empty: false, liked: 40, loading: false, error: undefined, albumsLoaded: true, albumsError: undefined };
});

function render() {
  root = createRoot(host);
  act(() =>
    root!.render(
      <MemoryRouter initialEntries={["/library"]}>
        <Library />
      </MemoryRouter>,
    ),
  );
}

const titles = () => [...host.querySelectorAll('[role="button"] > span:nth-child(2) > span:first-child')].map((node) => node.textContent);
const button = (name: string) =>
  [...document.querySelectorAll("button")].find((node) => node.textContent === name || node.getAttribute("aria-label") === name)!;
const menuLabels = () => [...document.querySelectorAll('[role="menuitem"]')].map((node) => node.textContent);
const click = (node: Element) => act(() => (node as HTMLElement).click());
const text = () => host.textContent ?? "";

function type(value: string) {
  const input = host.querySelector("input")!;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("Library", () => {
  it("shows the kinds of the selected tab, Liked songs first where it belongs", () => {
    render();
    expect(titles()).toEqual(["ui.library.liked", "Мурашки", "Album B", "Late night drive", "Album A", "Morning"]);
    click(button("Albums"));
    expect(titles()).toEqual(["Album B", "Album A"]);
    click(button("Artists"));
    expect(titles()).toEqual(["Мурашки"]);
    click(button("Playlists"));
    expect(titles()).toEqual(["ui.library.liked", "Late night drive", "Morning"]);
  });

  it("the On this computer tab shows the files view without the cover and row toggles", () => {
    render();
    click(button("On this computer"));
    expect(host.textContent).toContain("local files");
    expect(host.querySelector("input")?.placeholder).toBe("Search your files");
    expect(host.querySelector('[aria-label="ui.library.view_grid"]')).toBeNull();
  });

  it("the header's More menu opens the listening history, saves liked songs and exports the library", () => {
    render();
    click(button("ui.export.more"));
    expect(menuLabels()).toEqual([
      "ui.history.title",
      "ui.library.recently_deleted",
      "ui.export.save_files",
      "ui.export.library_json",
      "ui.export.library_csv",
    ]);
  });

  it("starts as covers and remembers the choice", () => {
    localStorage.clear();
    render();
    expect(button("ui.library.view_grid").getAttribute("aria-pressed")).toBe("true");
    click(button("ui.library.view_list"));
    expect(localStorage.getItem("nuvo_library_view_mode")).toBe("list");
    expect(button("ui.library.view_list").getAttribute("aria-pressed")).toBe("true");
    click(button("ui.library.view_grid"));
    expect(button("ui.library.view_grid").getAttribute("aria-pressed")).toBe("true");
    expect(localStorage.getItem("nuvo_library_view_mode")).toBe("grid");
    expect(host.querySelectorAll('[role="button"]')).toHaveLength(0);
    act(() => root!.unmount());
    render();
    expect(button("ui.library.view_grid").getAttribute("aria-pressed")).toBe("true");
  });

  it("lists newest first, sorts per tab from the sort menu and remembers each tab's order", () => {
    render();
    click(button("Albums"));
    expect(titles()).toEqual(["Album B", "Album A"]);
    const sortButton = () => host.querySelector<HTMLButtonElement>('[aria-label^="ui.library.sort.label"]')!;
    expect(sortButton().getAttribute("aria-label")).toBe("ui.library.sort.label(ui.library.sort.added)");
    click(sortButton());
    expect(menuLabels()).toEqual(["added", "title", "artist", "played", "plays"].map((key) => `ui.library.sort.${key}`));
    click(button("ui.library.sort.title"));
    expect(titles()).toEqual(["Album A", "Album B"]);
    click(button("All"));
    expect(titles()[0]).toBe("ui.library.liked");
    expect(sortButton().getAttribute("aria-label")).toBe("ui.library.sort.label(ui.library.sort.added)");
    expect(JSON.parse(localStorage.getItem("nuvo_library_sort_v1")!)).toEqual({ albums: "title" });
  });

  it("offers Delete playlist for an own playlist and Remove from library for a saved album", () => {
    render();
    const more = () => [...host.querySelectorAll('button[aria-label="ui.library.more"]')];
    // rows in All: liked has a menu too, so the own playlist "Late night drive" is the fourth row
    click(more()[3]);
    expect(menuLabels()).toEqual(["ui.library.open", "ui.library.play", "ui.library.pin", "ui.library.pin_rail", "ui.library.delete_playlist"]);
    click(button("ui.library.delete_playlist"));
    expect(mocks.modal.openRemoveFromLibrary).toHaveBeenCalledWith(expect.objectContaining({ id: "p2", isOwned: true }));

    click(more()[2]);
    expect(menuLabels()).toEqual(["ui.library.open", "ui.library.play", "ui.library.pin", "ui.library.pin_rail", "ui.library.remove"]);
    click(button("ui.library.pin"));
    expect(mocks.pins.pin).toHaveBeenCalledWith(expect.objectContaining({ id: "a1", kind: "album" }));
    click(more()[2]);
    click(button("ui.library.remove"));
    expect(mocks.modal.openRemoveFromLibrary).toHaveBeenCalledWith(expect.objectContaining({ id: "a1", type: "album", isOwned: false }));
  });
});

describe("Library imports", () => {
  const running = { id: "i1", status: "running", targetId: "p2", total: 3700, done: 340 };

  it("a playlist whose import runs reads its percent, and a finished one reads its count", () => {
    mocks.summaries = [running];
    render();
    expect(text()).toContain("ui.library.importing(9)");
    expect(text()).not.toContain("ui.library.importing(0)");
    act(() => root!.unmount());
    mocks.summaries = [{ ...running, status: "done" }];
    render();
    expect(text()).not.toContain("ui.library.importing");
  });

  it("the running row's menu offers only Cancel import, which stops and removes it", () => {
    mocks.summaries = [running];
    render();
    const more = [...host.querySelectorAll('button[aria-label="ui.library.more"]')];
    // liked, artist, album, then the importing playlist
    click(more[3]);
    expect(menuLabels()).toEqual(["ui.library.cancel_import"]);
    click(button("ui.library.cancel_import"));
    expect(mocks.dismiss).toHaveBeenCalledWith("i1");
  });

  it("opening a running row does not navigate away", () => {
    mocks.summaries = [running];
    render();
    const row = [...host.querySelectorAll<HTMLElement>('[role="button"]')].find((node) => node.textContent?.includes("Late night drive"))!;
    expect(row.hasAttribute("data-importing")).toBe(true);
  });
});

describe("Library states", () => {
  it("an empty library explains itself and offers Create playlist and Import", () => {
    mocks.state.empty = true;
    mocks.state.liked = 0;
    render();
    expect(text()).toContain("ui.library.empty_title");
    expect(text()).toContain("ui.library.empty_message");
    click(button("ui.library.create_playlist"));
    expect(mocks.modal.openCreatePlaylist).toHaveBeenCalled();
    click(button("ui.library.import"));
    expect(useImportsUi.getState().sheet).toEqual({});
    act(() => useImportsUi.getState().close());
    expect(titles()).toEqual([]);
  });

  it("an empty tab names what it is missing in one line", () => {
    mocks.state.empty = true;
    render();
    click(button("Albums"));
    expect(text()).toContain("ui.library.empty_albums");
    click(button("Artists"));
    expect(text()).toContain("ui.library.empty_artists");
    expect(text()).not.toContain("ui.library.empty_title");
  });

  it("a filter with no match says so and Clear filter empties the field", () => {
    render();
    type("zzz");
    expect(text()).toContain("ui.library.no_match(zzz)");
    expect(titles()).toEqual([]);
    click(button("ui.library.clear_filter"));
    expect(host.querySelector("input")!.value).toBe("");
    expect(titles()).toHaveLength(6);
    expect(document.activeElement).toBe(host.querySelector("input"));
  });

  it("shows placeholders shaped like the view while any part of the library is still loading", () => {
    mocks.state.albumsLoaded = false;
    render();
    expect(titles()).toEqual([]);
    expect(text()).not.toContain("ui.library.empty_title");
    expect(host.querySelectorAll("[data-placeholder=row]").length).toBeGreaterThan(0);
    act(() => root!.unmount());
    localStorage.setItem("nuvo_library_view_mode", "grid");
    render();
    expect(host.querySelectorAll("[data-placeholder=tile]").length).toBeGreaterThan(0);
  });

  it("a failed load with nothing to show explains it and retries", () => {
    mocks.state.empty = true;
    mocks.state.liked = 0;
    mocks.state.error = new Error("core down");
    render();
    expect(text()).toContain("ui.library.load_error_title");
    expect(text()).not.toContain("ui.library.empty_title");
    click(button("ui.library.retry"));
    expect(notifyLibraryChanged).toHaveBeenCalled();
  });

  it("a failed saved-items source with nothing else shows the error, not the empty library", () => {
    mocks.state.empty = true;
    mocks.state.liked = 0;
    mocks.state.albumsError = new Error("core down");
    render();
    expect(text()).toContain("ui.library.load_error_title");
    expect(text()).not.toContain("ui.library.empty_title");
    click(button("ui.library.retry"));
    expect(notifyLibraryChanged).toHaveBeenCalled();
  });

  it("a failed refresh keeps the rows and offers a retry above them", () => {
    mocks.state.error = new Error("core down");
    render();
    expect(titles()).toHaveLength(6);
    expect(text()).toContain("ui.library.load_error_line");
    expect(button("ui.library.retry")).toBeTruthy();
  });

  it("shares Liked songs from its row menu with every liked track", async () => {
    mocks.likedTracks.mockResolvedValue([
      { id: "t1", title: "One" },
      { id: "t2", title: "Two" },
    ]);
    render();
    click([...host.querySelectorAll('button[aria-label="ui.library.more"]')][0]);
    expect(menuLabels()).toEqual(["ui.library.open", "ui.library.play", "ui.links.share.title"]);
    await act(async () => button("ui.links.share.title").click());
    expect(mocks.share).toHaveBeenCalledWith("ui.library.liked", [
      { id: "t1", title: "One" },
      { id: "t2", title: "Two" },
    ]);
  });
});
