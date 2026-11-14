// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { useImportsUi } from "../imports/importsUi";
import { Home } from "./Home";
import { arrangeMixes, byOthers, freshFirst, homeSongs, likeArtists, mosaicCovers } from "./homeModel";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  homeMixes: vi.fn(),
  playMix: vi.fn(),
  backdrop: vi.fn(),
  go: vi.fn(),
  library: { liked: 40, playlists: 1 },
  librarySongs: vi.fn(),
  songsLike: vi.fn(),
  localStyle: vi.fn(),
  playSongs: vi.fn(),
}));
vi.mock("../../ports/homeShelves", () => ({
  librarySongs: mocks.librarySongs,
  songsLike: mocks.songsLike,
  localStyle: mocks.localStyle,
  playSongs: mocks.playSongs,
  shuffled: <T,>(items: T[]) => [...items].reverse(),
}));
vi.mock("../../ports/recs", () => ({ recs: { homeMixes: mocks.homeMixes }, recsChanged: new EventTarget(), playMix: mocks.playMix }));
vi.mock("../../ports/i18n", () => ({
  useTranslation: () => ({
    t: (key: string, params?: { count?: number; name?: string; style?: string; names?: string }) =>
      params === undefined ? key : `${key}:${params.count ?? params.name ?? params.style ?? params.names}`,
  }),
}));
vi.mock("../../ports/covers", () => ({
  coverSrc: (src: string) => src,
  useCoverFluidColors: () => ({ color1: "rgb(0, 0, 0)", logoColor: "rgb(255, 255, 255)" }),
}));
vi.mock("./ColdStart", () => ({
  ColdStart: ({ onImport }: { onImport?: () => void }) =>
    onImport ? (
      <button type="button" onClick={onImport}>
        ui.library.import
      </button>
    ) : (
      <p>cold-start</p>
    ),
}));
vi.mock("./HiddenLink", () => ({ HiddenLink: () => <p>hidden-link</p> }));
vi.mock("../../ports/backdrop", () => ({ usePageBackdrop: mocks.backdrop }));
vi.mock("../../shell/navigate", () => ({ navigateWithTransition: (_navigate: unknown, to: string) => mocks.go(to) }));
vi.mock("../../ports/library", () => ({
  useLikedTrackCount: () => ({ data: mocks.library.liked, isLoading: false }),
  usePlaylistsList: () => ({
    data: { playlists: Array.from({ length: mocks.library.playlists }, () => ({ id: "p1", title: "Late night drive", trackCount: 300 })) },
    isLoading: false,
    isFetched: true,
    error: null,
  }),
}));

const tracks = (prefix: string, count: number) =>
  Array.from({ length: count }, (_, i) => ({ id: `${prefix}${i}`, title: `${prefix} ${i}`, artists: "A", coverUrl: `cover-${prefix}${i}`, durationMs: 1000 }));

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  vi.clearAllMocks();
  mocks.library = { liked: 40, playlists: 1 };
  mocks.librarySongs.mockResolvedValue([]);
  mocks.songsLike.mockResolvedValue([]);
  mocks.localStyle.mockResolvedValue(null);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

async function mount() {
  await act(async () =>
    root.render(
      <MemoryRouter>
        <Home />
      </MemoryRouter>,
    ),
  );
}

