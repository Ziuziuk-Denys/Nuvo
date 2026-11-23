// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import type { YtTrack } from "@/youtube";
import { artistTopTrack, entityTracks, useArtist, useCollection, warmArtist, type CatalogPage } from "./pages";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const catalog = vi.hoisted(() => ({ artist: vi.fn(), album: vi.fn(), playlist: vi.fn(), search: vi.fn() }));
vi.mock("@/youtubeBoot", () => ({ getYoutube: () => ({ catalog }) }));

const cover = (url: string) => ({ url, width: 544, height: 544 });
const track = (id: string): YtTrack => ({
  id,
  title: `Song ${id}`,
  artists: [{ id: "a1", name: "Nova" }],
  durationMs: 180_000,
  cover: cover(`https://i.ytimg.com/vi/${id}/hqdefault.jpg`),
  explicit: false,
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

let root: Root;
let seen: CatalogPage<unknown> | null;

function Probe({ use }: { use: () => CatalogPage<unknown> }) {
  seen = use();
  return null;
}

const render = (use: () => CatalogPage<unknown>) => act(() => root.render(<Probe use={use} />));
const flush = () =>
  act(async () => {
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  });

beforeEach(() => {
  for (const fn of Object.values(catalog)) fn.mockReset();
  seen = null;
  root = createRoot(document.createElement("div"));
});

afterEach(() => act(() => root.unmount()));

describe("useArtist", () => {
  const page = (id: string, name = "Nova") => ({ id, name, tracks: [track("t1")], albums: [], singles: [], similar: [] });
  const ids = () => (seen?.data as { tracks: { id: string }[] } | null)?.tracks.map((item) => item.id);

  it("shows the page before the whole list of songs", async () => {
    const full = deferred<YtTrack[]>();
    catalog.artist.mockResolvedValue({ ...page("ar-more"), more: () => full.promise });
    render(() => useArtist("ar-more"));
    await flush();
    expect(ids()).toEqual(["t1"]);
    full.resolve([track("t1"), track("t2")]);
    await flush();
    expect(ids()).toEqual(["t1", "t2"]);
  });

  it("finds an artist without an id by the exact name", async () => {
    catalog.search.mockResolvedValue([
      { kind: "artist", id: "ar-cover", name: "Nova Covers" },
      { kind: "artist", id: "ar-nova", name: "NÓVA" },
    ]);
    catalog.artist.mockResolvedValue(page("ar-nova"));
    render(() => useArtist(null, "nova"));
    await flush();
    expect(catalog.artist.mock.calls[0][0]).toBe("ar-nova");
    expect(seen?.data).toMatchObject({ id: "ar-nova" });
  });

  it("finds an artist the catalog titles in another script by a song's credit", async () => {
    catalog.search.mockResolvedValue([
      { kind: "artist", id: "ar-kino", name: "KINO" },
      { kind: "artist", id: "ar-fan", name: "кино" },
      { kind: "track", ...track("t8"), artists: [{ id: "ar-kino", name: "Кино" }] },
      { kind: "track", ...track("t9"), artists: [{ id: "ar-kino", name: "Кино" }] },
    ]);
    catalog.artist.mockResolvedValue(page("ar-kino", "KINO"));
    render(() => useArtist(null, "Кино"));
    await flush();
    expect(seen?.data).toMatchObject({ id: "ar-kino" });
  });

  it.each([
    ["Godspeed You! Black Emperor", "Godspeed You Black Emperor"],
    ["!!!", "!!!"],
  ])("finds %s past its punctuation", async (name, credited) => {
    catalog.search.mockResolvedValue([{ kind: "artist", id: `ar-${name}`, name: credited }]);
    catalog.artist.mockResolvedValue(page(`ar-${name}`, credited));
    render(() => useArtist(null, name));
    await flush();
    expect(seen?.data).toMatchObject({ id: `ar-${name}` });
  });

  it("reports a name nobody has instead of opening someone else", async () => {
    catalog.search.mockResolvedValue([{ kind: "artist", id: "ar-other", name: "Other" }]);
    render(() => useArtist(null, "Nobody"));
    await flush();
    expect(catalog.artist).not.toHaveBeenCalled();
    expect(seen).toMatchObject({ data: null, loading: false, error: true });
  });

  it("opens a warmed artist at once and with one request", async () => {
    const slow = deferred<ReturnType<typeof page>>();
    catalog.artist.mockReturnValue(slow.promise);
    warmArtist("ar-warm");
    warmArtist("ar-warm");
    render(() => useArtist("ar-warm"));
    slow.resolve(page("ar-warm"));
    await flush();
    expect(catalog.artist).toHaveBeenCalledTimes(1);
    expect(seen).toMatchObject({ loading: false, data: { id: "ar-warm" } });
  });

  it("maps the catalog's artist page for the screen", async () => {
    catalog.artist.mockResolvedValue({
      id: "ar1",
      name: "Nova",
      cover: cover("https://lh3.googleusercontent.com/nova"),
      listenersText: "1.2M monthly audience",
      tracks: [track("t1")],
      albums: [{ id: "al1", title: "First", year: 2020, cover: cover("https://lh3.googleusercontent.com/al1"), explicit: false }],
      singles: [{ id: "s1", title: "One", explicit: false, releaseKind: "single" }],
      similar: [{ id: "ar2", name: "Lyra", cover: cover("https://lh3.googleusercontent.com/lyra") }],
    });
    render(() => useArtist("ar1"));
    expect(seen).toMatchObject({ data: null, loading: true, error: false });
    await flush();
    expect(seen).toMatchObject({
      loading: false,
      error: false,
      data: {
        id: "ar1",
        title: "Nova",
        coverUrl: "https://lh3.googleusercontent.com/nova",
        monthlyListeners: "1.2M monthly audience",
        tracks: [
          expect.objectContaining({
            id: "t1",
            title: "Song t1",
            artists: "Nova",
            artistId: "a1",
            playCount: 0,
            coverUrl: "https://i.ytimg.com/vi/t1/hqdefault.jpg",
          }),
        ],
        albums: [{ id: "al1", kind: "album", title: "First", releaseDate: "2020", coverUrl: "https://lh3.googleusercontent.com/al1" }],
        singles: [{ id: "s1", kind: "single", title: "One", releaseDate: undefined, coverUrl: "" }],
        similar: [{ id: "ar2", name: "Lyra", coverUrl: "https://lh3.googleusercontent.com/lyra" }],
      },
    });
    expect(catalog.artist).toHaveBeenCalledWith("ar1", expect.any(AbortSignal));
  });

  it("settles with an error when the catalog fails, and loads again on retry", async () => {
    catalog.artist.mockRejectedValueOnce(new Error("unreachable"));
    render(() => useArtist("ar-missing"));
    await flush();
    expect(seen).toMatchObject({ data: null, loading: false, error: true });
    catalog.artist.mockResolvedValue({ id: "ar-missing", name: "Back", tracks: [], albums: [], singles: [], similar: [] });
    act(() => seen!.retry());
    expect(seen).toMatchObject({ loading: true, error: false });
    await flush();
    expect(seen).toMatchObject({ loading: false, error: false, data: { title: "Back" } });
    expect(catalog.artist).toHaveBeenCalledTimes(2);
  });

  it("does not call a cancelled load an error", async () => {
    catalog.artist.mockImplementation(
      (_id: string, signal: AbortSignal) =>
        new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))),
    );
    render(() => useArtist("ar-x"));
    act(() => root.render(null));
    await flush();
    expect(seen).toMatchObject({ error: false });
  });

  it("asks nothing without an id", async () => {
    render(() => useArtist(null));
    await flush();
    expect(seen).toMatchObject({ data: null, loading: false, error: false });
    expect(catalog.artist).not.toHaveBeenCalled();
  });

  it("ignores a late answer for the previous artist (Review Focus 4)", async () => {
    const slow = deferred<unknown>();
    catalog.artist.mockImplementation((id: string) =>
      id === "ar-a" ? slow.promise : Promise.resolve({ id: "ar-b", name: "B", tracks: [], albums: [], singles: [], similar: [] }),
    );
    let id = "ar-a";
    render(() => useArtist(id));
    id = "ar-b";
    render(() => useArtist(id));
    await flush();
    slow.resolve({ id: "ar-a", name: "A", tracks: [], albums: [], singles: [], similar: [] });
    await flush();
    expect((seen?.data as { id: string }).id).toBe("ar-b");
    expect((catalog.artist.mock.calls[0][1] as AbortSignal).aborted).toBe(true);
  });
});

