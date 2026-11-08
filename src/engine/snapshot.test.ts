import { describe, expect, it } from "vitest";
import { fromSnapshot, toSnapshot } from "./snapshot";
import { track } from "./test/harness";

describe("snapshot", () => {
  it("sends artists as a list and the cover as an object, the shape the daemon keys on", () => {
    const t = track("a", {
      artists: "One, Two",
      artistList: [
        { id: "u1", name: "One" },
        { id: "u2", name: "Two" },
      ],
      coverUrl: "https://c/x.jpg",
      durationMs: 1000,
    });
    expect(toSnapshot(t)).toEqual({
      id: "a",
      title: t.title,
      artists: [
        { id: "u1", name: "One" },
        { id: "u2", name: "Two" },
      ],
      cover: { url: "https://c/x.jpg", width: 512, height: 512 },
      durationMs: 1000,
    });
    expect(toSnapshot(track("b", { artists: "Solo", artistList: undefined, artistId: undefined, coverUrl: "" })).artists).toEqual([
      { id: "unknown", name: "Solo" },
    ]);
  });

  it("reads a daemon snapshot back and rejects one without an id", () => {
    const back = fromSnapshot({
      id: "a",
      title: "T",
      artists: [{ id: "u1", name: "One" }, { name: "Two" }],
      cover: { url: "https://c/x.jpg" },
      durationMs: 2000,
      viewer: { liked: true },
    });
    expect(back).toEqual({
      id: "a",
      title: "T",
      artists: "One, Two",
      artistId: "u1",
      artistList: [
        { id: "u1", name: "One" },
        { id: "", name: "Two" },
      ],
      coverUrl: "https://c/x.jpg",
      durationMs: 2000,
    });
    expect(fromSnapshot({ title: "no id" })).toBeNull();
    expect(fromSnapshot("a")).toBeNull();
    expect(fromSnapshot({ id: "b", artists: "not a list" })).toMatchObject({ id: "b", artists: "", artistList: [], coverUrl: "", durationMs: 0 });
  });
});
