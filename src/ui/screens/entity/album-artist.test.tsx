// @vitest-environment jsdom
import { act, type JSX } from "react";
import { type Root, createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { Album } from "./Album";
import { Artist } from "./Artist";
import { Playlist } from "./Playlist";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => {
  const store = <T extends object>(state: T) => Object.assign((select: (value: T) => unknown) => select(state), { getState: () => state });
  const track = (n: number) => ({
    id: `t${n}`,
    title: `Song ${n}`,
    artists: "Queen",
    artistId: "q",
    album: { id: "al1", title: "Opera" },
    coverUrl: "",
    durationMs: 180_000,
    playCount: 0,
  });
  const player = { currentTrack: null as unknown, playbackContext: null as string | null, status: "idle", queue: [] as unknown[] };
  return {
    track,
    player,
    state: {
      collection: { data: null as unknown, loading: false },
      artist: { data: null as unknown, loading: false },
      online: true,
      cached: null as Set<string> | null,
      playlistTracks: [] as unknown[],
      playlistCover: "",
      savedArtists: [] as { id: string; title: string }[],
      mix: undefined as unknown,
    },
    useCollection: vi.fn(),
    engine: { playTrack: vi.fn(() => Promise.resolve()), playShuffled: vi.fn(), clearQueue: vi.fn(), togglePlayPause: vi.fn(), startRadioStation: vi.fn() },
    radio: vi.fn(() => Promise.resolve()),
    useModalStore: store({ openRemoveFromPlaylist: vi.fn(), openRemoveFromLibrary: vi.fn(), openSearch: vi.fn() }),
    useHomePinsStore: store({ pins: [], pin: vi.fn(), unpin: vi.fn() }),
  };
});

vi.mock("../../ports/i18n", () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, string | number>) => (vars ? `${key}(${Object.values(vars).join(",")})` : key),
  }),
}));
vi.mock("../../ports/covers", () => ({ coverSrc: (src: string) => src }));
vi.mock("../../ports/backdrop", () => ({ usePageBackdrop: vi.fn() }));
vi.mock("../../ports/network", () => ({ useStreamingReachable: () => mocks.state.online, useOfflineMode: () => false }));
vi.mock("../../ports/player", () => ({
  usePlayerStore: (select: (state: typeof mocks.player) => unknown) => select(mocks.player),
  playerEngine: mocks.engine,
}));
vi.mock("../../ports/catalog", () => ({
  useCollection: (...args: unknown[]) => {
    mocks.useCollection(...args);
    return mocks.state.collection;
  },
  useArtist: () => mocks.state.artist,
  useCachedTrackIds: (_ids: string[], enabled: boolean) => (enabled ? mocks.state.cached : null),
  startArtistRadio: mocks.radio,
}));
vi.mock("../../ports/recs", async (load) => ({
  ...(await load<object>()),
  useHomeMix: (id: string | null) => (id === null ? null : mocks.state.mix),
}));
vi.mock("../../ports/library", () => ({
  useOfflineProgress: () => null,
  usePlaylist: () => ({
    data: {
      id: "p1",
      title: "Morning",
      trackCount: 0,
      coverUrl: mocks.state.playlistCover,
      coverUrls: ["song-art.jpg"],
      revision: 1,
      tracks: mocks.state.playlistTracks,
    },
    isLoading: false,
    error: undefined,
  }),
  useLikedTracks: () => ({ data: { tracks: [] }, isLoading: false }),
  useLikesCover: () => "",
  useReorderPlaylistTracks: () => ({ mutateAsync: vi.fn() }),
  useIsTrackLiked: () => false,
  useLikeTrack: () => ({ mutate: vi.fn() }),
  useUnlikeTrack: () => ({ mutate: vi.fn() }),
  usePlaylistsList: () => ({ data: { playlists: [] }, isLoading: false }),
  useAddPlaylistTracks: () => ({ mutateAsync: vi.fn() }),
  useExternalItems: (kind: string) => ({ data: kind === "artist" ? mocks.state.savedArtists : [], loaded: true }),
  useSaveExternalItem: () => ({ mutate: vi.fn() }),
  useRemoveExternalItem: () => ({ mutate: vi.fn() }),
  useListReorder: () => ({
    isDragging: false,
    dragIndex: null,
    dropIndex: null,
    pointerPos: { x: 0, y: 0 },
    grabOffset: { x: 0, y: 0 },
    handleCardGrab: vi.fn(),
  }),
  useModalStore: mocks.useModalStore,
  useHomePinsStore: mocks.useHomePinsStore,
  useRailPinsStore: mocks.useHomePinsStore,
  ApiError: class extends Error {},
}));

let root: Root | null = null;
let host: HTMLDivElement;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host.remove();
  document.body.innerHTML = "";
  vi.clearAllMocks();
  Object.assign(mocks.state, {
    collection: { data: null, loading: false },
    artist: { data: null, loading: false },
    online: true,
    cached: null,
    playlistTracks: [],
    playlistCover: "",
    savedArtists: [],
    mix: undefined,
  });
});

function render(path: string, page: JSX.Element) {
  root = createRoot(host);
  act(() => root!.render(<MemoryRouter initialEntries={[path]}>{page}</MemoryRouter>));
}