describe("Home mixes", () => {
  it("leads with For you as MIX 1, then New to you and the daily mixes numbered from 2", async () => {
    mocks.homeMixes.mockResolvedValue([
      { id: "daily-mix-for-you", title: "For you", description: "", tracks: tracks("f", 25) },
      { id: "daily-mix-discover", title: "New to you", description: "Close to what you play", tracks: tracks("n", 12) },
      { id: "daily-mix-artist-1", title: "Velvet Hour Mix", description: "Your favourite tracks by Velvet Hour", tracks: tracks("a", 6) },
      { id: "daily-mix-recent-likes", title: "Recent likes", description: "", tracks: [] },
      { id: "daily-mix-mood-late-night", title: "Late night", description: "", tracks: tracks("m", 4) },
    ]);
    await mount();
    const cards = [...host.querySelectorAll<HTMLElement>("[data-mix]")];
    expect(cards.map((card) => card.dataset.mix)).toEqual(["daily-mix-for-you", "daily-mix-discover", "daily-mix-artist-1", "daily-mix-mood-late-night"]);
    expect(cards.map((card) => card.querySelector("[data-mix-number]")?.textContent)).toEqual(["1", "2", "3", "4"]);
    expect(cards[0].textContent).toContain("ui.recs.home.for_you");
    expect(cards[0].textContent).toContain("ui.home.for_you_subtitle");
    expect(cards[1].textContent).toContain("ui.recs.home.discover");
    expect(cards[2].textContent).toContain("ui.home.artist_mix:A");
    expect(cards[2].textContent).toContain("ui.home.artist_mix_subtitle:A");
    expect(cards[3].textContent).toContain("ui.home.mood_late_night");
    expect(host.querySelector("[data-tour=mixes]")?.textContent).toBe("ui.recs.home.for_you");
  });

  it("opens a mix on click and plays it from its first track on double click, under the mix's own context", async () => {
    mocks.homeMixes.mockResolvedValue([{ id: "daily-mix-for-you", title: "For you", description: "", tracks: tracks("f", 5) }]);
    await mount();
    const card = host.querySelector<HTMLElement>("[data-mix=daily-mix-for-you]")!;
    act(() => card.click());
    expect(mocks.go).toHaveBeenCalledWith("/collection?type=playlist&id=daily-mix-for-you");
    act(() => card.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
    expect(mocks.playMix).toHaveBeenCalledWith("daily-mix-for-you", expect.arrayContaining([expect.objectContaining({ id: "f0" })]), 0);
  });

  it("lights the page from the lead mix's first cover", async () => {
    mocks.homeMixes.mockResolvedValue([{ id: "daily-mix-for-you", title: "For you", description: "", tracks: tracks("f", 5) }]);
    await mount();
    expect(mocks.backdrop).toHaveBeenLastCalledWith("cover-f0");
  });

  it("draws the For you cover as a 2 x 2 collage", async () => {
    mocks.homeMixes.mockResolvedValue([{ id: "daily-mix-for-you", title: "For you", description: "", tracks: tracks("f", 8) }]);
    await mount();
    expect(host.querySelectorAll("[data-mix=daily-mix-for-you] [data-mosaic] img")).toHaveLength(4);
  });
});

describe("Home slots", () => {
  it("holds recommendations only: no quick picks and no saved shelf", async () => {
    mocks.homeMixes.mockResolvedValue([{ id: "daily-mix-for-you", title: "For you", description: "", tracks: tracks("f", 3) }]);
    await mount();
    expect(host.querySelector("[data-pick]")).toBeNull();
    expect(host.querySelector("[data-shelf=saved]")).toBeNull();
    expect(host.querySelector("[data-mix]")).not.toBeNull();
  });

  it("mounts the cold-start slot when no mix has tracks", async () => {
    mocks.homeMixes.mockResolvedValue([{ id: "daily-mix-for-you", title: "For you", description: "", tracks: [] }]);
    await mount();
    expect(host.querySelector("[data-mix]")).toBeNull();
    expect(host.querySelector("[data-slot=cold-start]")?.textContent).toBe("cold-start");
  });

  it("keeps the hidden-list link's mount point at the foot", async () => {
    mocks.homeMixes.mockResolvedValue([{ id: "daily-mix-for-you", title: "For you", description: "", tracks: tracks("f", 3) }]);
    await mount();
    expect(host.querySelector("[data-slot=hidden-link]")?.textContent).toBe("hidden-link");
    expect(host.querySelector("[data-slot=cold-start]")).toBeNull();
  });
});

describe("Home import entry", () => {
  const importButton = () => [...host.querySelectorAll("button")].find((node) => node.textContent === "ui.library.import");

  it("offers Import only while the library is empty: under the mixes, or in the empty state without them", async () => {
    mocks.library = { liked: 0, playlists: 0 };
    mocks.homeMixes.mockResolvedValue([{ id: "daily-mix-for-you", title: "For you", description: "", tracks: tracks("f", 3) }]);
    await mount();
    act(() => importButton()!.click());
    expect(useImportsUi.getState().sheet).toEqual({});
    act(() => useImportsUi.getState().close());
    act(() => root.unmount());
    root = createRoot(host);
    mocks.homeMixes.mockResolvedValue([]);
    await mount();
    expect(importButton()).toBeDefined();
    act(() => root.unmount());
    root = createRoot(host);
    mocks.library = { liked: 0, playlists: 2 };
    await mount();
    expect(importButton()).toBeUndefined();
  });
});

describe("Home mood mixes", () => {
  const moodCards = () => host.querySelectorAll('[data-mix^="daily-mix-mood-"]');

  it("show no mood tile while the daemon has no mood data, an empty mood, or no answer", async () => {
    mocks.homeMixes.mockResolvedValue([
      { id: "daily-mix-for-you", title: "For you", description: "", tracks: tracks("f", 25) },
      { id: "daily-mix-mood-energy", title: "Energy", description: "", tracks: [] },
      { id: "daily-mix-mood-calm", title: "Calm", description: "", tracks: [] },
    ]);
    await mount();
    expect(host.querySelectorAll("[data-mix]")).toHaveLength(1);
    expect(moodCards()).toHaveLength(0);
    expect(host.textContent).not.toContain("ui.home.mood_");

    act(() => root.unmount());
    root = createRoot(host);
    mocks.homeMixes.mockResolvedValue([]);
    await mount();
    expect(moodCards()).toHaveLength(0);
  });
});

describe("homeModel", () => {
  it("puts For you first and New to you second, drops empty mixes, keeps the daemon's order for the rest", () => {
    const mix = (id: string, count = 3) => ({ id, title: id, description: "", tracks: tracks(id, count) });
    const order = arrangeMixes([
      mix("daily-mix-artist-1"),
      mix("daily-mix-discover"),
      mix("daily-mix-mood-calm", 0),
      mix("daily-mix-for-you"),
      mix("daily-mix-recent-likes"),
    ]);
    expect(order.map((m) => m.id)).toEqual(["daily-mix-for-you", "daily-mix-discover", "daily-mix-artist-1", "daily-mix-recent-likes"]);
  });

  it("takes four different covers for a collage, or one when there are fewer", () => {
    const same = tracks("s", 6).map((track) => ({ ...track, coverUrl: track.id === "s0" ? "a" : track.id === "s1" ? "a" : track.coverUrl }));
    expect(mosaicCovers(same)).toEqual(["a", "cover-s2", "cover-s3", "cover-s4"]);
    expect(mosaicCovers(tracks("t", 3))).toEqual(["cover-t0"]);
    expect(mosaicCovers([])).toEqual([]);
  });
});

describe("Home songs", () => {
  it("fills a young profile's Home with the songs of its one mix; a click plays the mix from that song", async () => {
    mocks.homeMixes.mockResolvedValue([{ id: "daily-mix-discover", title: "", description: "", tracks: tracks("d", 20) }]);
    await mount();
    const rows = [...host.querySelectorAll<HTMLElement>("[data-shelf=songs] [data-song]")];
    expect(rows).toHaveLength(12);
    expect(host.textContent).toContain("ui.home.songs_for_you");
    act(() => rows[2].click());
    expect(mocks.playMix).toHaveBeenCalledWith("daily-mix-discover", expect.arrayContaining([expect.objectContaining({ id: "d0" })]), 2);
  });

  it("takes songs from every mix in turn, each song once", () => {
    const a = { id: "a", title: "", description: "", tracks: tracks("x", 3) };
    const b = { id: "b", title: "", description: "", tracks: [tracks("x", 1)[0], ...tracks("y", 2)] };
    expect(homeSongs([a, b], 4).map((song) => `${song.mixId}:${song.track.id}:${song.index}`)).toEqual(["a:x0:0", "a:x1:1", "b:y0:1", "a:x2:2"]);
  });
});

const by = (artist: string, prefix: string, count: number) => tracks(prefix, count).map((track) => ({ ...track, artists: artist }));
const shelfSongs = (name: string) => [...host.querySelectorAll<HTMLElement>(`[data-shelf="${name}"] [data-song]`)].map((row) => row.dataset.song);

describe("Home variety shelves", () => {
  it("shuffles the library and likes into a dozen songs, none Songs for you shows, and plays them as the shuffle", async () => {
    mocks.homeMixes.mockResolvedValue([{ id: "daily-mix-for-you", title: "", description: "", tracks: tracks("f", 5) }]);
    mocks.librarySongs.mockResolvedValue([...tracks("f", 5), ...tracks("l", 20)]);
    await mount();
    expect(host.querySelector("[data-shelf=shuffle] h2")?.textContent).toBe("ui.home.shuffle");
    expect(shelfSongs("shuffle")).toEqual(["l19", "l18", "l17", "l16"]);
    expect(host.querySelector("[data-shelf=shuffle]")?.textContent).toContain("ui.home.shuffle_names:A");
    act(() => [...host.querySelectorAll<HTMLElement>("[data-shelf=shuffle] button")].find((button) => button.textContent === "ui.entity.play")!.click());
    expect(mocks.playSongs).toHaveBeenCalledWith(tracks("l", 20).reverse().slice(0, 12), 0, "home:shuffle");
  });

  it("offers More like for the first two artists with a mix, with other artists' songs only", async () => {
    mocks.homeMixes.mockResolvedValue([
      { id: "daily-mix-for-you", title: "", description: "", tracks: tracks("f", 5) },
      { id: "daily-mix-artist-1", title: "", description: "", tracks: by("Velvet Hour", "v", 4) },
      { id: "daily-mix-artist-2", title: "", description: "", tracks: by("Mono", "m", 4) },
      { id: "daily-mix-artist-3", title: "", description: "", tracks: by("Third", "x", 4) },
    ]);
    mocks.songsLike.mockImplementation(async (context: string) => [...by("velvet hour", "own", 3), ...by("Other", `${context}-`, 6)]);
    await mount();
    const titles = [...host.querySelectorAll("[data-shelf=like] h2")].map((title) => title.textContent);
    expect(titles).toEqual(["ui.home.more_like:Velvet Hour", "ui.home.more_like:Mono"]);
    expect(host.querySelector("[data-shelf=like] [data-lead]")?.textContent).toBe("Velvet Hourui.home.more_like_line");
    expect(mocks.songsLike).toHaveBeenCalledWith("home:like:Velvet Hour", ["v0", "v1", "v2", "v3"], expect.arrayContaining(["f0", "f1"]));
    expect(shelfSongs("like").slice(0, 6)).toEqual(by("Other", "home:like:Velvet Hour-", 6).map((track) => track.id));
  });

  it("names a style only when the daemon knows one, and leaves out shelves with too few songs", async () => {
    mocks.homeMixes.mockResolvedValue([{ id: "daily-mix-artist-1", title: "", description: "", tracks: by("Velvet Hour", "v", 4) }]);
    mocks.librarySongs.mockResolvedValue(tracks("l", 3));
    mocks.songsLike.mockResolvedValue(by("Other", "o", 2));
    await mount();
    expect(host.querySelector("[data-shelf=style]")).toBeNull();
    expect(host.querySelector("[data-shelf=shuffle]")).toBeNull();
    expect(host.querySelector("[data-shelf=like]")).toBeNull();

    act(() => root.unmount());
    root = createRoot(host);
    mocks.localStyle.mockResolvedValue({ genre: "Shoegaze", tracks: tracks("s", 8) });
    await mount();
    expect(host.querySelector("[data-shelf=style] h2")?.textContent).toBe("ui.home.style_for_you:Shoegaze");
    expect(shelfSongs("style")).toHaveLength(8);
  });
});

describe("shelf model", () => {
  it("puts songs not shown yet first and fills up with the rest", () => {
    const all = tracks("t", 5);
    expect(freshFirst(all, all.slice(0, 2), 4).map((track) => track.id)).toEqual(["t2", "t3", "t4", "t0"]);
  });

  it("names the artists of the artist mixes and keeps others' songs", () => {
    const mixes = [
      { id: "daily-mix-for-you", title: "", description: "", tracks: tracks("f", 2) },
      { id: "daily-mix-artist-1", title: "", description: "", tracks: by("Mono", "m", 2) },
    ];
    expect(likeArtists(mixes, 2)).toEqual([{ name: "Mono", seeds: ["m0", "m1"], cover: "cover-m0" }]);
    expect(byOthers([...by("MONO", "a", 1), ...by("Else", "b", 1)], "Mono").map((track) => track.id)).toEqual(["b0"]);
  });
});

describe("Home refresh", () => {
  const refreshOf = (name: string) => host.querySelector<HTMLButtonElement>(`[data-shelf="${name}"] [data-refresh]`)!;

  it("brings other songs into Songs for you and the shuffle, none of the ones just shown while others are left", async () => {
    mocks.homeMixes.mockResolvedValue([{ id: "daily-mix-for-you", title: "", description: "", tracks: tracks("f", 25) }]);
    mocks.librarySongs.mockResolvedValue(tracks("l", 30));
    await mount();
    for (const name of ["songs", "shuffle"]) {
      const before = shelfSongs(name);
      await act(async () => refreshOf(name).click());
      const after = shelfSongs(name);
      expect(after).toHaveLength(name === "shuffle" ? 4 : 12);
      expect(after.filter((id) => before.includes(id))).toEqual([]);
    }
    act(() => host.querySelector<HTMLElement>("[data-shelf=songs] [data-song]")!.click());
    expect(mocks.playMix).toHaveBeenCalledWith("daily-mix-for-you", expect.any(Array), 12);
  });

  it("asks More like again from another seed with the shown songs left out, and keeps the songs when nothing new comes", async () => {
    mocks.homeMixes.mockResolvedValue([{ id: "daily-mix-artist-1", title: "", description: "", tracks: by("Mono", "m", 3) }]);
    mocks.songsLike
      .mockResolvedValueOnce(by("Other", "a", 6))
      .mockResolvedValueOnce(by("Other", "b", 6))
      .mockResolvedValue([]);
    await mount();
    await act(async () => refreshOf("like").click());
    expect(mocks.songsLike).toHaveBeenLastCalledWith("home:like:Mono", ["m2", "m0", "m1"], expect.arrayContaining(["a0", "a5"]));
    expect(shelfSongs("like")).toEqual(by("Other", "b", 6).map((track) => track.id));
    await act(async () => refreshOf("like").click());
    expect(shelfSongs("like")).toEqual(by("Other", "b", 6).map((track) => track.id));
  });
});
