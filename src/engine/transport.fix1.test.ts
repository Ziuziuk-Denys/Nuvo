import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { MediaSessionMirror, bindMediaSession, type MediaSessionLike } from "./mediaSession";
import { PREFS_KEY } from "./persist";
import { advance, createHarness, flush, MemoryStorage, track, y, type Harness } from "./test/harness";

const list = (...letters: string[]) => letters.map((l) => track(y(l)));
const currentId = (h: Harness) => h.engine.getView().current?.track.id;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-27T12:00:00Z"));
});
afterEach(() => vi.useRealTimers());

async function playing(h: Harness, tracks = list("a", "b", "c", "d"), startAt = 0) {
  h.engine.playList(tracks, { startAt });
  await flush();
  expect(h.engine.getView().status).toBe("playing");
}

describe("failures with repeat", () => {
  it("repeat-all with every entry failing goes idle with one notice per entry", async () => {
    const h = createHarness();
    for (const l of ["a", "b", "c"]) h.youtube.fail(y(l), "unplayable");
    h.engine.setRepeat("all");
    h.engine.playList(list("a", "b", "c"));
    await advance(3000);
    const view = h.engine.getView();
    expect(view.status).toBe("idle");
    expect(view.notice).toMatchObject({ kind: "queue_failed" });
    expect(h.notices).toHaveLength(3);
    expect(h.youtube.resolves).toHaveLength(3);
  });
});

describe("errors while paused", () => {
  it("a deck error while paused does not resume; play reloads at the position", async () => {
    const h = createHarness();
    await playing(h, list("a"));
    h.deck.emit("timeupdate", { positionMs: 5000 });
    h.engine.pause();
    h.deck.emit("error", { error: { code: 4 } });
    await advance(200);
    expect(h.engine.getView().status).toBe("paused");
    expect(h.deck.loads).toHaveLength(1);
    h.engine.play();
    await flush();
    expect(h.deck.loads).toHaveLength(2);
    expect(h.deck.loads[1].positionMs).toBe(5000);
    expect(h.engine.getView().status).toBe("playing");
  });
});

describe("prepared deck switch", () => {
  it("applies tempo memory rules, saves them and reports a source", async () => {
    const storage = new MemoryStorage();
    const h = createHarness({ storage });
    await playing(h);
    h.engine.setKeepTempo(false);
    h.engine.setTempo({ rate: 1.5 });
    expect(h.engine.getView().tempo.rate).toBe(1.5);
    const [, second] = h.engine.getView().entries;
    h.deck.fireSwitch(second.entryId, 0);
    await flush();
    expect(currentId(h)).toBe(y("b"));
    expect(h.engine.getView().tempo.rate).toBe(1);
    expect(JSON.parse(storage.getItem(PREFS_KEY)!).rate).toBe(1);
    expect(h.reports[0]).toMatchObject({ trackId: y("a"), endReason: "complete" });
    h.engine.next();
    await flush();
    expect(h.reports.find((r) => r.trackId === y("b"))?.source).toBe("cache");
  });

  it("a switch to the next entry moves the index, history and lyrics", async () => {
    const h = createHarness();
    await playing(h);
    const [, second] = h.engine.getView().entries;
    h.deck.fireSwitch(second.entryId, 0);
    expect(h.engine.getView().index).toBe(1);
    expect(h.engine.getView().status).toBe("playing");
    expect(h.lyrics).toContainEqual({ kind: "follow", id: y("b") });
    h.engine.previous();
    await flush();
    expect(currentId(h)).toBe(y("a"));
  });
});

describe("append", () => {
  it("on an empty queue adds the entry without starting; play starts it", async () => {
    const h = createHarness();
    h.engine.append(track(y("a")));
    await flush();
    expect(h.deck.loads).toHaveLength(0);
    expect(h.engine.getView().status).toBe("idle");
    expect(h.engine.getView().entries).toHaveLength(1);
    h.engine.play();
    await flush();
    expect(h.engine.getView().status).toBe("playing");
  });
});

