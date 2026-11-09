import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { LEGACY_KEY, MIGRATED_KEY, POSITION_KEY, PREFS_KEY, SESSION_KEY } from "./persist";
import { MediaSessionMirror, bindMediaSession, type MediaSessionLike } from "./mediaSession";
import { advance, createHarness, flush, MemoryStorage, track, urlSource, y, type Harness } from "./test/harness";

const list = (...letters: string[]) => letters.map((l) => track(y(l)));
const ids = (h: Harness) => h.engine.getView().entries.map((e) => e.track.id);
const currentId = (h: Harness) => h.engine.getView().current?.track.id;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-27T12:00:00Z"));
});
afterEach(() => vi.useRealTimers());

async function playing(h: Harness, tracks = list("a", "b", "c", "d", "e"), startAt = 0) {
  h.engine.playList(tracks, { startAt });
  await flush();
  expect(h.engine.getView().status).toBe("playing");
}

describe("transport", () => {
  it("starts synchronously in loading with the snapshot duration", () => {
    const h = createHarness();
    h.engine.playList([track(y("a")), track(y("b"), { durationMs: 123_000 }), track(y("c"))], { startAt: 1 });
    const view = h.engine.getView();
    expect(view.current?.track.id).toBe(y("b"));
    expect(view.index).toBe(1);
    expect(view.positionMs).toBe(0);
    expect(view.durationMs).toBe(123_000);
    expect(view.status).toBe("loading");
  });

  it("three nexts in one tick attach and play only the last", async () => {
    const h = createHarness();
    await playing(h);
    const seen: number[] = [];
    h.engine.subscribe((view) => seen.push(view.index));
    h.engine.next();
    h.engine.next();
    h.engine.next();
    expect(seen.slice(0, 3)).toEqual([1, 2, 3]);
    await flush();
    expect(h.deck.loads.map((l) => l.trackId)).toEqual([y("a"), y("d")]);
    expect(h.engine.getView().index).toBe(3);
    expect(h.engine.getView().status).toBe("playing");
  });

  it("repeat-one: next moves on, a natural end replays and counts one loop", async () => {
    const h = createHarness();
    await playing(h);
    h.engine.setRepeat("one");
    h.engine.next();
    await flush();
    expect(currentId(h)).toBe(y("b"));
    h.deck.duration = 200_000;
    h.deck.emit("ended", { positionMs: 200_000 });
    await flush();
    expect(currentId(h)).toBe(y("b"));
    h.engine.next();
    await flush();
    const report = h.reports.find((r) => r.trackId === y("b"))!;
    expect(report.loopCount).toBe(1);
  });

  it("repeat-all on the last entry wraps to the first", async () => {
    const h = createHarness();
    await playing(h, list("a", "b", "c"), 2);
    h.engine.setRepeat("all");
    h.engine.next();
    await flush();
    expect(h.engine.getView().index).toBe(0);
  });

  it("the real end keeps the last entry at 0 and play starts it again", async () => {
    const h = createHarness();
    await playing(h, list("a", "b"), 1);
    h.deck.duration = 200_000;
    h.deck.emit("ended", { positionMs: 200_000 });
    await advance(500);
    const view = h.engine.getView();
    expect(view.status).toBe("idle");
    expect(view.current?.track.id).toBe(y("b"));
    expect(view.positionMs).toBe(0);
    h.engine.play();
    await flush();
    expect(h.engine.getView().status).toBe("playing");
    expect(h.deck.loads.at(-1)?.trackId).toBe(y("b"));
  });

  it("previous past 3 s restarts the entry", async () => {
    const h = createHarness();
    await playing(h);
    h.deck.emit("timeupdate", { positionMs: 3500 });
    h.engine.previous();
    expect(h.deck.seeks.at(-1)).toBe(0);
    expect(h.engine.getView().index).toBe(0);
    expect(h.engine.getView().status).toBe("playing");
  });

  it("previous within 3 s goes to the entry before", async () => {
    const h = createHarness();
    await playing(h);
    h.engine.next();
    h.engine.next();
    await flush();
    h.deck.emit("timeupdate", { positionMs: 2000 });
    h.engine.previous();
    await flush();
    expect(h.engine.getView().index).toBe(1);
    expect(h.engine.getView().positionMs).toBe(0);
  });

  it("previous on the first entry: repeat-all wraps back, a station restarts", async () => {
    const h = createHarness();
    await playing(h, list("a", "b", "c"));
    h.engine.setRepeat("all");
    h.engine.previous();
    await flush();
    expect(h.engine.getView().index).toBe(2);

    const s = createHarness();
    s.continuation.answers = [list("b", "c")];
    s.engine.startRadio(track(y("a")));
    await flush();
    s.engine.setRepeat("all");
    s.engine.previous();
    expect(s.engine.getView().index).toBe(0);
    expect(s.deck.seeks.at(-1)).toBe(0);
  });

  it("shuffle on moves only the entries after the current one", async () => {
    let differs = 0;
    for (let seed = 1; seed <= 100; seed++) {
      const h = createHarness({ seed });
      const tracks = Array.from({ length: 10 }, (_, i) => track(`id-${i}`, { artists: `A${i % 4}` }));
      h.engine.playList(tracks, { startAt: 2 });
      h.engine.setShuffle(true);
      const after = ids(h);
      expect(after.slice(0, 3)).toEqual(["id-0", "id-1", "id-2"]);
      expect([...after.slice(3)].sort()).toEqual(
        tracks
          .slice(3)
          .map((t) => t.id)
          .sort(),
      );
      if (
        after.slice(3).join() !==
        tracks
          .slice(3)
          .map((t) => t.id)
          .join()
      )
        differs++;
    }
    expect(differs).toBeGreaterThan(90);
  });

  it("shuffle off restores list order with Play next and Add to queue in place", async () => {
    const h = createHarness();
    await playing(h, list("a", "b", "c", "d"));
    h.engine.setShuffle(true);
    h.engine.append(track(y("q")));
    h.engine.insertNext(track(y("n")));
    h.engine.setShuffle(false);
    expect(ids(h)).toEqual([y("a"), y("n"), y("b"), y("c"), y("d"), y("q")]);
  });

  it("shuffled start plays the chosen entry first; shuffle off restores the rest", () => {
    const h = createHarness();
    const tracks = Array.from({ length: 8 }, (_, i) => track(`id-${i}`, { artists: `A${i}` }));
    h.engine.playList(tracks, { shuffled: true, startAt: 5 });
    expect(currentId(h)).toBe("id-5");
    expect(h.engine.getView().shuffle).toBe(true);
    expect([...ids(h).slice(1)].sort()).toEqual(
      tracks
        .filter((_, i) => i !== 5)
        .map((t) => t.id)
        .sort(),
    );
    h.engine.setShuffle(false);
    expect(ids(h).slice(1)).toEqual(["id-0", "id-1", "id-2", "id-3", "id-4", "id-6", "id-7"]);
  });

  it("hand-picking with shuffle on keeps the order", async () => {
    const h = createHarness();
    h.engine.setShuffle(true);
    await playing(h, list("a", "b", "c", "d", "e", "f"));
    const before = ids(h);
    h.engine.playEntry(h.engine.getView().entries[4].entryId);
    expect(ids(h)).toEqual(before);
    expect(h.engine.getView().index).toBe(4);
  });

  it("a new list with shuffle on keeps the head and shuffles the tail", () => {
    const h = createHarness();
    h.engine.setShuffle(true);
    const tracks = Array.from({ length: 10 }, (_, i) => track(`id-${i}`, { artists: `A${i}` }));
    h.engine.playList(tracks, { startAt: 4 });
    expect(ids(h).slice(0, 5)).toEqual(["id-0", "id-1", "id-2", "id-3", "id-4"]);
    expect(h.engine.getView().index).toBe(4);
    expect([...ids(h).slice(5)].sort()).toEqual(["id-5", "id-6", "id-7", "id-8", "id-9"]);
    expect(ids(h).slice(5).join()).not.toBe("id-5,id-6,id-7,id-8,id-9");
  });

  it("a track queued twice keeps both places on unshuffle", async () => {
    const h = createHarness();
    const x = track(y("x"));
    await playing(h, [track(y("a")), x, track(y("b")), x, track(y("c"))]);
    const entryIds = h.engine.getView().entries.map((e) => e.entryId);
    h.engine.setShuffle(true);
    h.engine.setShuffle(false);
    expect(h.engine.getView().entries.map((e) => e.entryId)).toEqual(entryIds);
  });

  it("moving the current entry keeps it playing", async () => {
    const h = createHarness();
    await playing(h, list("a", "b", "c", "d", "e"), 2);
    h.engine.move(h.engine.getView().entries[2].entryId, 4);
    expect(h.engine.getView().index).toBe(4);
    expect(currentId(h)).toBe(y("c"));
    expect(h.deck.loads).toHaveLength(1);
  });

  it("the index follows the current entry when others move", async () => {
    const h = createHarness();
    await playing(h, list("a", "b", "c", "d", "e"), 2);
    h.engine.move(h.engine.getView().entries[0].entryId, 3);
    expect(h.engine.getView().index).toBe(1);

    const g = createHarness();
    await playing(g, list("a", "b", "c", "d", "e"), 2);
    g.engine.move(g.engine.getView().entries[4].entryId, 1);
    expect(g.engine.getView().index).toBe(3);
  });

  it("invalid moves change nothing", async () => {
    const h = createHarness();
    await playing(h, list("a", "b", "c"));
    const before = ids(h);
    const id = h.engine.getView().entries[1].entryId;
    h.engine.move(id, -1);
    h.engine.move(id, 3);
    h.engine.move(id, 1);
    expect(ids(h)).toEqual(before);
  });

  it("an appended track stays last after unshuffle", async () => {
    const h = createHarness();
    h.engine.setShuffle(true);
    await playing(h, list("a", "b", "c", "d"));
    h.engine.append(track(y("z")));
    expect(ids(h).at(-1)).toBe(y("z"));
    h.engine.setShuffle(false);
    expect(ids(h).at(-1)).toBe(y("z"));
  });

  it("insert next goes after the current entry; on an empty queue it plays", async () => {
    const h = createHarness();
    await playing(h, list("a", "b", "c"));
    h.engine.insertNext(track(y("t")));
    expect(ids(h)[1]).toBe(y("t"));

    const e = createHarness();
    e.engine.insertNext(track(y("t")));
    await flush();
    expect(currentId(e)).toBe(y("t"));
    expect(e.engine.getView().status).toBe("playing");
  });

  it("removing one copy keeps the other; restore puts it back", async () => {
    const h = createHarness();
    const x = track(y("x"));
    await playing(h, [track(y("a")), x, track(y("b")), x]);
    const before = h.engine.getView().entries.map((e) => e.entryId);
    const removed = h.engine.remove(before[3])!;
    expect(ids(h)).toEqual([y("a"), y("x"), y("b")]);
    h.engine.restore(removed, 3);
    expect(h.engine.getView().entries.map((e) => e.entryId)).toEqual(before);
  });

  it("removing the current entry is refused", async () => {
    const h = createHarness();
    await playing(h, list("a", "b"));
    expect(h.engine.remove(h.engine.getView().entries[0].entryId)).toBeNull();
    expect(ids(h)).toEqual([y("a"), y("b")]);
  });

  it("trim keeps the current entry and clears the context", async () => {
    const h = createHarness();
    h.engine.playList(list("a", "b", "c", "d", "e"), { startAt: 2, context: "playlist:p1", listCover: "https://i.ytimg.com/x.jpg" });
    await flush();
    h.engine.trimToCurrent();
    const view = h.engine.getView();
    expect(view.entries.map((e) => e.track.id)).toEqual([y("c")]);
    expect(view.index).toBe(0);
    expect(view.context).toBeNull();
    expect(view.listCover).toBeNull();

    const e = createHarness();
    e.engine.trimToCurrent();
    expect(e.engine.getView().entries).toEqual([]);
  });

  it("a station turns repeat-all off and appends its batch without duplicates", async () => {
    const h = createHarness();
    h.engine.setRepeat("all");
    let release!: () => void;
    h.continuation.hold = true;
    h.engine.startRadio(track(y("a")));
    expect(h.engine.getView().repeat).toBe("off");
    expect(ids(h)).toEqual([y("a")]);
    await flush();
    release = () => h.continuation.pendingResolve!(list("a", "b", "c", "b"));
    release();
    await flush();
    expect(ids(h)).toEqual([y("a"), y("b"), y("c")]);
  });

  it("moving inside a station asks once after 400 ms", async () => {
    const h = createHarness();
    h.continuation.answers = [list("b", "c"), list("c", "d", "e")];
    h.engine.startRadio(track(y("a")));
    await flush();
    h.engine.next();
    await advance(399, 399);
    expect(h.continuation.requests).toHaveLength(1);
    await advance(1, 1);
    expect(h.continuation.requests).toHaveLength(2);
    expect(h.continuation.requests[1].context).toBe(`radio:${y("a")}`);
    expect(ids(h)).toEqual([y("a"), y("b"), y("c"), y("d"), y("e")]);
  });

  it("a station never wraps, even with repeat-all forced", async () => {
    const h = createHarness();
    h.continuation.answers = [[]];
    h.engine.startRadio(track(y("a")));
    await advance(500);
    (h.engine as unknown as { prefs: { repeat: string } }).prefs.repeat = "all";
    h.continuation.answers = [list("x")];
    h.deck.duration = 200_000;
    h.deck.emit("ended", { positionMs: 200_000 });
    await flush();
    expect(h.engine.getView().index).toBe(1);
    expect(currentId(h)).toBe(y("x"));
  });

  it("repeat-all on a plain list asks for nothing", async () => {
    const h = createHarness();
    await playing(h, list("a", "b"));
    h.engine.setRepeat("all");
    h.engine.next();
    h.engine.next();
    await advance(1000);
    expect(currentId(h)).toBe(y("a"));
    expect(h.continuation.requests).toHaveLength(0);
  });

  it("the last entry of a playlist asks to continue; a newer list drops the late batch", async () => {
    const h = createHarness();
    h.continuation.hold = true;
    h.engine.playList(list("a", "b"), { startAt: 1, context: "playlist:p1" });
    await advance(450);
    expect(h.continuation.requests.at(-1)?.context).toBe("continue:p1");
    h.engine.playList(list("m", "n", "o"), { context: "album:q" });
    h.continuation.pendingResolve!(list("z"));
    await flush();
    expect(ids(h)).toEqual([y("m"), y("n"), y("o")]);
  });

  it("a station batch survives skips inside the station", async () => {
    const h = createHarness();
    h.continuation.answers = [list("b", "c")];
    h.engine.startRadio(track(y("a")));
    await flush();
    h.continuation.hold = true;
    h.engine.next();
    await advance(400, 400);
    h.engine.next();
    h.continuation.pendingResolve!(list("d"));
    await flush();
    expect(ids(h)).toContain(y("d"));
  });

  it("the end waits for the running refill instead of asking twice", async () => {
    const h = createHarness();
    h.continuation.hold = true;
    await playing(h, list("a"), 0);
    await advance(400, 400);
    expect(h.continuation.requests).toHaveLength(1);
    h.deck.duration = 200_000;
    h.deck.emit("ended", { positionMs: 200_000 });
    expect(h.engine.getView().status).toBe("loading");
    h.continuation.pendingResolve!(list("b"));
    await flush();
    expect(h.continuation.requests).toHaveLength(1);
    expect(currentId(h)).toBe(y("b"));
  });

  it("a failed refill leaves playback alone and retries at the next trigger", async () => {
    const h = createHarness();
    h.continuation.answers = [new Error("down"), list("c")];
    await playing(h, list("a", "b"), 1);
    await advance(450);
    expect(h.engine.getView().status).toBe("playing");
    h.engine.insertNext(track(y("n")));
    h.engine.next();
    await advance(450);
    expect(h.continuation.requests).toHaveLength(2);
  });

  it("repeat cycles off, all, one; a station skips all", () => {
    const h = createHarness();
    const seen: string[] = [];
    for (let i = 0; i < 3; i++) {
      h.engine.cycleRepeat();
      seen.push(h.engine.getView().repeat);
    }
    expect(seen).toEqual(["all", "one", "off"]);
    const s = createHarness();
    s.engine.startRadio(track(y("a")));
    const station: string[] = [];
    for (let i = 0; i < 3; i++) {
      s.engine.cycleRepeat();
      station.push(s.engine.getView().repeat);
    }
    expect(station).toEqual(["one", "off", "one"]);
  });

  it("pause during loading cancels the load and keeps the position", async () => {
    const h = createHarness();
    const pending = h.youtube.pending(y("a"));
    h.engine.playList(list("a"));
    h.engine.pause();
    expect(h.engine.getView().status).toBe("paused");
    pending.resolve(urlSource("https://rr1.googlevideo.com/a"));
    await flush();
    expect(h.deck.loads).toHaveLength(0);
    h.youtube.script.delete(y("a"));
    h.engine.play();
    await flush();
    expect(h.deck.loads[0].positionMs).toBe(0);
    expect(h.engine.getView().status).toBe("playing");
  });

  it("a restored session loads at its position on play", async () => {
    const storage = new MemoryStorage();
    storage.setItem(
      SESSION_KEY,
      JSON.stringify({
        entries: [{ entryId: "s1", track: track(y("a")), origin: "list", order: 0 }],
        index: 0,
        positionMs: 61_000,
        durationMs: 200_000,
        context: null,
        listCover: null,
      }),
    );
    const h = createHarness({ storage });
    expect(h.engine.getView().status).toBe("paused");
    h.engine.play();
    await flush();
    expect(h.deck.loads[0].positionMs).toBe(61_000);
    expect(h.engine.getView().status).toBe("playing");
  });

  it("a source about to expire is resolved again on resume", async () => {
    const h = createHarness();
    h.youtube.script.set(y("a"), async () => urlSource("https://rr1.googlevideo.com/a", { expiresAt: Date.now() + 14_000 }));
    await playing(h, list("a"));
    h.deck.emit("timeupdate", { positionMs: 5000 });
    h.engine.pause();
    h.engine.play();
    await flush();
    expect(h.youtube.resolves).toHaveLength(2);
    expect(h.deck.loads[1].positionMs).toBe(5000);
  });

  it("a SoundCloud URL whose ISO expiry is near is resolved again on resume", async () => {
    const h = createHarness();
    h.daemon.on("GET /v1/sc/tracks/1/stream", () =>
      Response.json({
        kind: "direct",
        url: "https://cf-media.sndcdn.com/1",
        expiresAt: new Date(Date.now() + 14_000).toISOString(),
        codec: "mp3",
        mimeType: "audio/mpeg",
        bitrate: 128_000,
        contentLength: null,
      }),
    );
    await playing(h, [track("sc:1")]);
    h.deck.emit("timeupdate", { positionMs: 5000 });
    h.engine.pause();
    h.engine.play();
    await flush();
    expect(h.daemon.callsTo("GET", "/v1/sc/tracks/1/stream")).toHaveLength(2);
    expect(h.deck.loads[1].positionMs).toBe(5000);
  });

  it("seeking a restored session moves only the position", async () => {
    const storage = new MemoryStorage();
    storage.setItem(
      SESSION_KEY,
      JSON.stringify({
        entries: [{ entryId: "s1", track: track(y("a")), origin: "list", order: 0 }],
        index: 0,
        positionMs: 1000,
        durationMs: 200_000,
        context: null,
        listCover: null,
      }),
    );
    const h = createHarness({ storage });
    h.engine.seekTo(30_000);
    expect(h.engine.getView().positionMs).toBe(30_000);
    expect(h.youtube.resolves).toHaveLength(0);
    h.engine.play();
    await flush();
    expect(h.deck.loads[0].positionMs).toBe(30_000);
  });

  it("a seek while loading is applied once, without a second load", async () => {
    const h = createHarness();
    const pending = h.youtube.pending(y("a"));
    h.engine.playList(list("a"));
    h.engine.seekTo(45_000);
    pending.resolve(urlSource("https://rr1.googlevideo.com/a"));
    await flush();
    expect(h.deck.loads).toHaveLength(1);
    expect(h.deck.loads[0].positionMs).toBe(45_000);
  });

  it("seeks clamp to 0 and the duration", async () => {
    const h = createHarness();
    await playing(h, list("a"));
    h.engine.seekTo(-5);
    expect(h.engine.getView().positionMs).toBe(0);
    h.engine.seekTo(500_000);
    expect(h.engine.getView().positionMs).toBe(200_000);
  });

  it("a late play() promise never revives a paused player", async () => {
    const h = createHarness();
    await playing(h, list("a"));
    h.engine.pause();
    h.engine.play();
    h.engine.pause();
    await flush();
    expect(h.engine.getView().status).toBe("paused");
    h.deck.rejectNext = "NotSupportedError";
    h.engine.play();
    h.engine.pause();
    await flush();
    expect(h.engine.getView().status).toBe("paused");
  });

  it("waiting then seeked with data never shows loading", async () => {
    const h = createHarness();
    await playing(h, list("a"));
    h.deck.emit("waiting");
    await advance(50, 50);
    h.deck.emit("seeked", { enoughData: true });
    await advance(500);
    expect(h.engine.getView().status).toBe("playing");
  });

  it("300 ms of waiting shows loading until playing returns", async () => {
    const h = createHarness();
    await playing(h, list("a"));
    h.deck.emit("waiting");
    await advance(300, 300);
    expect(h.engine.getView().status).toBe("loading");
    h.deck.emit("playing");
    expect(h.engine.getView().status).toBe("playing");
  });

  it("ended counts only within 1.5 s of the duration", async () => {
    const h = createHarness();
    await playing(h, [track(y("a"), { durationMs: 180_000 }), track(y("b"))]);
    h.deck.emit("ended", { positionMs: 60_000 });
    expect(currentId(h)).toBe(y("a"));
    h.deck.emit("ended", { positionMs: 179_000 });
    expect(currentId(h)).toBe(y("b"));
  });

  it("a track that cannot play anywhere is skipped with one notice", async () => {
    const h = createHarness();
    h.youtube.fail(y("a"), "unplayable");
    h.engine.playList(list("a", "b", "c"));
    await advance(100);
    expect(h.engine.getView().notice).toMatchObject({ kind: "skipped", title: `Title ${y("a")}` });
    expect(h.notices).toHaveLength(1);
    expect(h.reports.find((r) => r.trackId === y("a"))?.endReason).toBe("error");
    expect(currentId(h)).toBe(y("b"));
    expect(h.engine.getView().status).toBe("playing");
  });

  it("repeat-one never reselects a broken track", async () => {
    const h = createHarness();
    h.engine.setRepeat("one");
    h.youtube.fail(y("a"), "unplayable");
    h.engine.playList(list("a", "b"));
    await advance(100);
    expect(currentId(h)).toBe(y("b"));
  });

  it("a late failure of an old entry changes nothing", async () => {
    const h = createHarness();
    const pending = h.youtube.pending(y("a"));
    h.engine.playList(list("a", "b"));
    h.engine.next();
    await flush();
    pending.reject({ code: "unplayable" });
    await flush();
    expect(currentId(h)).toBe(y("b"));
    expect(h.engine.getView().notice).toBeNull();
  });

  it("three network failures stop on the next entry with a network check", async () => {
    const h = createHarness();
    for (const l of ["a", "b", "c"]) h.youtube.fail(y(l), "worker-timeout");
    h.engine.playList(list("a", "b", "c", "d", "e"));
    await advance(1000);
    const view = h.engine.getView();
    expect(currentId(h)).toBe(y("d"));
    expect(view.status).toBe("paused");
    expect(view.pauseReason).toBe("network");
    expect(view.notice).toMatchObject({ kind: "network", cause: "timeout" });
    expect(h.checks).toEqual(["timeout"]);
    expect(h.youtube.resolves.filter((id) => id === y("d") || id === y("e"))).toHaveLength(0);
  });

  it("a queue where everything fails ends idle with a notice", async () => {
    const h = createHarness();
    for (const l of ["a", "b", "c", "d"]) h.youtube.fail(y(l), "unplayable");
    h.engine.playList(list("a", "b", "c", "d"));
    await advance(2000);
    expect(h.engine.getView().status).toBe("idle");
    expect(h.engine.getView().notice).toMatchObject({ kind: "queue_failed" });
    expect(h.deck.loads).toHaveLength(0);
  });

  it("a blocked autoplay pauses with its reason; play then works", async () => {
    const h = createHarness();
    h.deck.rejectNext = "NotAllowedError";
    h.engine.playList(list("a"));
    await flush();
    expect(h.engine.getView()).toMatchObject({ status: "paused", pauseReason: "autoplay_blocked" });
    h.engine.play();
    await flush();
    expect(h.engine.getView().status).toBe("playing");
  });

  it("the old session key migrates once and stays for a downgrade", () => {
    const storage = new MemoryStorage();
    const old = {
      state: {
        queue: [track(y("a")), track(y("b")), track(y("c"))],
        currentIndex: 1,
        positionMs: 42_000,
        playbackRate: "abc",
        defaultPlaybackContext: "resume",
        audioQuality: "lossless",
      },
      version: 0,
    };
    storage.setItem(LEGACY_KEY, JSON.stringify(old));
    const h = createHarness({ storage });
    const view = h.engine.getView();
    expect(view.status).toBe("paused");
    expect(view.current?.track.id).toBe(y("b"));
    expect(view.positionMs).toBe(42_000);
    expect(view.tempo.rate).toBe(1);
    const prefs = JSON.parse(storage.getItem(PREFS_KEY)!);
    expect(prefs.restoreSession).toBe(true);
    expect(prefs).not.toHaveProperty("audioQuality");
    expect(storage.getItem(LEGACY_KEY)).not.toBeNull();
    expect(storage.getItem(MIGRATED_KEY)).toBe("1");
  });

  it("forget session reports first, clears the queue and keeps preferences", async () => {
    let release!: () => void;
    const slowReport = new Promise<void>((resolve) => (release = resolve));
    const storage = new MemoryStorage();
    const h = createHarness({ storage, slowReport });
    h.engine.changeVolume(0.4);
    h.engine.setRepeat("all");
    await playing(h, list("a", "b"));
    await advance(5000, 250);
    let done = false;
    const forgetting = h.engine.forgetSession().then(() => (done = true));
    await flush();
    expect(h.reports.at(-1)?.endReason).toBe("stop");
    expect(done).toBe(false);
    release();
    await forgetting;
    const view = h.engine.getView();
    expect(view).toMatchObject({ status: "idle", entries: [], context: null, volume: 0.4, repeat: "all" });
    expect(createHarness({ storage }).engine.getView().entries).toEqual([]);
  });

  it("restore session off starts empty", () => {
    const storage = new MemoryStorage();
    storage.setItem(PREFS_KEY, JSON.stringify({ restoreSession: false }));
    storage.setItem(
      SESSION_KEY,
      JSON.stringify({
        entries: [{ entryId: "s1", track: track(y("a")), origin: "list", order: 0 }],
        index: 0,
        positionMs: 0,
        durationMs: 0,
        context: null,
        listCover: null,
      }),
    );
    const h = createHarness({ storage });
    expect(h.engine.getView()).toMatchObject({ status: "idle", entries: [] });
  });

  it("media session seek and stop handlers", async () => {
    const h = createHarness();
    await playing(h, list("a"));
    const handlers = new Map<string, MediaSessionActionHandler>();
    const session = { setActionHandler: (action: string, handler: MediaSessionActionHandler) => handlers.set(action, handler) } as unknown as MediaSessionLike;
    bindMediaSession(session, {
      play: () => h.engine.play(),
      pause: () => h.engine.pause(),
      next: () => h.engine.next(),
      previous: () => h.engine.previous(),
      seekTo: (ms) => h.engine.seekTo(ms),
      positionMs: () => h.engine.livePositionMs(),
      durationMs: () => h.engine.getView().durationMs,
    });
    h.deck.emit("timeupdate", { positionMs: 195_000 });
    handlers.get("seekforward")!({ action: "seekforward" });
    expect(h.engine.getView().positionMs).toBe(200_000);
    handlers.get("seekto")!({ action: "seekto", seekTime: 12.5 });
    expect(h.engine.getView().positionMs).toBe(12_500);
    handlers.get("stop")!({ action: "stop" });
    expect(h.engine.getView().status).toBe("paused");
  });

  it("the media session never looks ended during a track change", async () => {
    const positions: unknown[] = [];
    const session: MediaSessionLike = {
      metadata: null,
      playbackState: "none",
      setActionHandler: () => undefined,
      setPositionState: (state) => positions.push(state),
    };
    const mirror = new MediaSessionMirror(session, (init) => init as unknown as MediaMetadata);
    const h = createHarness();
    h.deps.mediaSession = mirror;
    await playing(h, list("a", "b"));
    const pending = h.youtube.pending(y("b"));
    const before = positions.length;
    h.engine.next();
    expect(session.playbackState).toBe("playing");
    expect(positions.length).toBe(before);
    pending.resolve(urlSource("https://rr1.googlevideo.com/b"));
    await h.engine.forgetSession();
    expect(session.playbackState).toBe("none");
    expect(session.metadata).toBeNull();
  });

  it("previous follows the play history", async () => {
    const h = createHarness();
    await playing(h, list("a", "b", "c", "d", "e", "f"));
    h.engine.playEntry(h.engine.getView().entries[4].entryId);
    await flush();
    h.engine.previous();
    await flush();
    expect(currentId(h)).toBe(y("a"));
    h.engine.previous();
    expect(currentId(h)).toBe(y("a"));
    expect(h.deck.seeks.at(-1)).toBe(0);
  });
});

