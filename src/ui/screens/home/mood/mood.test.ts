import { expect, it } from "vitest";
import type { MoodPoint } from "../../../ports/homeMoments";
import { moodName, pickMix, startPlace, tasteRanks } from "./mood";

const point = (id: string, energy: number, brightness: number, extra: Partial<MoodPoint> & { artist?: string } = {}): MoodPoint => {
  const { artist = `artist ${id}`, ...rest } = extra;
  return { track: { id, title: id, artists: artist, coverUrl: "", durationMs: 1 }, energy, brightness, taste: 0, fresh: false, ...rest };
};
const ids = (points: MoodPoint[], at: { x: number; y: number }, size?: number) =>
  pickMix(points, tasteRanks(points), at, size).map((index) => points[index].track.id);

it("picks the songs around the light, nearest first, and grows until the mix is full", () => {
  const points = [point("far", 0.9, 0.9), point("near", 0.2, 0.2), point("middle", 0.4, 0.3)];
  expect(ids(points, { x: 0.2, y: 0.2 })).toEqual(["near", "middle", "far"]);
  expect(ids(points, { x: 0.9, y: 0.9 }, 1)).toEqual(["far"]);
});

it("prefers a liked song and then a known one at the same distance", () => {
  const points = [point("new", 0.5, 0.5, { taste: 1, fresh: true }), point("liked", 0.5, 0.5, { taste: 1 }), point("known", 0.5, 0.5, { taste: -1 })];
  expect(ids(points, { x: 0.5, y: 0.5 })).toEqual(["liked", "new", "known"]);
});

it("keeps one artist from filling the mix", () => {
  const points = Array.from({ length: 6 }, (_, index) => point(`s${index}`, 0.5, 0.5 + index / 100, { artist: "One" }));
  expect(ids(points, { x: 0.5, y: 0.5 })).toHaveLength(3);
});

it("names the place and starts among the liked songs", () => {
  expect(moodName({ x: 0.1, y: 0.9 })).toBe("ui.home.mood.name.low_high");
  expect(moodName({ x: 0.5, y: 1 })).toBe("ui.home.mood.name.mid_high");
  const points = Array.from({ length: 8 }, (_, index) => point(`s${index}`, index < 5 ? 0.2 : 1, 0.4, { taste: index < 5 ? 1 : 0 }));
  expect(startPlace(points).x).toBeCloseTo(0.2);
});
