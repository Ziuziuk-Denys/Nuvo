import { describe, expect, it } from "vitest";
import type { SearchResult } from "../../ports/search";
import { PALETTE_COLLECTIONS, PALETTE_SONGS, paletteResults } from "./paletteModel";

const result = (kind: SearchResult["kind"], id: string): SearchResult => ({ kind, id, title: id, subtitle: "", cover: "" });

describe("paletteResults", () => {
  it("leads with the catalogue's best match and lists library songs before catalogue songs", () => {
    const local = [result("song", "liked-1"), result("playlist", "mine")];
    const online = [result("artist", "lorde"), result("song", "web-1"), result("album", "melodrama")];
    const found = paletteResults(local, online);
    expect(found.top?.id).toBe("lorde");
    expect(found.songs.map((song) => song.id)).toEqual(["liked-1", "web-1"]);
    expect(found.collections.map((entry) => entry.id)).toEqual(["mine", "melodrama"]);
  });

  it("falls back to the library offline and never repeats the top result", () => {
    const local = [result("song", "a"), result("song", "b")];
    const found = paletteResults(local, []);
    expect(found.top?.id).toBe("a");
    expect(found.songs.map((song) => song.id)).toEqual(["b"]);
  });

  it("drops a song both sources return and caps each group", () => {
    const songs = Array.from({ length: 9 }, (_, index) => result("song", `s${index}`));
    const albums = Array.from({ length: 9 }, (_, index) => result("album", `a${index}`));
    const found = paletteResults([songs[1]], [result("artist", "x"), ...songs, ...albums]);
    expect(found.songs).toHaveLength(PALETTE_SONGS);
    expect(new Set(found.songs.map((song) => song.id)).size).toBe(PALETTE_SONGS);
    expect(found.collections).toHaveLength(PALETTE_COLLECTIONS);
  });

  it("is empty for nothing", () => {
    expect(paletteResults([], [])).toEqual({ top: null, songs: [], collections: [] });
  });
});