describe("review focus", () => {
  it("a 10,000-entry session that exceeds the quota keeps 500 entries around the current one", async () => {
    const storage = new MemoryStorage();
    const h = createHarness({ storage });
    const id = (i: number) => String(i).padStart(11, "x");
    const tracks = Array.from({ length: 10_000 }, (_, i) => track(id(i)));
    storage.quotaBytes = 400_000;
    h.engine.playList(tracks, { startAt: 6000 });
    await flush();
    h.engine.pause();
    const saved = JSON.parse(storage.getItem(SESSION_KEY)!);
    expect(saved.entries).toHaveLength(500);
    expect(saved.entries[saved.index].track.id).toBe(id(6000));
    const restored = createHarness({ storage }).engine.getView();
    expect(restored.current?.track.id).toBe(id(6000));
  });

  it("progress rewrites only the small position key; a restore takes the position from it", async () => {
    const storage = new MemoryStorage();
    const h = createHarness({ storage });
    await playing(h, list("a", "b"));
    h.engine.pause();
    const queue = storage.getItem(SESSION_KEY);
    h.engine.play();
    await flush();
    h.deck.emit("timeupdate", { positionMs: 42_000 });
    h.engine.pause();
    expect(storage.getItem(SESSION_KEY)).toBe(queue);
    expect(JSON.parse(storage.getItem(POSITION_KEY)!).positionMs).toBe(42_000);
    const restored = createHarness({ storage }).engine.getView();
    expect(restored.current?.track.id).toBe(y("a"));
    expect(restored.positionMs).toBe(42_000);
    h.engine.next();
    h.engine.pause();
    expect(storage.getItem(SESSION_KEY)).not.toBe(queue);
    const afterNext = createHarness({ storage }).engine.getView();
    expect(afterNext.current?.track.id).toBe(y("b"));
    expect(afterNext.positionMs).toBe(0);
  });

  it("a track without a snapshot duration still ends naturally from the element's duration", async () => {
    const h = createHarness();
    h.engine.playList([track(y("a"), { durationMs: 0 }), track(y("b"))]);
    await flush();
    h.deck.duration = 180_000;
    h.deck.emit("durationchange", { durationMs: 180_000 });
    h.deck.emit("ended", { positionMs: 179_500 });
    expect(currentId(h)).toBe(y("b"));
  });
});
