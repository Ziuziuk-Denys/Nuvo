import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHarness, flush, track, y, type Harness } from "./test/harness";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(5_000_000);
});
afterEach(() => vi.useRealTimers());

const A = y("a");
const B = y("b");
const KEPT = { startMs: 30_000, endMs: 150_000 };

async function start(h: Harness) {
  h.engine.setSpans((id) => (id === A ? KEPT : null));
  h.engine.playList([track(A), track(B)]);
  await flush();
  h.deck.duration = 200_000;
}

async function playTo(h: Harness, fromMs: number, toMs: number) {
  for (let at = fromMs; at <= toMs; at += 250) {
    await vi.advanceTimersByTimeAsync(250);
    h.deck.emit("timeupdate", { positionMs: at });
  }
}

describe("trimmed songs", () => {
  it("start at the kept start", async () => {
    const h = createHarness();
    await start(h);
    expect(h.deck.loads[0]).toMatchObject({ trackId: A, positionMs: 30_000 });
  });

  it("end at the kept end like a natural end: a complete play, then the next song", async () => {
    const h = createHarness();
    await start(h);
    await playTo(h, 30_000, 149_750);
    expect(h.reports).toHaveLength(0);
    await playTo(h, 150_000, 150_500);
    await flush();
    expect(h.reports).toHaveLength(1);
    expect(h.reports[0]).toMatchObject({ trackId: A, endReason: "complete", completed: true, skipped: false });
    expect(h.deck.loads.at(-1)?.trackId).toBe(B);
  });

  it("hand over to the prepared deck at the kept end, still a complete play", async () => {
    const h = createHarness();
    await start(h);
    const entryB = h.engine.getView().entries[1].entryId;
    h.deck.prepared = entryB;
    const loads = h.deck.loads.length;
    await playTo(h, 30_000, 150_000);
    await flush();
    expect(h.engine.getView().current?.entryId).toBe(entryB);
    expect(h.deck.loads).toHaveLength(loads);
    expect(h.reports[0]).toMatchObject({ trackId: A, endReason: "complete", completed: true });
  });

  it("loop the kept part under repeat one, as one play", async () => {
    const h = createHarness();
    await start(h);
    h.engine.setRepeat("one");
    await playTo(h, 149_750, 150_000);
    await flush();
    expect(h.deck.loads.at(-1)).toMatchObject({ trackId: A, positionMs: 30_000 });
    h.engine.next();
    expect(h.reports).toHaveLength(1);
    expect(h.reports[0]).toMatchObject({ loopCount: 1, completed: true });
  });

  it("let the decks place the seam at the kept end, never past the file", async () => {
    const h = createHarness();
    const resolver = vi.fn();
    Object.assign(h.deck, { setSpanResolver: resolver });
    h.engine.setSpans((id) => (id === A ? KEPT : null));
    const span = resolver.mock.calls[0][0] as (id: string, durationMs: number) => { startMs: number; endMs: number };
    expect(span(A, 200_000)).toEqual(KEPT);
    expect(span(A, 120_000)).toEqual({ startMs: 30_000, endMs: 120_000 });
    expect(span(B, 200_000)).toEqual({ startMs: 0, endMs: 200_000 });
    h.engine.setSpans(null);
    expect(resolver).toHaveBeenLastCalledWith(null);
  });

  it("restart at the kept start on Previous, and count the restart window from there", async () => {
    const h = createHarness();
    h.engine.setSpans((id) => (id === A ? KEPT : null));
    h.engine.playList([track(B), track(A)]);
    await flush();
    h.engine.next();
    await flush();
    await playTo(h, 30_000, 31_000);
    h.engine.previous();
    expect(h.engine.getView().current?.track.id).toBe(B);
    h.engine.next();
    await flush();
    await playTo(h, 30_000, 40_000);
    h.engine.previous();
    expect(h.engine.getView().current?.track.id).toBe(A);
    expect(h.deck.seeks.at(-1)).toBe(30_000);
  });

  it("leave untrimmed songs to their own end", async () => {
    const h = createHarness();
    await start(h);
    h.engine.next();
    await flush();
    await playTo(h, 0, 160_000);
    expect(h.reports).toHaveLength(1);
    expect(h.engine.getView().current?.track.id).toBe(B);
  });
});
