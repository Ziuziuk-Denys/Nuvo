import { describe, expect, it } from "vitest";
import { formatDuration, formatTotal, formatUpdated, matchTracks, moveTarget, orderTracks, totalMs } from "./entityModel";

const t = (key: string) => key.replace("playlist.", "");

describe("formatTotal", () => {
  it("gives minutes and seconds up to an hour, rounded down", () => {
    expect(formatTotal(3_599_900, t)).toBe("59 min 59 sec");
    expect(formatTotal(3_600_000, t)).toBe("60 min 0 sec");
  });

  it("switches to hours past an hour", () => {
    expect(formatTotal(62_820_000, t)).toBe("17 hr 27 min");
  });

  it("adds up track durations, missing ones as zero", () => {
    expect(totalMs([{ durationMs: 1000 }, { durationMs: 0 }, { durationMs: 2500 }])).toBe(3500);
  });
});

const TRACKS = [
  { title: "ДИНАСТИЯ", artists: "VILLIAN, madk1d", durationMs: 200_000, playCount: 3 },
  { title: "Дві весни", artists: "Jerry Heil", durationMs: 150_000, playCount: 9 },
  { title: "8 миля", artists: "madk1d, VILLIAN", durationMs: 180_000, playCount: 0 },
];

describe("matchTracks", () => {
  it("is null while the query is blank, so the full list shows", () => {
    expect(matchTracks(TRACKS, "   ")).toBeNull();
  });

  it("filters by any word and keeps the original indices", () => {
    expect(matchTracks(TRACKS, "madk1d")?.map((match) => match.index)).toEqual([0, 2]);
    expect(matchTracks(TRACKS, "весни")?.map((match) => match.index)).toEqual([1]);
  });
});

describe("orderTracks", () => {
  it("keeps the playlist order by default", () => {
    expect(orderTracks(TRACKS, "default")).toBe(TRACKS);
  });

  it("sorts by title, duration and plays, stable on ties", () => {
    expect(orderTracks(TRACKS, "title").map((track) => track.title)).toEqual(["8 миля", "Дві весни", "ДИНАСТИЯ"]);
    expect(orderTracks(TRACKS, "duration").map((track) => track.durationMs)).toEqual([150_000, 180_000, 200_000]);
    expect(orderTracks(TRACKS, "popularity").map((track) => track.playCount)).toEqual([9, 3, 0]);
  });
});

describe("moveTarget", () => {
  it("names the item the moved one now sits before", () => {
    expect(moveTarget(["a", "b", "c"], 0, 1)).toEqual({ next: ["b", "a", "c"], before: "c" });
    expect(moveTarget(["a", "b", "c"], 2, 0)).toEqual({ next: ["c", "a", "b"], before: "a" });
    expect(moveTarget(["a", "b", "c"], 1, 2)).toEqual({ next: ["a", "c", "b"], before: null });
  });
});

describe("formatDuration", () => {
  it("is m:ss, and nothing for an unknown length", () => {
    expect(formatDuration(187_400)).toBe("3:07");
    expect(formatDuration(0)).toBeUndefined();
  });
});

describe("formatUpdated", () => {
  const now = new Date(2026, 10, 8, 15, 0).getTime();
  it("reads today, yesterday and days ago, then the date past a month", () => {
    expect(formatUpdated(new Date(2026, 10, 8, 1, 0).toISOString(), "en", now)).toBe("today");
    expect(formatUpdated(new Date(2026, 10, 7, 23, 0).toISOString(), "en", now)).toBe("yesterday");
    expect(formatUpdated(new Date(2026, 10, 5, 12, 0).toISOString(), "en", now)).toBe("3 days ago");
    expect(formatUpdated(new Date(2026, 0, 2, 12, 0).toISOString(), "en", now)).toBe("Jan 2, 2026");
    expect(formatUpdated(new Date(2026, 10, 6, 12, 0).toISOString(), "ru", now)).toBe("позавчера");
    expect(formatUpdated("", "en", now)).toBeUndefined();
    expect(formatUpdated("not a date", "en", now)).toBeUndefined();
  });
});
