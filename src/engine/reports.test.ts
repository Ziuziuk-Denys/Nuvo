import { describe, expect, it, vi } from "vitest";
import { OPEN_PLAY_KEY, OUTBOX_KEY, PlayTracker, ReportOutbox, type PlaybackEventBody } from "./playReport";
import type { KeyValue } from "./persist";
import type { QueueEntry } from "./types";

function storage(): KeyValue & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (key) => data.get(key) ?? null, setItem: (key, value) => void data.set(key, value), removeItem: (key) => void data.delete(key) };
}

const entry = (id: string, origin: QueueEntry["origin"] = "list"): QueueEntry => ({
  entryId: `e-${id}`,
  origin,
  order: 0,
  track: { id, title: id, artists: "A", coverUrl: "", playCount: 0, durationMs: 200_000 } as QueueEntry["track"],
});

function played(id: string, ms: number): PlaybackEventBody {
  let now = 1000;
  const tracker = new PlayTracker(
    () => now,
    () => "session",
  );
  tracker.begin(entry(id), null);
  tracker.observe(true);
  for (let at = 0; at < ms; at += 1000) {
    now += 1000;
    tracker.observe(true);
  }
  return tracker.end("stop")!;
}

const left = (store: KeyValue, key: string): string[] => (JSON.parse(store.getItem(key) ?? "[]") as PlaybackEventBody[]).map((body) => body.trackId);

describe("ReportOutbox", () => {
  const build = (store: KeyValue, post: (body: PlaybackEventBody) => Promise<void>) => new ReportOutbox(store, post, () => 100_000, vi.fn());

  it("forgets a report the daemon took", async () => {
    const store = storage();
    const post = vi.fn(async () => undefined);
    await build(store, post).send(played("a", 5000));
    expect(post).toHaveBeenCalledTimes(1);
    expect(left(store, OUTBOX_KEY)).toEqual([]);
  });

  it("keeps a report the daemon refused and delivers it on the next start", async () => {
    const store = storage();
    await build(store, async () => {
      throw new Error("play report 503");
    }).send(played("a", 5000));
    expect(left(store, OUTBOX_KEY)).toEqual(["a"]);
    const post = vi.fn(async () => undefined);
    await build(store, post).flush();
    expect(post).toHaveBeenCalledTimes(1);
    expect(left(store, OUTBOX_KEY)).toEqual([]);
  });

  it("delivers the play the last run died in", async () => {
    const store = storage();
    build(store, async () => undefined).checkpoint(played("a", 9000));
    expect(left(store, OPEN_PLAY_KEY)).toEqual(["a"]);
    const post = vi.fn(async (_body: PlaybackEventBody) => undefined);
    await build(store, post).flush();
    expect(post.mock.calls[0][0]).toMatchObject({ trackId: "a", endReason: "stop", playedDurationMs: 9000 });
    expect(left(store, OPEN_PLAY_KEY)).toEqual([]);
  });

  it("a finished play replaces its checkpoint", async () => {
    const store = storage();
    const outbox = build(store, async () => undefined);
    outbox.checkpoint(played("a", 9000));
    await outbox.send(played("a", 12_000));
    expect(left(store, OPEN_PLAY_KEY)).toEqual([]);
  });

  it("writes the checkpoint every few seconds, not on every tick", () => {
    const store = storage();
    let now = 100_000;
    const outbox = new ReportOutbox(
      store,
      async () => undefined,
      () => now,
      vi.fn(),
    );
    outbox.checkpoint(played("a", 4000));
    now += 1000;
    outbox.checkpoint(played("a", 5000));
    expect((JSON.parse(store.getItem(OPEN_PLAY_KEY)!) as PlaybackEventBody[])[0].playedDurationMs).toBe(4000);
    now += 5000;
    outbox.checkpoint(played("a", 10_000));
    expect((JSON.parse(store.getItem(OPEN_PLAY_KEY)!) as PlaybackEventBody[])[0].playedDurationMs).toBe(10_000);
  });

  it("survives unreadable storage", async () => {
    const store = storage();
    store.setItem(OUTBOX_KEY, "{not json");
    const post = vi.fn(async () => undefined);
    await build(store, post).flush();
    expect(post).not.toHaveBeenCalled();
  });
});

describe("the context of a report", () => {
  const contextOf = (origin: QueueEntry["origin"], context: string | null) => {
    let now = 0;
    const tracker = new PlayTracker(
      () => (now += 1),
      () => "s",
    );
    tracker.begin(entry("a", origin), context);
    return tracker.end("change")!.context;
  };

  it("names autoplay after a list as a continuation", () => {
    expect(contextOf("continuation", "playlist:p1")).toEqual({ type: "continue", id: "p1" });
    expect(contextOf("continuation", null)).toEqual({ type: "continue", id: "queue" });
  });

  it("leaves a station and a chosen song as they are", () => {
    expect(contextOf("continuation", "radio:x")).toEqual({ type: "radio", id: "x" });
    expect(contextOf("list", "playlist:p1")).toEqual({ type: "playlist", id: "p1" });
  });
});
