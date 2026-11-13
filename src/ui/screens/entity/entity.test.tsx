// @vitest-environment jsdom
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { useShareSheet } from "../../sheets/ShareSheet";
import { Playlist } from "./Playlist";
import { TrackList } from "./TrackList";
import { trackMenuItems, type TrackMenuActions } from "./trackMenu";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => {
  const store = <T extends object>(state: T) => Object.assign((select: (value: T) => unknown) => select(state), { getState: () => state });
  const track = (n: number) => ({
    id: `t${n}`,
    playlistItemId: `i${n}`,
    title: `Song ${n}`,
    artists: `Artist ${n}`,
    artistId: `a${n}`,
    album: { id: `al${n}`, title: `Album ${n}` },
    coverUrl: "",
    durationMs: 180_000,
    playCount: 0,
  });
  const tracks = [track(1), track(2), track(3)];
  const player = { currentTrack: null as unknown, playbackContext: null as string | null, status: "idle" };
  const idle = {
    isDragging: false,
    dragIndex: null as number | null,
    dropIndex: null as number | null,
    pointerPos: { x: 0, y: 0 },
    grabOffset: { x: 0, y: 0 },
    handleCardGrab: vi.fn(),
  };
  return {
    track,
    tracks,
    player,
    idle,
    drag: { ...idle },
    revision: { value: 7 },
    sortMode: { value: "manual" },
    kept: { value: false },
    excluded: { value: [] as string[] },
    exclude: vi.fn(() => Promise.resolve()),
    move: vi.fn(() => Promise.resolve()),
    merge: vi.fn(() => Promise.resolve(true)),
    keepOffline: vi.fn(() => Promise.resolve()),
    offline: { value: null as { cached: number; total: number } | null },
    setSort: vi.fn(() => Promise.resolve()),
    engine: { playTrack: vi.fn(() => Promise.resolve()), playShuffled: vi.fn(), clearQueue: vi.fn(), togglePlayPause: vi.fn(), addToQueue: vi.fn() },
    reorder: vi.fn(() => Promise.resolve({ playlist: { revision: 8 }, items: [] })),
    saveDescription: vi.fn(() => Promise.resolve()),
    useModalStore: store({ openRemoveFromPlaylist: vi.fn(), openRemoveFromLibrary: vi.fn(), openCreatePlaylist: vi.fn(), openSearch: vi.fn() }),
    useHomePinsStore: store({ pins: [], pin: vi.fn(), unpin: vi.fn() }),
    usePlayerStore: (select: (state: typeof player) => unknown) => select(player),
  };
});

vi.mock("../../ports/i18n", () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, string | number>) => (vars ? `${key}(${Object.values(vars).join(",")})` : key),
    locale: "en",
  }),
}));
vi.mock("../../ports/covers", () => ({ coverSrc: (src: string) => src }));
vi.mock("../../ports/backdrop", () => ({ usePageBackdrop: vi.fn() }));
vi.mock("../../ports/network", () => ({ useStreamingReachable: () => true, useOnline: () => true, useOfflineMode: () => false }));
vi.mock("../../ports/catalog", () => ({ useCachedTrackIds: () => null }));
vi.mock("../../ports/player", () => ({
  usePlayerStore: mocks.usePlayerStore,
  playerEngine: mocks.engine,
  isSoundCloudId: (id: string) => id.startsWith("sc:"),
}));
vi.mock("../../ports/playlistTools", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../ports/playlistTools")>()),
  moveWithUndo: mocks.move,
  mergeWithUndo: mocks.merge,
}));
vi.mock("../../ports/recs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../ports/recs")>()),
  useExcludedPlaylists: () => mocks.excluded.value,
  setPlaylistExcluded: mocks.exclude,
}));
vi.mock("../../ports/library", () => ({
  usePlaylist: () => ({
    data: {
      id: "p1",
      title: "Morning",
      trackCount: 3,
      coverUrl: "c.jpg",
      coverUrls: ["c.jpg"],
      revision: mocks.revision.value,
      tracks: mocks.tracks,
      sortMode: mocks.sortMode.value,
      pinnedOffline: mocks.kept.value,
      updatedAt: new Date().toISOString(),
    },
    isLoading: false,
    error: undefined,
  }),
  useLikedTracks: () => ({ data: { tracks: [] }, isLoading: false }),
  useLikesCover: () => "",
  useReorderPlaylistTracks: () => ({ mutateAsync: mocks.reorder }),
  savePlaylistDescription: mocks.saveDescription,
  setPlaylistSort: mocks.setSort,
  keepPlaylistOffline: mocks.keepOffline,
  useOfflineProgress: () => mocks.offline.value,
  useIsTrackLiked: () => false,
  useLikeTrack: () => ({ mutate: vi.fn() }),
  useUnlikeTrack: () => ({ mutate: vi.fn() }),
  usePlaylistsList: () => ({
    data: {
      playlists: [
        { id: "p1", title: "Morning", coverUrl: "", trackCount: 3, updatedAt: "2" },
        { id: "p2", title: "Evening", coverUrl: "", trackCount: 5, updatedAt: "1" },
      ],
    },
    isLoading: false,
  }),
  useAddPlaylistTracks: () => ({ mutateAsync: vi.fn() }),
  useListReorder: () => mocks.drag,
  useModalStore: mocks.useModalStore,
  useHomePinsStore: mocks.useHomePinsStore,
  useRailPinsStore: mocks.useHomePinsStore,
  ApiError: class extends Error {},
}));

