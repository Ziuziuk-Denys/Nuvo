import { describe, expect, it } from "vitest";
import type { LibraryItemViewModel, LibraryPlaylistSummary } from "../../ports/library";
import { buildEntries, sortEntries, sortLocal, visibleEntries } from "./libraryModel";

const t = (key: string, vars?: Record<string, string | number>) => (vars ? `${key}(${Object.values(vars).join(",")})` : key);

function playlist(id: string, title: string, updatedAt: string): LibraryPlaylistSummary {
  return { id, title, trackCount: 3, coverUrl: "", coverUrls: [], updatedAt, createdAt: updatedAt, revision: 1, sortMode: "manual", pinnedOffline: false };
}

function item(kind: "album" | "artist" | "playlist", id: string, title: string, addedAt: string, creator?: string): LibraryItemViewModel {
  return { id, title, imageUrl: "", kind, type: kind, owned: false, href: `/${kind}?id=${id}`, addedAt, creator };
}

const playlists = [playlist("p1", "Zebra mix", "2026-01-03T00:00:00Z"), playlist("p2", "Елка", "2026-01-01T00:00:00Z")];
const items = [
  item("album", "a1", "Album B", "2026-01-05T00:00:00Z", "Velvet Hour"),
  item("album", "a2", "Album A", "2026-01-02T00:00:00Z", "Northern Lights"),
  item("artist", "r1", "Мурашки", "2026-01-04T00:00:00Z"),
];
const entries = buildEntries({ likedCount: 40, playlists, items, t });

describe("libraryModel", () => {
  it("puts Liked songs first in All and Playlists", () => {
    for (const tab of ["all", "playlists"] as const) {
      const shown = visibleEntries(entries, tab, "");
      expect(shown[0].kind, tab).toBe("liked");
      expect(shown.filter((entry) => entry.kind === "liked")).toHaveLength(1);
    }
  });

  it("leaves Liked songs out of Albums and Artists", () => {
    expect(visibleEntries(entries, "albums", "").map((entry) => entry.id)).toEqual(["a1", "a2"]);
    expect(visibleEntries(entries, "artists", "").map((entry) => entry.id)).toEqual(["r1"]);
  });

  it("lists the rest newest first", () => {
    expect(visibleEntries(entries, "playlists", "").map((entry) => entry.id)).toEqual(["likes", "p1", "p2"]);
  });

  it("matches ё as е and ignores case", () => {
    expect(visibleEntries(entries, "all", "ёлка").map((entry) => entry.id)).toEqual(["p2"]);
    expect(visibleEntries(entries, "all", "МУРАШ").map((entry) => entry.id)).toEqual(["r1"]);
  });

  it("filters by the artist in the subtitle", () => {
    expect(visibleEntries(entries, "all", "velvet").map((entry) => entry.id)).toEqual(["a1"]);
  });

  it("carries the percent of a playlist whose import still runs", () => {
    const importing = new Map([["p2", { done: 340, total: 3700 }]]);
    const result = buildEntries({ likedCount: 0, playlists, items, importing, t });
    expect(result.find((entry) => entry.id === "p2")?.importing).toBe(9);
    expect(result.find((entry) => entry.id === "p1")?.importing).toBeUndefined();
    expect(buildEntries({ likedCount: 0, playlists, items, t }).some((entry) => entry.importing !== undefined)).toBe(false);
  });

  it("shows a playlist without its own cover with its first song's cover, and its own cover first", () => {
    const covered = [
      {
        ...playlist("p1", "Imported", "2026-01-03T00:00:00Z"),
        coverUrls: ["https://i.ytimg.com/vi/a/hqdefault.jpg", "https://i.ytimg.com/vi/b/hqdefault.jpg"],
      },
      { ...playlist("p2", "Own cover", "2026-01-01T00:00:00Z"), coverUrl: "nuvo-core://local/cover", coverUrls: ["https://i.ytimg.com/vi/c/hqdefault.jpg"] },
      playlist("p3", "Empty", "2026-01-01T00:00:00Z"),
    ];
    const result = buildEntries({ likedCount: 0, playlists: covered, items: [], t });
    expect(["p1", "p2", "p3"].map((id) => result.find((entry) => entry.id === id)?.cover)).toEqual([
      "https://i.ytimg.com/vi/a/hqdefault.jpg",
      "nuvo-core://local/cover",
      null,
    ]);
  });

  it("starts at 0 percent while the total is not known yet", () => {
    const importing = new Map([["p1", { done: 0, total: 0 }]]);
    expect(buildEntries({ likedCount: 0, playlists, items, importing, t }).find((entry) => entry.id === "p1")?.importing).toBe(0);
  });
  it("sorts by title, artist, last play and plays, keeping Liked songs first", () => {
    const all = visibleEntries(entries, "all", "");
    const ids = (sort: Parameters<typeof sortEntries>[1], plays = new Map()) => sortEntries(all, sort, plays).map((entry) => entry.id);
    expect(ids("added")).toEqual(["likes", "a1", "r1", "p1", "a2", "p2"]);
    expect(ids("title")).toEqual(["likes", "a2", "a1", "p1", "p2", "r1"]);
    expect(ids("artist")).toEqual(["likes", "a2", "p1", "p2", "a1", "r1"]);
    const plays = new Map([
      ["album:a2", { plays: 9, lastPlayedAt: "2026-01-01T00:00:00Z" }],
      ["playlist:p2", { plays: 2, lastPlayedAt: "2026-02-01T00:00:00Z" }],
    ]);
    expect(ids("plays", plays).slice(0, 3)).toEqual(["likes", "a2", "p2"]);
    expect(ids("played", plays).slice(0, 4)).toEqual(["likes", "p2", "a2", "a1"]);
  });
  it("sorts files on this computer by title, album and plays, and keeps the scan's artist order", () => {
    const tracks = [
      { title: "b", artists: "Z", album: { title: "2" }, playCount: 1 },
      { title: "a", artists: "Y", album: { title: "3" }, playCount: 5 },
      { title: "c", artists: "X", album: { title: "1" } },
    ];
    expect(sortLocal(tracks, "artist")).toBe(tracks);
    expect(sortLocal(tracks, "title").map((track) => track.title)).toEqual(["a", "b", "c"]);
    expect(sortLocal(tracks, "album").map((track) => track.title)).toEqual(["c", "b", "a"]);
    expect(sortLocal(tracks, "plays").map((track) => track.title)).toEqual(["a", "b", "c"]);
  });
});
