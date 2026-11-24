import { describe, expect, it } from "vitest";
import type { HomeMix, Track } from "../../../ports/recs";
import { DISCOVER, FOR_YOU } from "../homeModel";
import { FULL_TRACKS, MIN_TRACKS, place, ringFor, ringOffset, ringSlots, ringTracks } from "./ring";

const track = (id: string) => ({ id, title: id, artists: [], coverUrl: "" }) as unknown as Track;
const mix = (id: string, ids: string[]) => ({ id, title: id, description: "", tracks: ids.map(track) }) as unknown as HomeMix;
const ids = (prefix: string, count: number) => Array.from({ length: count }, (_, index) => `${prefix}${index}`);

describe("ringTracks", () => {
  it("puts a familiar track in every fourth slot and new tracks everywhere else", () => {
    const tracks = ringTracks([mix(FOR_YOU, ids("k", 10)), mix(DISCOVER, ids("n", 24))]);
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
    expect(young.map((item) => item.id)).toEqual(ids("k", FULL_TRACKS));
    const some = ringTracks([mix(FOR_YOU, ids("k", 25)), mix(DISCOVER, ids("n", 3))]);
    expect(some.map((item) => item.id)).toEqual(["n0", "n1", "n2", ...ids("k", FULL_TRACKS - 3)]);
    expect(ringTracks([mix(FOR_YOU, ["k0", "k1"])])).toHaveLength(2);
    expect(ringTracks([])).toEqual([]);
  });

  it.each([5, 8, 13])("fills %i new songs to one full ring", (fresh) => {
    expect(ringTracks([mix(FOR_YOU, ids("k", 40)), mix(DISCOVER, ids("n", fresh))])).toHaveLength(FULL_TRACKS);
  });

  it("leaves a ring of many new songs alone", () => {
    const many = ringTracks([mix(FOR_YOU, ids("k", 40)), mix(DISCOVER, ids("n", 24))]);
    expect(many).toHaveLength(24);
    expect(many.filter((item) => item.id.startsWith("n"))).toHaveLength(18);
  });

  it("fills with one song of an album", () => {
    const of = (id: string, album: string) => ({ ...track(id), album: { id: album, title: album } });
    const albums = { ...mix(FOR_YOU, []), tracks: [of("a1", "A"), of("a2", "A"), of("b1", "B"), of("n1", "N")] };
    const fresh = { ...mix(DISCOVER, []), tracks: [of("n0", "N")] };
    expect(ringTracks([albums, fresh]).map((item) => item.id)).toEqual(["n0", "a1", "b1"]);
    const covers = { ...mix(FOR_YOU, []), tracks: ["1", "2", "1"].map((art, index) => ({ ...track(`c${index}`), coverUrl: art })) };
    expect(ringTracks([covers]).map((item) => item.id)).toEqual(["c0", "c1"]);
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

  it("reaches as far out on both sides as a ring of any length at every width", () => {
    expect(FULL_TRACKS % 2).toBe(1);
    const reach = (width: number, last: number) => {
      const ring = ringFor(width, 460, 64);
      const ends = Array.from({ length: last + 1 }, (_, offset) => place(ring, offset)).filter((spot) => spot !== null);
      return Math.min(width, Math.max(...ends.map((spot) => spot.x + (ring.cover * spot.scale * Math.cos((spot.turn * Math.PI) / 180)) / 2)));
    };
    for (const width of [640, 1100, 1440, 1920, 2560]) {
      expect(reach(width, (FULL_TRACKS - 1) / 2)).toBe(reach(width, 40));
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