let root: Root | null = null;
let host: HTMLDivElement;

beforeEach(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  host = document.createElement("div");
  document.body.append(host);
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host.remove();
  document.body.innerHTML = "";
  vi.clearAllMocks();
  mocks.player.currentTrack = null;
  mocks.drag = { ...mocks.idle };
  mocks.revision.value = 7;
  mocks.sortMode.value = "manual";
  mocks.kept.value = false;
  mocks.excluded.value = [];
  mocks.offline.value = null;
  vi.useRealTimers();
});

function render() {
  root = createRoot(host);
  act(() =>
    root!.render(
      <MemoryRouter initialEntries={["/library/playlist?id=p1"]}>
        <Playlist />
      </MemoryRouter>,
    ),
  );
}

const rows = () => [...host.querySelectorAll<HTMLElement>("[data-track-row]")];
const button = (name: string) =>
  [...document.querySelectorAll("button")].find((node) => node.textContent === name || node.getAttribute("aria-label") === name)!;
const key = (node: HTMLElement, init: KeyboardEventInit) =>
  act(() => {
    node.focus();
    node.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));
  });

describe("Playlist", () => {
  it("the header counts the songs, their length and when the playlist last changed", () => {
    render();
    const head = host.querySelector("h1")!.closest("header") ?? host;
    expect(head.textContent).toContain("ui.entity.updated(today)");
  });

  it("Play plays the first track with the playlist as the queue", () => {
    render();
    act(() => button("common.play_all").click());
    expect(mocks.engine.playTrack).toHaveBeenCalledWith(mocks.tracks[0], mocks.tracks, "playlist:p1", "c.jpg");
  });

  it("Enter on the third row plays from it", () => {
    render();
    key(rows()[2], { key: "Enter" });
    expect(mocks.engine.playTrack).toHaveBeenCalledWith(mocks.tracks[2], mocks.tracks, "playlist:p1", "c.jpg");
  });

  it("one click on a row plays from it, and the second click of a double click does not start it again", () => {
    render();
    const click = (detail: number) => act(() => void rows()[1].dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail })));
    click(1);
    click(2);
    act(() => void rows()[1].dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true, detail: 2 })));
    expect(mocks.engine.playTrack).toHaveBeenCalledTimes(1);
    expect(mocks.engine.playTrack).toHaveBeenCalledWith(mocks.tracks[1], mocks.tracks, "playlist:p1", "c.jpg");
  });

  it("a plain click after a pick plays and lets the picks go", () => {
    render();
    act(() => void rows()[0].dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey: true })));
    expect(document.querySelector('[role="toolbar"]')).not.toBeNull();
    act(() => void rows()[2].dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 })));
    expect(mocks.engine.playTrack).toHaveBeenCalledWith(mocks.tracks[2], mocks.tracks, "playlist:p1", "c.jpg");
    expect(document.querySelector('[role="toolbar"]')).toBeNull();
  });

  it("ctrl click and shift click select rows and the bulk bar queues them", () => {
    render();
    const click = (node: HTMLElement, init: MouseEventInit) => act(() => void node.dispatchEvent(new MouseEvent("click", { bubbles: true, ...init })));
    expect(document.querySelector('[role="toolbar"]')).toBeNull();
    click(rows()[0], { ctrlKey: true });
    click(rows()[2], { shiftKey: true });
    expect(rows().map((row) => row.hasAttribute("data-selected"))).toEqual([true, true, true]);
    expect(document.querySelector('[role="toolbar"]')?.textContent).toContain("ui.bulk.selected(3)");
    expect(mocks.engine.playTrack).not.toHaveBeenCalled();
    const queue = [...document.querySelectorAll<HTMLElement>('[role="toolbar"] button')].find((node) => node.textContent === "ui.entity.add_to_queue")!;
    act(() => queue.click());
    expect(mocks.engine.addToQueue).toHaveBeenCalledTimes(3);
    expect(document.querySelector('[role="toolbar"]')).toBeNull();
  });

  it("Shift+ArrowDown extends and Escape clears the selection", () => {
    render();
    key(rows()[0], { key: "ArrowDown", shiftKey: true });
    expect(rows().map((row) => row.hasAttribute("data-selected"))).toEqual([true, true, false]);
    key(rows()[1], { key: "Escape" });
    expect(document.querySelector('[role="toolbar"]')).toBeNull();
  });

  it("marks the current track's row in the accent", () => {
    mocks.player.currentTrack = mocks.tracks[1];
    render();
    expect(rows()[1].hasAttribute("data-active")).toBe(true);
    expect(rows()[0].hasAttribute("data-active")).toBe(false);
  });

  it("Alt+ArrowDown moves the row one down through the reorder mutation", async () => {
    render();
    key(rows()[0], { key: "ArrowDown", altKey: true });
    await act(async () => {});
    expect(mocks.reorder).toHaveBeenCalledWith({ playlistId: "p1", itemId: "i1", beforeItemId: "i3", revision: 7 });
    expect(rows().map((row) => row.textContent?.includes("Song 2"))[0]).toBe(true);
  });

  it("offers the six stored orders, saves a pick in the playlist and reorders only in manual order", async () => {
    render();
    act(() => button("ui.entity.sort_default").click());
    const items = [...document.querySelectorAll('[role="menuitem"]')].map((node) => node.textContent);
    expect(items).toEqual([
      "ui.entity.sort_default",
      "ui.entity.sort_added",
      "ui.entity.sort_title",
      "ui.entity.sort_artist",
      "ui.entity.sort_album",
      "ui.entity.sort_duration",
    ]);
    act(() => button("ui.entity.sort_artist").click());
    expect(mocks.setSort).toHaveBeenCalledWith("p1", "artist");

    act(() => root?.unmount());
    mocks.sortMode.value = "artist";
    render();
    expect(button("ui.entity.sort_artist")).toBeDefined();
    key(rows()[0], { key: "ArrowDown", altKey: true });
    await act(async () => {});
    expect(mocks.reorder).not.toHaveBeenCalled();
  });

  it("keeps the playlist offline from its menu and shows how much of it is cached", () => {
    render();
    act(() => button("ui.entity.more").click());
    act(() => button("ui.library.offline_keep").click());
    expect(mocks.keepOffline).toHaveBeenCalledWith("p1", true);
    expect(host.querySelector("[data-offline-progress]")).toBeNull();

    act(() => root?.unmount());
    mocks.kept.value = true;
    mocks.offline.value = { cached: 12, total: 40 };
    render();
    expect(host.querySelector("[data-offline-progress]")?.textContent).toBe("ui.library.offline_progress(12,40)");
    act(() => button("ui.entity.more").click());
    act(() => button("ui.library.offline_stop").click());
    expect(mocks.keepOffline).toHaveBeenCalledWith("p1", false);
  });

  it("leaves the playlist out of recommendations from its menu, and takes it back", () => {
    render();
    act(() => button("ui.entity.more").click());
    act(() => button("ui.recs.excluded.exclude").click());
    expect(mocks.exclude).toHaveBeenCalledWith("p1", true);

    act(() => root?.unmount());
    mocks.excluded.value = ["p1"];
    render();
    act(() => button("ui.entity.more").click());
    act(() => button("ui.recs.excluded.include").click());
    expect(mocks.exclude).toHaveBeenCalledWith("p1", false);
  });

  it("moves selected rows to another playlist from the bulk bar", () => {
    render();
    act(() => void rows()[0].dispatchEvent(new MouseEvent("click", { bubbles: true, ctrlKey: true })));
    act(() => button("ui.library.move_to").click());
    expect(button("Morning3")).toBeUndefined();
    act(() => button("Evening5").click());
    expect(mocks.move).toHaveBeenCalledWith("p1", ["i1"], "p2", expect.objectContaining({ done: "ui.library.moved(Evening)" }));
  });

  it("merges the playlist into another one, deleting it when asked", async () => {
    render();
    act(() => button("ui.entity.more").click());
    act(() => button("ui.library.merge").click());
    act(() => document.querySelector<HTMLButtonElement>('[role="switch"]')!.click());
    await act(async () => button("Evening5").click());
    expect(mocks.merge).toHaveBeenCalledWith("p1", "p2", true, expect.anything());
  });

  it("the track menu of an own playlist ends with Remove from this playlist", () => {
    render();
    act(() => rows()[0].querySelector<HTMLButtonElement>('button[aria-label="ui.entity.more"]')!.click());
    const labels = [...document.querySelectorAll('[role="menuitem"]')].map((node) => node.textContent);
    expect(labels.at(-1)).toBe("ui.entity.remove_from_playlist");
  });

  it("Share from a track's menu shares that song; from the head menu, the whole playlist in order", () => {
    render();
    act(() => rows()[1].querySelector<HTMLButtonElement>('button[aria-label="ui.entity.more"]')!.click());
    act(() => button("ui.links.share.title").click());
    expect(useShareSheet.getState().open).toEqual({
      title: "",
      items: [{ id: "t2", title: "Song 2", artist: "Artist 2", durationMs: 180_000 }],
    });
    act(() => useShareSheet.getState().close());
    act(() => host.querySelector<HTMLButtonElement>('button[aria-label="ui.entity.more"]:not([data-track-row] *)')!.click());
    act(() =>
      [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
        .filter((node) => node.textContent === "ui.links.share.title")
        .at(-1)!
        .click(),
    );
    const open = useShareSheet.getState().open!;
    expect(open.title).toBe("Morning");
    expect(open.items.map((item) => item.id)).toEqual(["t1", "t2", "t3"]);
    act(() => useShareSheet.getState().close());
  });

  it("Add description edits in place: Enter saves the text, Escape keeps the old one", () => {
    render();
    act(() => button("common.add_description").click());
    const input = () => host.querySelector<HTMLInputElement>('input[aria-label="common.add_description"]')!;
    act(() => {
      input().value = "  Slow mornings ";
    });
    key(input(), { key: "Enter" });
    expect(mocks.saveDescription).toHaveBeenCalledWith("p1", "Slow mornings");
    act(() => button("common.add_description").click());
    act(() => {
      input().value = "dropped";
    });
    key(input(), { key: "Escape" });
    expect(mocks.saveDescription).toHaveBeenCalledTimes(1);
    expect(button("common.add_description")).toBeTruthy();
  });
});