const rows = () => [...host.querySelectorAll<HTMLElement>("[data-track-row]")];
const dimmed = () => rows().map((row) => row.hasAttribute("data-unavailable"));
const buttons = () => [...host.querySelectorAll("button")];
const button = (name: string) => buttons().find((node) => node.textContent === name || node.getAttribute("aria-label") === name);

function album(tracks: unknown[]) {
  mocks.state.collection = {
    data: { type: "album", title: "Opera", artists: [{ id: "q", name: "Queen" }], year: 1975, coverUrl: "c.jpg", tracks },
    loading: false,
  };
}

describe("Album", () => {
  it("dims a track with no playable id and gives the reason on focus", () => {
    album([mocks.track(1), { ...mocks.track(2), id: "" }, mocks.track(3)]);
    render("/collection?type=album&id=al1", <Album />);
    expect(dimmed()).toEqual([false, true, false]);
    act(() => rows()[1].focus());
    expect(document.body.querySelector('[role="tooltip"]')?.textContent).toBe("ui.entity.unavailable");
  });

  it("offline with the cached ids known, dims exactly the uncached rows", () => {
    album([1, 2, 3, 4].map(mocks.track));
    mocks.state.online = false;
    mocks.state.cached = new Set(["t1", "t3"]);
    render("/collection?type=album&id=al1", <Album />);
    expect(dimmed()).toEqual([false, true, false, true]);
    act(() => rows()[3].focus());
    expect(document.body.querySelector('[role="tooltip"]')?.textContent).toBe("ui.entity.unavailable_offline");
  });

  it("Play queues only the playable tracks", () => {
    album([mocks.track(1), { ...mocks.track(2), id: "" }, mocks.track(3)]);
    render("/collection?type=album&id=al1", <Album />);
    act(() => button("common.play_all")!.click());
    expect(mocks.engine.playTrack).toHaveBeenCalledWith(mocks.track(1), [mocks.track(1), mocks.track(3)], "album:al1", "c.jpg");
  });
});

describe("Home mix", () => {
  it("lists the daemon's mix under its own name, never asks the catalog, and plays it as the mix", () => {
    mocks.state.mix = { id: "daily-mix-discover", title: "New to you", description: "", tracks: [1, 2, 3].map(mocks.track) };
    render("/collection?type=playlist&id=daily-mix-discover", <Album />);
    expect(mocks.useCollection).toHaveBeenCalledWith("playlist", null);
    expect(host.querySelector("h1")?.textContent).toBe("ui.recs.home.discover");
    expect(rows()).toHaveLength(3);
    expect(host.textContent).not.toContain("ui.entity.load_failed_title");
    act(() => button("common.play_all")!.click());
    expect(mocks.engine.playTrack).toHaveBeenCalledWith(mocks.track(1), [1, 2, 3].map(mocks.track), "mix:daily-mix-discover", "");
  });

  it("says the mix is gone when today's mixes no longer hold it", () => {
    mocks.state.mix = null;
    render("/collection?type=playlist&id=daily-mix-artist-3", <Album />);
    expect(host.textContent).toContain("ui.entity.mix_gone_title");
  });
});

describe("Artist", () => {
  it("Show all expands the top songs from 5 to all", () => {
    mocks.state.artist = {
      data: { title: "Queen", coverUrl: "q.jpg", tracks: [1, 2, 3, 4, 5, 6, 7, 8].map(mocks.track), albums: [], singles: [] },
      loading: false,
    };
    render("/artist?id=q", <Artist />);
    expect(rows()).toHaveLength(5);
    act(() => button("ui.entity.show_all")!.click());
    expect(rows()).toHaveLength(8);
    expect(button("ui.entity.show_all")).toBeUndefined();
  });

  it("with no data and no network, shows only the name and the radio button", () => {
    mocks.state.online = false;
    mocks.state.savedArtists = [{ id: "q", title: "Queen" }];
    render("/artist?id=q", <Artist />);
    expect(host.querySelector("h1")?.textContent).toBe("Queen");
    expect(buttons().map((node) => node.textContent)).toEqual(["ui.entity.radio_from(Queen)"]);
    expect(rows()).toHaveLength(0);
    act(() => buttons()[0].click());
    expect(mocks.radio).toHaveBeenCalledWith("q", undefined);
  });
});

describe("Playlist cover", () => {
  it("the header shows the cover the user set, not the first song's artwork", () => {
    mocks.state.playlistCover = "custom-cover.webp";
    render("/library/playlist?id=p1", <Playlist />);
    const sources = [...host.querySelectorAll("img")].map((img) => img.getAttribute("src"));
    expect(sources).toContain("custom-cover.webp");
    expect(sources).not.toContain("song-art.jpg");
  });

  it("without a set cover, the header falls back to the first song's artwork", () => {
    render("/library/playlist?id=p1", <Playlist />);
    expect([...host.querySelectorAll("img")].map((img) => img.getAttribute("src"))).toContain("song-art.jpg");
  });
});

describe("Empty playlist", () => {
  it("shows the empty line with a Search button that opens search", () => {
    render("/library/playlist?id=p1", <Playlist />);
    expect(host.textContent).toContain("playlist.empty_title");
    act(() => button("playlist.empty_subtitle")!.click());
    expect(mocks.useModalStore.getState().openSearch).toHaveBeenCalled();
  });
});
