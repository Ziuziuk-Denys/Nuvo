import { describe, expect, it } from "vitest";
import type { TransitionInput } from "./decks";
import { albumInOrder, crossfadePolicy, seamFlags } from "./transitionPolicy";
import type { QueueEntry } from "../types";

const TEMPO = { rate: 1, semitones: 0, linked: true } as TransitionInput["tempo"]["current"];

const input = (over: Partial<TransitionInput> = {}): TransitionInput => ({
  current: { startMs: 0, endMs: 200_000 },
  next: { startMs: 0, endMs: 180_000 },
  rate: 1,
  crossfadeSeconds: 6,
  nextReady: true,
  albumInOrder: false,
  tempo: { current: TEMPO, next: TEMPO },
  reverb: { current: null, next: null },
  repeat: "off",
  abLoop: false,
  sleepAtTrackEnd: false,
  ...over,
});

const entry = (id: string, album?: string): QueueEntry => ({
  entryId: id,
  order: 0,
  origin: "list",
  track: { id, title: id, artists: "A", coverUrl: "", durationMs: 1, ...(album ? { album: { id: album, title: album } } : {}) },
});

describe("crossfadePolicy", () => {
  it("fades 6 s before the end with the setting at 6", () => {
    expect(crossfadePolicy(input())).toEqual({ kind: "crossfade", startAtMediaMs: 194_000, fadeMs: 6000 });
  });

  it("starts earlier in media time at a slower rate", () => {
    expect(crossfadePolicy(input({ rate: 0.85 })).startAtMediaMs).toBe(200_000 - 6000 * 0.85);
  });

  it("reads the setting on every call, so a change applies to the next seam", () => {
    expect(crossfadePolicy(input({ crossfadeSeconds: 0 })).kind).toBe("gapless");
    expect(crossfadePolicy(input({ crossfadeSeconds: 6 })).kind).toBe("crossfade");
  });

  it("keeps the exact seam for an album in order, repeat one, A-B loop and the sleep stop", () => {
    for (const over of [{ albumInOrder: true }, { repeat: "one" as const }, { abLoop: true }, { sleepAtTrackEnd: true }]) {
      expect(crossfadePolicy(input(over)).kind).toBe("gapless");
    }
  });

  it("never fades longer than half of a short track", () => {
    expect(crossfadePolicy(input({ next: { startMs: 0, endMs: 8000 } })).fadeMs).toBe(4000);
  });

  it("stays gapless when the fade would be under a second", () => {
    expect(crossfadePolicy(input({ next: { startMs: 0, endMs: 1500 } })).kind).toBe("gapless");
  });

  it("falls back to a plain switch when the next deck is not ready", () => {
    expect(crossfadePolicy(input({ nextReady: false })).kind).toBe("plain");
  });
});

describe("albumInOrder", () => {
  it("is true for two neighbours of one album in list order", () => {
    expect(albumInOrder({ entries: [entry("a", "x"), entry("b", "x")], index: 0, shuffle: false })).toBe(true);
  });

  it("is false with shuffle, another album, a missing album or no next entry", () => {
    expect(albumInOrder({ entries: [entry("a", "x"), entry("b", "x")], index: 0, shuffle: true })).toBe(false);
    expect(albumInOrder({ entries: [entry("a", "x"), entry("b", "y")], index: 0, shuffle: false })).toBe(false);
    expect(albumInOrder({ entries: [entry("a"), entry("b")], index: 0, shuffle: false })).toBe(false);
    expect(albumInOrder({ entries: [entry("a", "x")], index: 0, shuffle: false })).toBe(false);
  });
});

describe("seamFlags", () => {
  const none = { plan: null };
  it("an A-B loop with both points set keeps the seam exact", () => {
    expect(seamFlags({ a: 1000, b: 5000 }, none).abLoop).toBe(true);
    expect(seamFlags({ a: 1000, b: null }, none).abLoop).toBe(false);
    expect(seamFlags({ a: null, b: null }, none).abLoop).toBe(false);
    expect(crossfadePolicy(input({ ...seamFlags({ a: 1000, b: 5000 }, none) })).kind).not.toBe("crossfade");
  });

  it("a sleep stop at the track end keeps the seam exact; other targets do not", () => {
    const off = { a: null, b: null };
    const plan = (kind: string) => ({ plan: { target: { kind } } });
    expect(seamFlags(off, plan("end_of_track")).sleepAtTrackEnd).toBe(true);
    expect(seamFlags(off, plan("minutes")).sleepAtTrackEnd).toBe(false);
    expect(seamFlags(off, none).sleepAtTrackEnd).toBe(false);
    expect(crossfadePolicy(input({ ...seamFlags(off, plan("end_of_track")) })).kind).not.toBe("crossfade");
    expect(crossfadePolicy(input({ ...seamFlags(off, plan("minutes")) })).kind).toBe("crossfade");
  });
});
