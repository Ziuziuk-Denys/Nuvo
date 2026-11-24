import { expect, it } from "vitest";
import type { LibraryItemViewModel } from "../../ports/library";
import type { Track } from "../../ports/player";
import { moreBy } from "./moreBy";

const song = (album: string, artist: { id: string; name: string }) =>
  ({
    id: `t-${album}`,
    title: album,
    artists: artist.name,
    artistId: artist.id,
    artistList: [artist],
    album: { id: `al-${album}`, title: album },
    coverUrl: "",
    durationMs: 1,
  }) as Track;
const saved = (id: string, title: string, creator: string) => ({ kind: "album", id, title, creator, imageUrl: "" }) as unknown as LibraryItemViewModel;
const SZA = { id: "a1", name: "SZA" };

it("gathers loaded, saved and liked releases of the artist once each, without the open album", () => {
  const list = moreBy({
    albumId: "al-SOS",
    artist: SZA,
    loaded: [{ id: "al-Ctrl", kind: "album", title: "Ctrl", coverUrl: "" }],
    saved: [saved("s1", "Z", "sza"), saved("s2", "CTRL", "SZA"), saved("s3", "Melodrama", "Lorde")],
    liked: [song("SOS", SZA), song("Ctrl", SZA), song("Lana", SZA), song("Melodrama", { id: "a2", name: "Lorde" })],
  });
  expect(list.map((release) => release.title)).toEqual(["Ctrl", "Z", "Lana"]);
});

it("has nothing to show for an artist the library does not know", () => {
  expect(moreBy({ albumId: "x", artist: { name: "Nobody" }, loaded: [], saved: [saved("s", "Z", "SZA")], liked: [song("Ctrl", SZA)] })).toEqual([]);
});
