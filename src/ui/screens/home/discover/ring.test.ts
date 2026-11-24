import { describe, expect, it } from "vitest";
import type { HomeMix, Track } from "../../../ports/recs";
import { DISCOVER, FOR_YOU } from "../homeModel";
import { MIN_TRACKS, place, ringFor, ringOffset, ringSlots, ringTracks } from "./ring";

const track = (id: string): Track => ({ id, title: id, artists: "", coverUrl: "", durationMs: 1 });
const mix = (id: string, ids: string[]) => ({ id, title: id, description: "", tracks: ids.map(track) }) as unknown as HomeMix;
const ids = (prefix: string, count: number) => Array.from({ length: count }, (_, index) => `${prefix}${index}`);

describe("ringTracks", () => {
  it("puts a familiar track in every fourth slot and new tracks everywhere else", () => {
    const tracks = ringTracks([mix(FOR_YOU, ids("k", 10)), mix(DISCOVER, ids("n", 12))]);
    expect(tracks.map((item) => item.id).slice(0, 8)).toEqual(["n0", "n1", "n2", "k0", "n3", "n4", "n5", "k1"]);
    expect(tracks.filter((item) => item.id.startsWith("k")).length / tracks.length).toBeLessThanOrEqual(0.25);
  });

  it("skips a familiar track already among the new ones and caps the ring", () => {
    const tracks = ringTracks([mix(FOR_YOU, ["n1", ...ids("k", 20)]), mix(DISCOVER, ids("n", 40))]);
    expect(tracks).toHaveLength(24);
    expect(new Set(tracks.map((item) => item.id)).size).toBe(24);
  });

  it("shows with the first taste: familiar songs fill the ring while new ones are few", () => {
    const young = ringTracks([mix(FOR_YOU, ids("k", 25))]);
    expect(young.map((item) => item.id)).toEqual(ids("k", MIN_TRACKS));
    const some = ringTracks([mix(FOR_YOU, ids("k", 25)), mix(DISCOVER, ids("n", 3))]);
    expect(some.map((item) => item.id)).toEqual(["n0", "n1", "n2", "k0", "k1", "k2", "k3", "k4"]);
    expect(ringTracks([mix(FOR_YOU, ["k0", "k1"])])).toHaveLength(2);
    expect(ringTracks([])).toEqual([]);
  });

  it("repeats a short list so the ring is always full", () => {
    expect(ringSlots(2)).toBe(MIN_TRACKS);
    expect(ringSlots(3)).toBe(9);
    expect(ringSlots(11)).toBe(11);
    expect(ringSlots(0)).toBe(0);
  });
});

describe("ringOffset", () => {
  it("takes the short way round the ring", () => {
    expect(ringOffset(1, 0, 10)).toBe(1);
    expect(ringOffset(9, 0, 10)).toBe(-1);
    expect(ringOffset(0, 9.5, 10)).toBeCloseTo(0.5);
    expect(ringOffset(3, 3, 10)).toBe(0);
  });
});

describe("place", () => {
  it("keeps every visible cover below the heading at every width", () => {
    for (const width of [640, 900, 1100, 1400, 2000]) {
      const ring = ringFor(width, 460, 64);
      for (let offset = -12; offset <= 12; offset += 0.25) {
        const spot = place(ring, offset);
        if (!spot) continue;
        expect(spot.y - (ring.cover * spot.scale) / 2).toBeGreaterThanOrEqual(64 - 0.5);
      }
    }
  });

  it("runs covers off both edges and leaves the centre one largest", () => {
    const ring = ringFor(1100, 460, 64);
    const centre = place(ring, 0)!;
    const side = place(ring, 2)!;
    expect(centre.x).toBeCloseTo(550);
    expect(centre.scale).toBeGreaterThan(side.scale);
    const shown = Array.from({ length: 25 }, (_, index) => place(ring, index - 12)).filter(Boolean);
    expect(shown.some((spot) => spot!.x - (ring.cover * spot!.scale) / 2 < 0)).toBe(true);
    expect(shown.some((spot) => spot!.x + (ring.cover * spot!.scale) / 2 > 1100)).toBe(true);
  });
});

it("shows one cover per album art and keeps one artist's songs apart", () => {
  const song = (id: string, artists: string, coverUrl = id) => ({ id, title: id, artists, coverUrl, durationMs: 1 });
  const tracks = [song("a1", "A"), song("a2", "A"), song("b1", "B"), song("b2", "B", "b1"), song("c1", "C")];
  expect(ringTracks([{ id: "daily-mix-discover", title: "", description: "", tracks }]).map((track) => track.id)).toEqual(["a1", "b1", "c1", "a2"]);
});

it("counts an album as one cover even when its songs carry it under other addresses", () => {
  const song = (id: string, album?: string): Track => ({
    id,
    title: id,
    artists: id,
    coverUrl: id,
    durationMs: 1,
    ...(album ? { album: { id: album, title: album } } : {}),
  });
  const tracks = [song("a1", "A"), song("a2", "A"), song("b"), song("c")];
  expect(ringTracks([{ id: "daily-mix-discover", title: "", description: "", tracks }]).map((track) => track.id)).toEqual(["a1", "b", "c"]);
});
