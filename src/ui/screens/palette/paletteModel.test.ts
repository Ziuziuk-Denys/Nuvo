import { describe, expect, it } from "vitest";
import type { SearchResult } from "../../ports/search";
import { filteredResults, PALETTE_OTHERS, PALETTE_SONGS, paletteResults } from "./paletteModel";

const result = (kind: SearchResult["kind"], id: string, title = id): SearchResult => ({ kind, id, title, subtitle: "", cover: "" });
const song = (id: string, title = id): SearchResult => ({ ...result("song", id, title), subtitle: "Artist", track: { id } as SearchResult["track"] });
const ids = (results: readonly SearchResult[]) => results.map((item) => item.id);

describe("paletteResults", () => {
  it("leads with the catalogue's best match and lists library songs before catalogue songs", () => {
    const local = [song("liked-1"), result("playlist", "mine")];
    const online = [result("artist", "lorde"), song("web-1"), result("album", "melodrama")];
    const found = paletteResults({ local, suggested: [], online });
    expect(found.top?.id).toBe("lorde");
    expect(ids(found.songs)).toEqual(["liked-1", "web-1"]);
    expect(ids(found.others)).toEqual(["mine", "melodrama"]);
  });

  it("keeps a suggestion's place when the full results arrive, and takes their fuller copy of a song", () => {
    const suggested = [result("artist", "scott"), result("artist", "travis"), song("fein"), song("goosebumps")];
    const early = paletteResults({ local: [], suggested, online: [] });
    const online = [result("artist", "travis"), song("web"), { ...song("fein"), durationMs: 5 }, song("goosebumps"), result("artist", "barker")];
    const late = paletteResults({ local: [], suggested, online });
    expect([early.top?.id, ids(early.others), ids(early.songs)]).toEqual(["scott", ["travis"], ["fein", "goosebumps"]]);
    expect([late.top?.id, ids(late.others), ids(late.songs)]).toEqual(["scott", ["travis", "barker"], ["fein", "goosebumps", "web"]]);
    expect(late.songs[0].durationMs).toBe(5);
  });

  it("falls back to the library offline and never repeats the top result", () => {
    const found = paletteResults({ local: [song("a"), song("b")], suggested: [], online: [] });
    expect(found.top?.id).toBe("a");
    expect(ids(found.songs)).toEqual(["b"]);
  });

  it("caps the songs and the rest, and leaves room for albums beside the artists", () => {
    const many = (kind: SearchResult["kind"]) => Array.from({ length: 9 }, (_, index) => result(kind, `${kind}${index}`));
    const found = paletteResults({ local: [], suggested: [], online: [result("artist", "x"), ...many("song"), ...many("artist"), ...many("album")] });
    expect(found.songs).toHaveLength(PALETTE_SONGS);
    expect(found.others).toHaveLength(PALETTE_OTHERS);
    expect(ids(found.others)).toEqual(["artist0", "artist1", "album0"]);
  });

  it("is empty for nothing", () => {
    expect(paletteResults({ local: [], suggested: [], online: [] })).toEqual({ top: null, songs: [], others: [] });
  });
});

describe("filteredResults", () => {
  it("keeps one kind, its best match on top, suggestions first", () => {
    const online = [song("s1"), result("artist", "a1"), result("artist", "a2"), result("album", "m1")];
    const found = filteredResults({ local: [song("liked")], suggested: [result("artist", "a2"), song("s2")], online }, "artists");
    expect([found.top?.id, ids(found.rest)]).toEqual(["a2", ["a1"]]);
    const songs = filteredResults({ local: [song("liked")], suggested: [], online }, "songs");
    expect([songs.top?.id, ids(songs.rest)]).toEqual(["s1", ["liked"]]);
    expect(filteredResults({ local: [], suggested: [], online }, "playlists")).toEqual({ top: null, rest: [] });
  });
});
