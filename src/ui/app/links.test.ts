import { describe, expect, it } from "vitest";
import { linkPath } from "./links";

describe("deeplinks", () => {
  it("maps each target to its page", () => {
    expect(linkPath({ type: "artist", id: "UC1" })).toBe("/artist?id=UC1");
    expect(linkPath({ type: "album", id: "MPRE x" })).toBe("/collection?type=album&id=MPRE%20x");
    expect(linkPath({ type: "playlist", id: "PL1" })).toBe("/collection?type=playlist&id=PL1");
  });

  it("leaves tracks and shared lists to the handler", () => {
    expect(linkPath({ type: "track", id: "abcdefghijk" })).toBeNull();
    expect(linkPath({ type: "share", id: "x" })).toBeNull();
  });
});