describe("dispose", () => {
  it("drops deck listeners, timers and the media session", async () => {
    const session: MediaSessionLike = { metadata: null, playbackState: "none", setActionHandler: vi.fn(), setPositionState: vi.fn() };
    const h = createHarness();
    h.deps.mediaSession = new MediaSessionMirror(session, (init) => init as unknown as MediaMetadata);
    h.continuation.answers = [list("z")];
    await playing(h, list("a"));
    const seen: unknown[] = [];
    h.engine.subscribe((v) => seen.push(v));
    h.engine.dispose();
    expect(h.deck.disposed).toBe(0);
    expect(h.lyrics.at(-1)).toEqual({ kind: "follow", id: null });
    expect(session.playbackState).toBe("none");
    const requests = h.continuation.requests.length;
    h.deck.emit("timeupdate", { positionMs: 9000 });
    await advance(2000);
    expect(seen).toHaveLength(0);
    expect(h.continuation.requests).toHaveLength(requests);
  });

  it("commands after dispose do nothing and a second dispose is harmless", async () => {
    const h = createHarness();
    await playing(h, list("a"));
    h.engine.dispose();
    h.engine.dispose();
    const loads = h.deck.loads.length;
    const entries = h.engine.getView().entries.length;
    h.engine.playList(list("b"));
    h.engine.append(track("c"));
    h.engine.pause();
    await flush();
    expect(h.deck.loads).toHaveLength(loads);
    expect(h.engine.getView().entries).toHaveLength(entries);
    expect(h.engine.getView().status).toBe("playing");
  });

  it("bindMediaSession returns an unbind", () => {
    const handlers = new Map<string, unknown>();
    const session = { setActionHandler: (a: string, fn: unknown) => handlers.set(a, fn) } as unknown as MediaSessionLike;
    const unbind = bindMediaSession(session, { play() {}, pause() {}, next() {}, previous() {}, seekTo() {}, positionMs: () => 0, durationMs: () => 0 });
    expect(handlers.get("play")).toBeTypeOf("function");
    unbind();
    expect(handlers.get("play")).toBeNull();
  });
});

describe("pauseFor", () => {
  it("pauses playing with the given reason, ignores a paused or idle player", async () => {
    const h = createHarness();
    h.engine.pauseFor("sleep");
    expect(h.engine.getView().status).toBe("idle");
    await playing(h);
    h.engine.pauseFor("device_lost");
    expect(h.engine.getView()).toMatchObject({ status: "paused", pauseReason: "device_lost" });
    h.engine.pauseFor("sleep");
    expect(h.engine.getView().pauseReason).toBe("device_lost");
    h.engine.resume();
    await flush();
    expect(h.engine.getView().status).toBe("playing");
    h.engine.pauseFor("sleep");
    expect(h.engine.getView().pauseReason).toBe("sleep");
  });

  it("a command cancels device auto-resume listeners", async () => {
    const h = createHarness();
    await playing(h);
    const ran = vi.fn();
    h.engine.onCommand(ran);
    h.engine.pauseFor("device_lost");
    expect(ran).not.toHaveBeenCalled();
    h.engine.play();
    expect(ran).toHaveBeenCalledTimes(1);
  });
});

describe("preferences persistence", () => {
  it("volume, tempo, reverb, keep tempo and output survive a restart", () => {
    const storage = new MemoryStorage();
    const h = createHarness({ storage });
    h.engine.changeVolume(0.3);
    h.engine.setTempo({ rate: 1.25, semitones: 2, linked: false });
    h.engine.setReverb({ on: true, level: 0.6 });
    h.engine.setKeepTempo(false);
    h.engine.setRememberedOutput({ id: "dev1", label: "Speakers" });
    h.engine.setPauseOnDeviceLoss(false);
    expect(h.deck.volume).toBe(0.3);
    expect(h.deck.reverb).toEqual({ on: true, level: 0.6 });
    const again = createHarness({ storage });
    const view = again.engine.getView();
    expect(view.volume).toBe(0.3);
    expect(view.tempo).toEqual({ rate: 1.25, semitones: 2, linked: false, keepAcrossTracks: false });
    expect(view.reverb).toEqual({ on: true, level: 0.6 });
    expect(again.engine.rememberedOutput).toEqual({ id: "dev1", label: "Speakers" });
    expect(again.engine.pauseOnDeviceLoss).toBe(false);
    expect(again.deck.volume).toBe(0.3);
  });
});

describe("scrub then skip", () => {
  it("the report carries the seek flags", async () => {
    const h = createHarness();
    await playing(h);
    h.deck.emit("timeupdate", { positionMs: 10_000 });
    h.engine.seekTo(100_000);
    h.deck.emit("timeupdate", { positionMs: 100_000 });
    h.engine.seekTo(20_000);
    h.engine.next();
    await flush();
    const report = h.reports.find((r) => r.trackId === y("a"))!;
    expect(report.hasSeekBackward).toBe(true);
    expect(report.seekForwardMs).toBe(90_000);
    expect(report.skipped).toBe(true);
    expect(report.endReason).toBe("skip");
  });
});

describe("lyrics on a fresh list", () => {
  it("playing a list from idle follows its first track once it plays", async () => {
    const h = createHarness();
    await playing(h);
    expect(h.lyrics.filter((l) => l.kind === "follow")).toEqual([{ kind: "follow", id: y("a") }]);
  });
});
