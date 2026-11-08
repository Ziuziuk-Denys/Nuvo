import { describe, expect, it } from "vitest";
import type { Track } from "../../ports/player";
import { cleanTitle, duplicateGroups, extraItemIds } from "./duplicates";

const track = (id: string, title: string, artists: string, item: string): Track => ({
  id,
  title,
  artists,
  coverUrl: "",
  durationMs: 1,
  playCount: 0,
  playlistItemId: item,
});

describe("duplicates", () => {
  it("cleans brackets, video words, remaster tags and featuring credits", () => {
    expect(cleanTitle("Song (Official Music Video)")).toBe("song");
    expect(cleanTitle("Song - Remastered 2011")).toBe("song");
    expect(cleanTitle("Song feat. Someone")).toBe("song");
    expect(cleanTitle("  Song   [Lyrics] ")).toBe("song");
  });

  it("groups the same song by cleaned title and first artist; the first added stays", () => {
    const tracks = [
      track("a", "Song", "Artist", "i1"),
      track("b", "Other", "Artist", "i2"),
      track("c", "Song (Official Video)", "Artist, Guest", "i3"),
      track("a", "Song", "Artist", "i4"),
    ];
    const groups = duplicateGroups(tracks);
    expect(groups.map((group) => group.map((t) => t.playlistItemId))).toEqual([["i1", "i3", "i4"]]);
    expect(extraItemIds(groups)).toEqual(["i3", "i4"]);
  });

  it("keeps the same title by another artist apart", () => {
    expect(duplicateGroups([track("a", "Song", "One", "i1"), track("b", "Song", "Two", "i2")])).toEqual([]);
  });

  it("keeps a remix apart from the original", () => {
    expect(duplicateGroups([track("a", "Song", "One", "i1"), track("b", "Song (Skrillex Remix)", "One", "i2")])).toEqual([]);
  });

  it("groups the same track id even when the titles differ", () => {
    const groups = duplicateGroups([track("a", "Song", "One", "i1"), track("a", "Song (Radio Edit)", "Two", "i2")]);
    expect(extraItemIds(groups)).toEqual(["i2"]);
  });
});
