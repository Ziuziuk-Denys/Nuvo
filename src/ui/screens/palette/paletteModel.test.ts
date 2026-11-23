import { describe, expect, it } from "vitest";
import type { SearchResult } from "../../ports/search";
import { PALETTE_ARTISTS, PALETTE_COLLECTIONS, PALETTE_SONGS, paletteResults } from "./paletteModel";

const result = (kind: SearchResult["kind"], id: string, title = id): SearchResult => ({ kind, id, title, subtitle: "", cover: "" });
const song = (id: string, title = id): SearchResult => ({ ...result("song", id, title), subtitle: "Artist", track: { id } as SearchResult["track"] });
const ids = (results: readonly SearchResult[]) => results.map((item) => item.id);

describe("paletteResults", () => {
  it("leads with the catalogue's best match and lists library songs before catalogue songs", () => {
    const local = [result("song", "liked-1"), result("playlist", "mine")];
    const online = [result("artist", "lorde"), result("song", "web-1"), result("album", "melodrama")];
    const found = paletteResults({ local, suggested: [], online });
    expect(found.top?.id).toBe("lorde");
    expect(ids(found.songs)).toEqual(["liked-1", "web-1"]);
    expect(ids(found.collections)).toEqual(["mine", "melodrama"]);
  });

  it("keeps a suggestion's place when the full results arrive, and takes their fuller copy of a song", () => {
    const suggested = [result("artist", "scott"), result("artist", "travis"), song("fein"), song("goosebumps")];
    const early = paletteResults({ local: [], suggested, online: [] });
    const online = [result("artist", "travis"), song("web"), { ...song("fein"), durationMs: 5 }, song("goosebumps"), result("artist", "barker")];
    const late = paletteResults({ local: [], suggested, online });
    expect([early.top?.id, ids(early.artists), ids(early.songs)]).toEqual(["scott", ["travis"], ["fein", "goosebumps"]]);
    expect([late.top?.id, ids(late.artists), ids(late.songs)]).toEqual(["scott", ["travis", "barker"], ["fein", "goosebumps", "web"]]);
    expect(late.songs[0].durationMs).toBe(5);
  });

  it("falls back to the library offline and never repeats the top result", () => {
    const found = paletteResults({ local: [result("song", "a"), result("song", "b")], suggested: [], online: [] });
    expect(found.top?.id).toBe("a");
    expect(ids(found.songs)).toEqual(["b"]);
  });

  it("lists one song once even under two ids, and caps each group", () => {
    const songs = Array.from({ length: 9 }, (_, index) => song(`s${index}`));
    const artists = Array.from({ length: 9 }, (_, index) => result("artist", `r${index}`));
    const albums = Array.from({ length: 9 }, (_, index) => result("album", `a${index}`));
    const found = paletteResults({ local: [songs[1]], suggested: [song("other-id", "s1")], online: [result("artist", "x"), ...songs, ...artists, ...albums] });
    expect(ids(found.songs)).toEqual(["s0", "s2", "s3", "s4"]);
    expect(found.songs).toHaveLength(PALETTE_SONGS);
    expect(found.artists).toHaveLength(PALETTE_ARTISTS);
    expect(found.collections).toHaveLength(PALETTE_COLLECTIONS);
  });

  it("is empty for nothing", () => {
    expect(paletteResults({ local: [], suggested: [], online: [] })).toEqual({ top: null, songs: [], artists: [], collections: [] });
  });
});