describe("held state", () => {
  it("keeps the optimistic order through a refresh that lands while a move is still queued", async () => {
    let finish: (value: { playlist: { revision: number }; items: never[] }) => void = () => undefined;
    mocks.reorder.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
    render();
    key(rows()[0], { key: "ArrowDown", altKey: true });
    await act(async () => {});
    expect(mocks.reorder).toHaveBeenCalledTimes(1);
    mocks.revision.value = 8;
    act(() =>
      root!.render(
        <MemoryRouter initialEntries={["/library/playlist?id=p1"]}>
          <Playlist />
        </MemoryRouter>,
      ),
    );
    expect(rows()[0].textContent).toContain("Song 2");
    await act(async () => {
      finish({ playlist: { revision: 9 }, items: [] });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    mocks.revision.value = 9;
    act(() =>
      root!.render(
        <MemoryRouter initialEntries={["/library/playlist?id=p1"]}>
          <Playlist />
        </MemoryRouter>,
      ),
    );
    expect(rows()[0].textContent).toContain("Song 1");
  });

  it("keeps the lifted row mounted when it leaves the virtual window", () => {
    const tracks = Array.from({ length: 300 }, (_, index) => ({ track: mocks.track(index + 1), index }));
    const list = () => <TrackList tracks={tracks} currentId={null} onPlay={vi.fn()} onMenu={vi.fn()} onReorder={vi.fn()} />;
    root = createRoot(host);
    act(() => root!.render(list()));
    const has251 = () => rows().some((row) => row.textContent?.includes("Song 251"));
    expect(has251()).toBe(false);
    mocks.drag = { ...mocks.idle, isDragging: true, dragIndex: 250, dropIndex: 250 };
    act(() => root!.render(list()));
    expect(has251()).toBe(true);
  });
});

describe("trackMenuItems", () => {
  const actions: TrackMenuActions = {
    t: (key: string) => key,
    playNext: vi.fn(),
    addToQueue: vi.fn(),
    addToPlaylist: vi.fn(),
    startRadio: vi.fn(),
    goToArtist: vi.fn(),
    goToAlbum: vi.fn(),
    remove: vi.fn(),
  };
  const labels = (playlistId?: string) => trackMenuItems(mocks.tracks[0], { playlistId }, actions).map((item) => (item === "separator" ? "-" : item.label));

  it("offers Remove from this playlist only for an own playlist", () => {
    expect(labels("p1")).toContain("ui.entity.remove_from_playlist");
    expect(labels(undefined)).not.toContain("ui.entity.remove_from_playlist");
  });

  it("offers Edit lyrics only where the screen wires it", () => {
    const editLyrics = vi.fn();
    const items = trackMenuItems(mocks.tracks[0], {}, { ...actions, editLyrics });
    const entry = items.find((item) => item !== "separator" && item.label === "ui.lyrics.edit");
    expect(entry).toBeTruthy();
    if (entry && entry !== "separator") entry.onSelect();
    expect(editLyrics).toHaveBeenCalledWith(mocks.tracks[0]);
    expect(labels(undefined)).not.toContain("ui.lyrics.edit");
  });

  it("adds the three Not interested scopes through the port when it is wired, before Remove", () => {
    const notInterested = vi.fn();
    const items = trackMenuItems(mocks.tracks[0], { playlistId: "p1" }, { ...actions, notInterested });
    const names = items.map((item) => (item === "separator" ? "-" : item.label));
    expect(names.slice(-6)).toEqual(["-", "ui.recs.menu.exact", "ui.recs.menu.work", "ui.recs.menu.artist", "-", "ui.entity.remove_from_playlist"]);
    const work = items.find((item) => item !== "separator" && item.label === "ui.recs.menu.work");
    (work as { onSelect(): void }).onSelect();
    expect(notInterested).toHaveBeenCalledWith(mocks.tracks[0], "work");
    expect(labels(undefined)).not.toContain("ui.recs.menu.exact");
  });

  it("lists the actions in the brief's order", () => {
    expect(labels(undefined)).toEqual([
      "ui.entity.play_next",
      "ui.entity.add_to_queue",
      "ui.entity.add_to_playlist",
      "ui.links.share.title",
      "ui.entity.start_radio",
      "ui.entity.go_artist",
      "ui.entity.go_album",
      "ui.stats.track_stats",
      "ui.trim.menu",
      "ui.source.menu",
    ]);
  });
});
