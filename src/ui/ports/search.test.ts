import { describe, expect, it, vi } from "vitest";
import { toSearchResult } from "./search";

vi.mock("@/youtubeBoot", () => ({ getYoutube: () => ({ catalog: { search: vi.fn() } }) }));

const cover = { url: "https://lh3.googleusercontent.com/x", width: 120, height: 120 };

describe("toSearchResult", () => {
  it("shapes catalog items as rows with covers and links", () => {
    expect(toSearchResult({ kind: "artist", id: "UC1", name: "Queen", cover })).toEqual({
      kind: "artist",
      id: "UC1",
      title: "Queen",
      subtitle: "",
      cover: cover.url,
      href: "/artist?id=UC1",
    });
    expect(
      toSearchResult({
        kind: "album",
        id: "MPRE 1",
        title: "Opera",
        artists: [
          { id: "q", name: "Queen" },
          { id: "b", name: "Bowie" },
        ],
      }),
    ).toEqual({
      kind: "album",
      id: "MPRE 1",
      title: "Opera",
      subtitle: "Queen, Bowie",
      cover: "",
      href: "/collection?type=album&id=MPRE%201",
    });
    expect(toSearchResult({ kind: "playlist", id: "PL1", title: "Mix", author: "Me", cover })).toMatchObject({
      kind: "playlist",
      subtitle: "Me",
      href: "/collection?type=playlist&id=PL1",
    });
    const song = toSearchResult({ kind: "track", id: "s1", title: "Song", artists: [{ id: "q", name: "Queen" }], durationMs: 1000, explicit: false, cover });
    expect(song).toMatchObject({ kind: "song", id: "s1", subtitle: "Queen", cover: cover.url, durationMs: 1000, track: { id: "s1", playCount: 0 } });
  });
});
