import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { advance, createHarness, flush, track, y } from "./test/harness";

const list = (...letters: string[]) => letters.map((l) => track(y(l)));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-01T12:00:00Z"));
});
afterEach(() => vi.useRealTimers());

describe("recommendations in the engine", () => {
  it("a refill carries the listening session id and waits for the last play report", async () => {
    let release!: () => void;
    const h = createHarness({ slowReport: new Promise<void>((resolve) => (release = resolve)) });
    h.continuation.answers = [list("b"), list("c", "d")];
    h.engine.startRadio(track(y("a")));
    await advance(500);
    expect(h.continuation.requests).toHaveLength(1);
    const session = h.continuation.requests[0].sessionId;
    expect(session).toEqual(expect.any(String));

    h.engine.next();
    await advance(500);
    expect(h.reports).toHaveLength(1);
    expect(h.continuation.requests).toHaveLength(1);
    release();
    await flush();
    expect(h.continuation.requests).toHaveLength(2);
    expect(h.reports[0].listeningSessionId).toBe(session);
    expect(h.continuation.requests[1].sessionId).toBe(session);
  });

  it("keeps the daemon's reason on the queue entry, never on the track", async () => {
    const h = createHarness();
    h.continuation.answers = [[{ ...track(y("b")), reason: { kind: "session", name: "Song A" } }, track(y("c"))]];
    h.engine.startRadio(track(y("a")));
    await advance(500);
    const entries = h.engine.getView().entries;
    expect(entries.map((e) => e.track.id)).toEqual([y("a"), y("b"), y("c")]);
    expect(entries[1].reason).toEqual({ kind: "session", name: "Song A" });
    expect(entries[1].track).not.toHaveProperty("reason");
    expect(entries[2].reason).toBeUndefined();
  });

  it("a hung report holds the next refill for at most a few seconds", async () => {
    const h = createHarness({ slowReport: new Promise<void>(() => {}) });
    h.continuation.answers = [list("b"), list("c", "d")];
    h.engine.startRadio(track(y("a")));
    await advance(500);
    h.engine.next();
    await advance(500);
    expect(h.continuation.requests).toHaveLength(1);
    await advance(3000);
    expect(h.continuation.requests).toHaveLength(2);
  });

  it("a play that ends while the refill waits is waited for too", async () => {
    const releases: Array<() => void> = [];
    const h = createHarness();
    h.deps.postReport = () => new Promise<void>((resolve) => releases.push(resolve));
    h.continuation.answers = [list("e"), list("f")];
    h.engine.playList(list("a", "b", "c"), { context: "radio:a" });
    await advance(2000);
    const before = h.continuation.requests.length;
    h.engine.next();
    await advance(500);
    h.engine.next();
    await advance(500);
    expect(releases).toHaveLength(2);
    releases[0]();
    await advance(500);
    expect(h.continuation.requests).toHaveLength(before);
    releases[1]();
    await advance(500);
    expect(h.continuation.requests.length).toBeGreaterThan(before);
  });
});