describe("useCollection", () => {
  it("maps an album with its artists and year", async () => {
    catalog.album.mockResolvedValue({
      id: "al2",
      title: "Opera",
      artists: [{ id: "q", name: "Queen" }],
      year: 1975,
      cover: cover("https://lh3.googleusercontent.com/op"),
      tracks: [track("o1")],
    });
    render(() => useCollection("album", "al2"));
    await flush();
    expect(seen?.data).toEqual({
      type: "album",
      id: "al2",
      title: "Opera",
      coverUrl: "https://lh3.googleusercontent.com/op",
      tracks: [expect.objectContaining({ id: "o1" })],
      artists: [{ id: "q", name: "Queen" }],
      year: 1975,
    });
  });

  it("shows a long playlist's first page, then the rest", async () => {
    const rest = deferred<YtTrack[]>();
    catalog.playlist.mockResolvedValue({ id: "pl1", title: "Long", author: "Me", tracks: [track("p1")], more: () => rest.promise });
    render(() => useCollection("playlist", "pl1"));
    await flush();
    expect(seen).toMatchObject({ loading: true, data: { type: "playlist", author: "Me", tracks: [{ id: "p1" }] } });
    rest.resolve([track("p2")]);
    await flush();
    expect(seen).toMatchObject({ loading: false, data: { tracks: [{ id: "p1" }, { id: "p2" }] } });
  });

  it("paints a page seen this session at once while it asks again", async () => {
    catalog.album.mockResolvedValue({ id: "al3", title: "Seen", artists: [], tracks: [] });
    render(() => useCollection("album", "al3"));
    await flush();
    act(() => root.unmount());
    root = createRoot(document.createElement("div"));
    catalog.album.mockReturnValue(new Promise(() => undefined));
    render(() => useCollection("album", "al3"));
    expect(seen).toMatchObject({ data: { title: "Seen" } });
  });
});

describe("artistTopTrack", () => {
  it("is the artist's first song, or undefined when the catalog fails", async () => {
    catalog.artist.mockResolvedValueOnce({
      id: "ar9",
      name: "N",

      tracks: [track("top"), track("second")],
      albums: [],
      singles: [],
      similar: [],
    });
    expect((await artistTopTrack("ar9"))?.id).toBe("top");
    catalog.artist.mockRejectedValueOnce(new Error("bot-check"));
    expect(await artistTopTrack("ar9")).toBeUndefined();
  });
});

describe("entityTracks", () => {
  it("lists every track of an album, a playlist's later pages included, and nothing when the catalog fails", async () => {
    catalog.album.mockResolvedValue({ id: "al", title: "A", tracks: [track("t1")], artists: [] });
    catalog.playlist.mockResolvedValue({ id: "pl", title: "P", tracks: [track("t2")], more: async () => [track("t3")] });
    catalog.artist.mockRejectedValue(new Error("down"));
    expect((await entityTracks("album", "al")).map((t) => t.id)).toEqual(["t1"]);
    expect((await entityTracks("playlist", "pl")).map((t) => t.id)).toEqual(["t2", "t3"]);
    await expect(entityTracks("artist", "ar")).resolves.toEqual([]);
  });
});
