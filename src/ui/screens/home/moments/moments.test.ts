import { describe, expect, it } from "vitest";
import type { Play } from "../../../ports/homeMoments";
import { dayOf, daysBack, sessionsOf, spreadOver, whenOf } from "./moments";

const NOW = new Date(2026, 10, 24, 14, 0).getTime();
const at = (day: number, hour: number, minute = 0) => new Date(2026, 10, day, hour, minute).getTime();

function play(id: string, session: string, when: number, extra: Partial<Play> & { artist?: string; album?: string } = {}): Play {
  const { artist = `artist ${id}`, album, ...rest } = extra;
  return {
    session,
    at: when,
    playedMs: 180_000,
    completed: true,
    context: null,
    track: { id, title: id, artists: artist, coverUrl: "", durationMs: 180_000, ...(album ? { album: { id: album, title: album } } : {}) },
    ...rest,
  };
}

describe("sessionsOf", () => {
  it("groups plays, drops short and current ones, and puts the latest first", () => {
    const found = sessionsOf(
      [
        ...["a", "b", "c", "a"].map((id, index) => play(id, "old", at(20, 9, index * 4))),
        ...["d", "e"].map((id, index) => play(id, "short", at(21, 9, index * 4))),
        ...["f", "g", "h"].map((id, index) => play(id, "late", at(23, 21, index * 4), { completed: index < 2 })),
        ...["i", "j", "k"].map((id, index) => play(id, "now", at(24, 13, 45 + index * 4))),
      ],
      new Map(),
      NOW,
      4,
    );
    expect(found.map((session) => session.id)).toEqual(["late", "old"]);
    expect(found[0].lastCompleted).toBe(false);
    expect(found[1].songs.map((track) => track.id)).toEqual(["b", "c", "a"]);
    expect(found[1].listenedMs).toBe(720_000);
  });

  it("names a session by its own playlist, then album, then artist, then two artists", () => {
    const three = (session: string, day: number, extra: (index: number) => Parameters<typeof play>[3]) =>
      [0, 1, 2].map((index) => play(`${session}${index}`, session, at(day, 10, index * 4), extra(index)));
    const found = sessionsOf(
      [
        ...three("list", 23, () => ({ context: { type: "playlist", id: "p1" } })),
        ...three("gone", 22, () => ({ context: { type: "playlist", id: "deleted" } })),
        ...three("album", 21, () => ({ album: "Blue", artist: "X" })),
        ...three("artist", 20, (index) => ({ artist: "Y", album: `album ${index}` })),
      ],
      new Map([["p1", "Late night"]]),
      NOW,
      9,
    );
    expect(found.map((session) => session.source)).toEqual([
      { kind: "playlist", name: "Late night" },
      { kind: "artists", names: ["artist gone0", "artist gone1"] },
      { kind: "album", name: "Blue" },
      { kind: "artist", name: "Y" },
    ]);
    expect(found.map((session) => session.playlistId)).toEqual(["p1", null, null, null]);
  });
});

it("says when in words", () => {
  const key = (when: number) => whenOf(when, NOW, "en").key;
  expect(key(at(24, 9))).toBe("this_morning");
  expect(key(at(24, 1))).toBe("last_night");
  expect(key(at(23, 23))).toBe("last_night");
  expect(key(at(23, 20))).toBe("yesterday_evening");
  expect(whenOf(at(22, 15), NOW, "en")).toEqual({ key: "weekday_afternoon", day: "Sunday" });
  expect(whenOf(at(22, 15), NOW, "ru").day).toBe("Воскресенье");
  expect(whenOf(at(10, 15), NOW, "en")).toEqual({ key: "date", day: "November 10" });
});

it("looks back to the same day, and to the last day of a shorter month", () => {
  const days = daysBack(new Date(2026, 11, 31, 12).getTime());
  const start = (key: string) => new Date(days.find((day) => day.key === key)!.from).toDateString();
  expect(start("half_year")).toBe("Tue Jun 30 2026");
  expect(start("month")).toBe("Mon Nov 30 2026");
  expect(start("week")).toBe("Thu Dec 24 2026");
  expect(days[0]).toMatchObject({ key: "years", count: 3 });
  expect(days.every((day) => day.to > day.from)).toBe(true);
});

it("keeps a day's distinct songs in the order heard, the longest heard when there are many", () => {
  expect(dayOf([play("a", "s", 1), play("a", "s", 2), play("b", "s", 3)])).toBeNull();
  const many = Array.from({ length: 15 }, (_, index) => play(`t${index}`, "s", index, { playedMs: index < 3 ? 1 : 100 + index }));
  expect(dayOf(many)!.map((song) => song.track.id)).toEqual(many.slice(3).map((song) => song.track.id));
});

describe("spreadOver", () => {
  it("follows the clock when there is room", () => {
    expect(spreadOver([0, 50, 100], 0, 100, 1100, 100, 10)).toEqual([0, 500, 1000]);
  });
  it("keeps covers apart and inside the line", () => {
    const places = spreadOver([0, 1, 2, 3, 100], 0, 100, 600, 100, 10);
    expect(places.every((place, index) => index === 0 || place - places[index - 1] >= 109.9)).toBe(true);
    expect(places[0]).toBeGreaterThanOrEqual(0);
    expect(places[4]).toBeLessThanOrEqual(500);
  });
  it("overlaps evenly when the line is too short", () => {
    expect(spreadOver([0, 1, 2], 0, 2, 200, 100, 10)).toEqual([0, 50, 100]);
  });
});
