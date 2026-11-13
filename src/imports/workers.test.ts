import { describe, expect, it, vi } from "vitest";
import { CoreError } from "./core";
import { FakeDaemon } from "./fixtures/fakeDaemon";
import type { CatalogTrack, ImportNext } from "./types";
import { ImportRunner, MAX_CANDIDATES, MAX_FAILURES, MAX_WORKERS, type SearchPorts, type StopReason } from "./workers";

const track = (id: string): CatalogTrack => ({
  id,
  title: "Paper Moons",
  artists: [{ id: "UC1", name: "Mira Holt" }],
  durationMs: 201_000,
});
const search = (rowId: number, step = 0, source: "youtube" | "soundcloud" = "youtube"): ImportNext => ({
  rowId,
  searches: [{ query: "Mira Holt Paper Moons", filter: source === "youtube" ? "songs" : "any", source, step }],
});
const round = (rowId: number): ImportNext => ({
  rowId,
  searches: [
    { query: "Mira Holt Paper Moons", filter: "songs", source: "youtube", step: 0 },
    { query: "Mira Holt Paper Moons", filter: "any", source: "soundcloud", step: 1 },
  ],
});
const hang = (_query: string, ...rest: unknown[]) => {
  const signal = rest.at(-1) as AbortSignal;
  return new Promise<CatalogTrack[]>((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
};

function runner(daemon: FakeDaemon, ports: Partial<SearchPorts> = {}, workers = 4) {
  const slept: number[] = [];
  const stopped: [string, StopReason][] = [];
  const searchPorts: SearchPorts = {
    youtube: vi.fn(async () => [track("aaaaaaaaaaa")]),
    soundcloud: vi.fn(async () => []),
    ...ports,
  };
  let finish!: () => void;
  const done = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const instance = new ImportRunner(daemon, searchPorts, {
    workers,
    sleep: async (ms) => {
      slept.push(ms);
    },
    onStopped: (id, reason) => {
      stopped.push([id, reason]);
      finish();
    },
  });
  return { runner: instance, done, slept, stopped, searchPorts };
}

describe("ImportRunner", () => {
  it("runs each search and posts the candidates with the same step", async () => {
    const daemon = new FakeDaemon();
    daemon.script.set("i1", [search(1, 0), search(1, 1)]);
    const { runner: r, done, stopped, searchPorts } = runner(daemon, {}, 1);
    r.add(["i1"]);
    await done;
    expect(searchPorts.youtube).toHaveBeenCalledWith("Mira Holt Paper Moons", "songs", expect.anything());
    expect(daemon.posted.map((p) => [p.rowId, p.step, p.candidates.length])).toEqual([
      [1, 0, 1],
      [1, 1, 1],
    ]);
    expect(stopped).toEqual([["i1", "done"]]);
  });

  it("asks YouTube and SoundCloud together and posts each answer", async () => {
    const daemon = new FakeDaemon();
    daemon.script.set("i1", [round(1)]);
    const soundcloud = vi.fn(async () => [track("sc:42")]);
    const { runner: r, done, stopped, searchPorts } = runner(daemon, { soundcloud }, 1);
    r.add(["i1"]);
    await done;
    expect(searchPorts.youtube).toHaveBeenCalledOnce();
    expect(soundcloud).toHaveBeenCalledOnce();
    expect(daemon.posted.map((p) => p.step).sort()).toEqual([0, 1]);
    expect(stopped).toEqual([["i1", "done"]]);
  });

  it("cancels the other source once an answer decides the row", async () => {
    const daemon = new FakeDaemon();
    daemon.script.set("i1", [round(1), search(2)]);
    daemon.decideAt.set(1, 0);
    const soundcloud = vi.fn(hang);
    const { runner: r, done, stopped } = runner(daemon, { soundcloud }, 1);
    r.add(["i1"]);
    await done;
    expect(soundcloud).toHaveBeenCalledOnce();
    expect(daemon.posted.map((p) => [p.rowId, p.step])).toEqual([
      [1, 0],
      [2, 0],
    ]);
    expect(stopped).toEqual([["i1", "done"]]);
  });

  it("keeps at most 25 candidates per search", async () => {
    const daemon = new FakeDaemon();
    daemon.script.set("i1", [search(1)]);
    const many = Array.from({ length: 40 }, (_, i) => track(`id${i}`));
    const { runner: r, done } = runner(daemon, { youtube: async () => many }, 1);
    r.add(["i1"]);
    await done;
    expect(daemon.posted[0].candidates).toHaveLength(MAX_CANDIDATES);
  });

  it("posts a failed search as failed with no candidates", async () => {
    const daemon = new FakeDaemon();
    daemon.script.set("i1", [search(1)]);
    const { runner: r, done } = runner(daemon, { youtube: async () => Promise.reject(new Error("bot check")) }, 1);
    r.add(["i1"]);
    await done;
    expect(daemon.posted[0]).toMatchObject({ candidates: [], failed: true });
  });

  it("asks a rate-limited search again after 2, 4 and 8 s, and posts it as failed only after that", async () => {
    const daemon = new FakeDaemon();
    daemon.script.set("i1", [search(1), search(2)]);
    let calls = 0;
    const youtube = async () => {
      calls += 1;
      if (calls === 1 || calls >= 3) throw new CoreError(429, "RATE_LIMITED");
      return [track("aaaaaaaaaaa")];
    };
    const { runner: r, done, slept } = runner(daemon, { youtube }, 1);
    r.add(["i1"]);
    await done;
    expect(daemon.posted.map((p) => [p.rowId, p.candidates.length, p.failed ?? false])).toEqual([
      [1, 1, false],
      [2, 0, true],
    ]);
    expect(slept).toEqual([2_000, 2_000, 4_000, 8_000]);
  });

  it("runs a SoundCloud step through the SoundCloud search", async () => {
    const daemon = new FakeDaemon();
    daemon.script.set("i1", [search(1, 4, "soundcloud")]);
    const soundcloud = vi.fn(async () => [track("sc:42")]);
    const { runner: r, done, searchPorts } = runner(daemon, { soundcloud }, 1);
    r.add(["i1"]);
    await done;
    expect(soundcloud).toHaveBeenCalledWith("Mira Holt Paper Moons", expect.anything());
    expect(searchPorts.youtube).not.toHaveBeenCalled();
    expect(daemon.posted[0]).toMatchObject({
      rowId: 1,
      step: 4,
      candidates: [track("sc:42")],
    });
  });

  it("sleeps for a wait answer, capped at a minute", async () => {
    const daemon = new FakeDaemon();
    daemon.script.set("i1", [{ wait: 250 }, { wait: 600_000 }]);
    const { runner: r, done, slept } = runner(daemon, {}, 1);
    r.add(["i1"]);
    await done;
    expect(slept).toEqual([250, 60_000]);
  });

  it("stops on 404 (the target playlist was deleted) and on a locked daemon", async () => {
    const gone = new FakeDaemon();
    gone.script.set("i1", [new CoreError(404, "NOT_FOUND")]);
    const first = runner(gone, {}, 1);
    first.runner.add(["i1"]);
    await first.done;
    expect(first.stopped).toEqual([["i1", "gone"]]);

    const locked = new FakeDaemon();
    locked.script.set("i1", [new CoreError(423, "LOCKED")]);
    const second = runner(locked, {}, 1);
    second.runner.add(["i1"]);
    await second.done;
    expect(second.stopped).toEqual([["i1", "locked"]]);
  });

  it("skips a stale step (409) and goes on", async () => {
    const daemon = new FakeDaemon();
    daemon.script.set("i1", [search(1), search(2)]);
    daemon.postError = new CoreError(409, "CONFLICT");
    const { runner: r, done, stopped } = runner(daemon, {}, 1);
    r.add(["i1"]);
    await done;
    expect(daemon.posted.map((p) => p.rowId)).toEqual([1, 2]);
    expect(stopped).toEqual([["i1", "done"]]);
  });

  it("retries an unreachable daemon, then gives up", async () => {
    const daemon = new FakeDaemon();
    daemon.script.set(
      "i1",
      Array.from({ length: MAX_FAILURES }, () => new CoreError(0, "CORE_DOWN")),
    );
    const { runner: r, done, stopped, slept } = runner(daemon, {}, 1);
    r.add(["i1"]);
    await done;
    expect(slept).toEqual(Array(MAX_FAILURES - 1).fill(2_000));
    expect(stopped).toEqual([["i1", "error"]]);
  });

  it("runs an import added again right after it was stopped", async () => {
    const daemon = new FakeDaemon();
    daemon.script.set("i1", [search(1)]);
    let release: (() => void) | undefined;
    let calls = 0;
    const youtube = (_q: string, _f: string, signal: AbortSignal) => {
      calls += 1;
      if (calls > 1) return Promise.resolve([track("aaaaaaaaaaa")]);
      return new Promise<CatalogTrack[]>((_resolve, reject) => {
        release = () => reject(signal.reason);
        signal.addEventListener("abort", release, { once: true });
      });
    };
    const onStopped = vi.fn();
    const r = new ImportRunner(daemon, { youtube, soundcloud: async () => [] }, { workers: 1, onStopped });
    r.add(["i1"]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    daemon.script.set("i1", [search(2)]);
    r.stop("i1");
    r.add(["i1"]);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(daemon.posted.map((p) => p.rowId)).toEqual([2]);
    expect(onStopped).toHaveBeenCalledWith("i1", "done");
  });

  it("gives up on a lease that keeps conflicting, with a delay in between", async () => {
    const daemon = new FakeDaemon();
    daemon.script.set(
      "i1",
      Array.from({ length: 50 }, (_, i) => search(i + 1)),
    );
    daemon.postError = new CoreError(409, "CONFLICT");
    const { runner: r, done, stopped, slept } = runner(daemon, {}, 1);
    r.add(["i1"]);
    await done;
    expect(stopped).toEqual([["i1", "error"]]);
    expect(daemon.posted.length).toBeLessThan(50);
    expect(slept.length).toBeGreaterThan(0);
  });

  it("does not count a throwing onRow as a daemon failure, and a throwing onStopped does not stall the queue", async () => {
    const daemon = new FakeDaemon();
    daemon.script.set("i1", [search(1), search(2)]);
    daemon.script.set("i2", [search(3)]);
    const slept: number[] = [];
    const r = new ImportRunner(
      daemon,
      {
        youtube: async () => [track("aaaaaaaaaaa")],
        soundcloud: async () => [],
      },
      {
        workers: 1,
        sleep: async (ms) => void slept.push(ms),
        onRow: () => {
          throw new Error("screen broke");
        },
        onStopped: () => {
          throw new Error("screen broke");
        },
      },
    );
    r.add(["i1", "i2"]);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(daemon.posted.map((p) => p.rowId)).toEqual([1, 2, 3]);
    expect(slept).toEqual([]);
    expect(r.running).toBeNull();
  });

  it("forgets earlier failures after the daemon answers well again", async () => {
    const down = () => Array.from({ length: MAX_FAILURES - 1 }, () => new CoreError(0, "CORE_DOWN"));
    const daemon = new FakeDaemon();
    daemon.script.set("i1", [...down(), { wait: 100 }, ...down(), { wait: 100 }]);
    const { runner: r, done, stopped } = runner(daemon, {}, 1);
    r.add(["i1"]);
    await done;
    expect(stopped).toEqual([["i1", "done"]]);
  });

  it("waits out a daemon that is still starting for about a minute", async () => {
    const daemon = new FakeDaemon();
    daemon.script.set("i1", [...Array.from({ length: 6 }, () => new CoreError(503, "CORE_STARTING")), search(1)]);
    const { runner: r, done, stopped, slept } = runner(daemon, {}, 1);
    r.add(["i1"]);
    await done;
    expect(stopped).toEqual([["i1", "done"]]);
    expect(slept.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(65_000);
    expect(slept.reduce((a, b) => a + b, 0)).toBeGreaterThan(10_000);
  });

  it("gives up on a daemon that stays in its start for over a minute", async () => {
    const daemon = new FakeDaemon();
    daemon.script.set(
      "i1",
      Array.from({ length: 100 }, () => new CoreError(503, "CORE_STARTING")),
    );
    const { runner: r, done, stopped, slept } = runner(daemon, {}, 1);
    r.add(["i1"]);
    await done;
    expect(stopped).toEqual([["i1", "error"]]);
    expect(slept.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(70_000);
  });

  it("runs up to eight searches at once and one import at a time", async () => {
    const daemon = new FakeDaemon();
    daemon.script.set(
      "i1",
      Array.from({ length: 10 }, (_, i) => search(i + 1)),
    );
    daemon.script.set("i2", [search(100)]);
    let inFlight = 0;
    let most = 0;
    const order: string[] = [];
    const youtube = async () => {
      inFlight += 1;
      most = Math.max(most, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight -= 1;
      return [track("aaaaaaaaaaa")];
    };
    const r = new ImportRunner(daemon, { youtube, soundcloud: async () => [] }, { onStopped: (id) => order.push(id) });
    const finished = new Promise<void>((resolve) => {
      const check = setInterval(() => {
        if (order.length === 2) {
          clearInterval(check);
          resolve();
        }
      }, 1);
    });
    r.add(["i1", "i2", "i1"]);
    await finished;
    expect(most).toBe(MAX_WORKERS);
    expect(order).toEqual(["i1", "i2"]);
    expect(daemon.posted.at(-1)?.id).toBe("i2");
  });

  it("stops an import on request without reporting it", async () => {
    const daemon = new FakeDaemon();
    daemon.script.set("i1", [search(1), search(2)]);
    let release!: () => void;
    const youtube = (_q: string, _f: string, signal: AbortSignal) =>
      new Promise<CatalogTrack[]>((_resolve, reject) => {
        release = () => reject(signal.reason);
        signal.addEventListener("abort", release, { once: true });
      });
    const onStopped = vi.fn();
    const r = new ImportRunner(daemon, { youtube, soundcloud: async () => [] }, { workers: 1, onStopped });
    r.add(["i1"]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(r.running).toBe("i1");
    r.stop("i1");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(r.running).toBeNull();
    expect(daemon.posted).toEqual([]);
    expect(onStopped).not.toHaveBeenCalled();
  });

  it("gives up on answers that are not objects instead of throwing", async () => {
    const daemon = new FakeDaemon();
    daemon.next = async () => null as unknown as ImportNext;
    const { runner: r, done, stopped } = runner(daemon, {}, 1);
    r.add(["i1"]);
    await done;
    expect(stopped).toEqual([["i1", "error"]]);
  });
});
