import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import type { DeckEvent } from "../deckPort";
import { seededRandom } from "../shuffle";
import { gainFromSlider, sliderFromGain } from "../tempo";
import { createHarness, flush, track, y } from "../test/harness";
import { FakeContext, FakeElement, FakeGain, FakeWorkletNode, type FakeNode, type FakeParam } from "../test/fakeAudio";
import { DeckController, type TransitionPolicy } from "./decks";

const BANDS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000].map((frequency, i) => ({
  type: (i === 0 ? "lowshelf" : i === 9 ? "highshelf" : "peaking") as BiquadFilterType,
  frequency,
  q: 1.1,
}));

const source = (url: string) => ({ trackId: url, kind: "url" as const, url, mime: "audio/webm", release: vi.fn() });
const tempo = { rate: 1, semitones: 0, linked: true };

function setup(
  options: {
    context?: FakeContext;
    sources?: WeakMap<object, unknown>;
    elements?: [FakeElement, FakeElement];
    policy?: TransitionPolicy;
    crossfadeSeconds?: number;
  } = {},
) {
  const context = options.context ?? new FakeContext();
  const elements = options.elements ?? [new FakeElement(), new FakeElement()];
  const pitchLoads: number[] = [];
  const dropped: string[] = [];
  const decks = new DeckController({
    elements: elements as unknown as [HTMLMediaElement, HTMLMediaElement],
    createContext: () => context as unknown as AudioContext,
    graph: {
      bands: BANDS,
      random: seededRandom(1),
      loadPitch: async (ctx) => {
        pitchLoads.push(1);
        return new FakeWorkletNode(ctx as unknown as FakeContext) as unknown as AudioWorkletNode;
      },
      sources: (options.sources ?? new WeakMap()) as WeakMap<HTMLMediaElement, MediaElementAudioSourceNode>,
    },
    cacheUrl: (id) => `nuvo-core://local/v1/cache/audio/${id}`,
    isFullyCached: async () => true,
    dropCached: async (id) => {
      dropped.push(id);
    },
    transitionContext: () => ({
      crossfadeSeconds: options.crossfadeSeconds ?? 0,
      albumInOrder: false,
      repeat: "off",
      abLoop: false,
      sleepAtTrackEnd: false,
      reverbCurrent: null,
      reverbNext: null,
    }),
    log: () => undefined,
  });
  if (options.policy) decks.setPolicy(options.policy);
  const events: DeckEvent[] = [];
  decks.on((event) => events.push(event));
  const switches: string[] = [];
  decks.onSwitch((id) => switches.push(id));
  return { decks, context, elements, pitchLoads, dropped, events, switches };
}

const gains = (ctx: FakeContext) => ctx.ofType("gain") as FakeGain[];
const at = (param: FakeParam, ms: number, base: number) => param.valueAt(base + ms / 1000);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
});
afterEach(() => vi.useRealTimers());

async function playing(s: ReturnType<typeof setup>, url = "https://rr1.googlevideo.com/a", token = 1) {
  const loaded = s.decks.load({ token, trackId: url, source: source(url), positionMs: 0, tempo, play: true });
  await vi.advanceTimersByTimeAsync(40);
  await loaded;
  await flush();
}

describe("graph", () => {
  it("one graph: two decks into one bus, EQ in band order, closed reverb, master and analyser", async () => {
    const s = setup();
    await playing(s);
    const ctx = s.context;
    const sources = ctx.ofType("source");
    expect(sources).toHaveLength(2);
    const bus = (sources[0].outputs[0] as FakeNode).outputs[0].outputs[0];
    expect((sources[1].outputs[0] as FakeNode).outputs[0].outputs[0]).toBe(bus);
    const filters = ctx.ofType("biquad") as unknown as Array<{ type: string; frequency: FakeParam }>;
    expect(filters.slice(0, 10).map((f) => f.frequency.value)).toEqual(BANDS.map((b) => b.frequency));
    expect(filters[10].type).toBe("highpass");
    const analyser = ctx.ofType("analyser")[0] as unknown as { fftSize: number; smoothingTimeConstant: number };
    expect(analyser).toMatchObject({ fftSize: 4096, smoothingTimeConstant: 0.8 });
    expect(ctx.ofType("convolver")).toHaveLength(1);
    expect(ctx.ofType("worklet")).toHaveLength(0);
  });

  it("a spectrum listener subscribed before the first play gets its analyser on the graph, and a rebuild keeps it", async () => {
    const s = setup();
    const frames: unknown[] = [];
    const off = s.decks.soundBus.subscribeSpectrum((frame) => frames.push(frame));
    expect(s.context.ofType("analyser")).toHaveLength(0);
    await playing(s);
    expect(s.context.ofType("analyser")).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(50);
    expect(frames.length).toBeGreaterThan(0);
    s.decks.rebuildGraph();
    expect(s.context.ofType("analyser")).toHaveLength(4);
    off();
    const seen = frames.length;
    await vi.advanceTimersByTimeAsync(100);
    expect(frames.length).toBe(seen);
  });

  it("the output clock runs on from its last stamp between render callbacks and adds both latencies", async () => {
    const { decks, context } = setup();
    expect(decks.audioTime()).toBeNull();
    await decks.load({ token: 1, trackId: "a", source: source("a"), positionMs: 0, tempo, play: true });
    context.baseLatency = 0.02;
    context.outputLatency = 0.05;
    const wall = vi.spyOn(performance, "now").mockReturnValue(1100);
    context.outputStamp = { contextTime: 3, performanceTime: 1000 };
    expect(decks.audioTime()).toEqual({ nowMs: 3100, latencyMs: expect.closeTo(70, 6) });
    wall.mockReturnValue(1116);
    expect(decks.audioTime()?.nowMs).toBe(3116);
    decks.setTempo({ rate: 1, semitones: 3, linked: false });
    expect(decks.audioTime()?.latencyMs).toBeCloseTo(70 + (1536 / context.sampleRate) * 1000, 6);
    decks.setTempo(tempo);
    wall.mockRestore();
    context.state = "suspended";
    expect(decks.audioTime()).toBeNull();
  });

  it("a hot reload finds the same source nodes", async () => {
    const context = new FakeContext();
    const sources = new WeakMap();
    const elements: [FakeElement, FakeElement] = [new FakeElement(), new FakeElement()];
    await playing(setup({ context, sources, elements }));
    await playing(setup({ context, sources, elements }));
    expect([...context.sourceNodes.values()]).toEqual([1, 1]);
  });

  it("the pitch worklet exists only after the first unlinked request", async () => {
    const s = setup();
    await playing(s);
    expect(s.pitchLoads).toHaveLength(0);
    s.decks.setTempo({ rate: 1, semitones: 3, linked: false });
    await flush();
    s.decks.setTempo({ rate: 1, semitones: 4, linked: false });
    await flush();
    expect(s.pitchLoads).toHaveLength(1);
    const wet = gains(s.context).find((g) => g.gain.last("target")?.constant === 0.015 && g.gain.last("target")?.value === 1);
    expect(wet).toBeDefined();
  });

  it("the impulse response is built on the first enable; level 0.01 closes the send", async () => {
    const s = setup();
    await playing(s);
    const convolver = s.context.ofType("convolver")[0] as unknown as { buffer: unknown };
    expect(convolver.buffer).toBeNull();
    s.decks.soundBus.setReverb(true, 0.5);
    const buffer = convolver.buffer;
    expect(buffer).not.toBeNull();
    s.decks.soundBus.setReverb(true, 0.6);
    expect(convolver.buffer).toBe(buffer);
    const send = gains(s.context).find((g) => g.outputs.includes(s.context.ofType("convolver")[0]))!;
    expect(send.gain.last("target")).toMatchObject({ value: 1, constant: 0.02 });
    s.decks.soundBus.setReverb(true, 0.01);
    expect(send.gain.last("target")?.value).toBe(0);
  });

  it("EQ changes ramp with 20 ms and bypass flattens", async () => {
    const s = setup();
    await playing(s);
    const filters = s.context.ofType("biquad").slice(0, 10) as unknown as Array<{ gain: FakeParam }>;
    const writes = filters.map((f) => f.gain.directWrites);
    s.decks.soundBus.shapeEq({ enabled: true, gains: [6, 5, 4, 2, 0, 0, 0, 0, 0, 0], preampDb: -3, bypass: false });
    filters.forEach((f, i) => {
      expect(f.gain.last("target")?.constant).toBe(0.02);
      expect(f.gain.directWrites).toBe(writes[i]);
    });
    s.decks.soundBus.shapeEq({ enabled: true, gains: [6, 5, 4, 2, 0, 0, 0, 0, 0, 0], preampDb: -3, bypass: true });
    expect(filters.every((f) => f.gain.last("target")?.value === 0)).toBe(true);
  });

  it("loudness goes to the deck holding the track, also when it prepares later", async () => {
    const s = setup();
    await playing(s, "t");
    s.decks.soundBus.setTrackGainDb("t", -6);
    const loudness = (deck: number) => ((s.context.ofType("source")[deck].outputs[0] as FakeNode).outputs[0] as FakeGain).gain;
    expect(loudness(0).last("target")?.value).toBeCloseTo(0.501, 3);
    expect(loudness(1).last("target")).toBeUndefined();
    s.decks.setCandidate({ entryId: "e2", trackId: "t", tempo });
    s.elements[0].duration = 20;
    s.elements[0].currentTime = 10;
    s.elements[0].dispatch("timeupdate");
    await flush();
    expect(loudness(1).last("set")?.value).toBeCloseTo(0.501, 3);
  });

  it("slider law and volume on both elements", () => {
    expect(gainFromSlider(0.5)).toBe(0.25);
    expect(sliderFromGain(0.25)).toBe(0.5);
    const h = createHarness();
    h.engine.changeVolume(1.4);
    expect(h.engine.getView().volume).toBe(1);
    const s = setup();
    s.decks.setVolume(1);
    expect(s.elements.map((e) => e.volume)).toEqual([1, 1]);
  });
});

describe("fades", () => {
  it("the start rises over 180 ms on a raised cosine", async () => {
    const s = setup();
    const base = s.context.currentTime;
    await playing(s);
    const param = (s.context.ofType("source")[0].outputs[0] as FakeGain).gain;
    expect(at(param, 0, base)).toBeCloseTo(0, 2);
    expect(at(param, 90, base)).toBeCloseTo(0.5, 2);
    expect(at(param, 180, base)).toBeCloseTo(1, 2);
  });

  it("pause fades before the element pauses; play turns the fade around", async () => {
    const s = setup();
    await playing(s);
    await vi.advanceTimersByTimeAsync(500);
    const param = (s.context.ofType("source")[0].outputs[0] as FakeGain).gain;
    const base = s.context.currentTime;
    void s.decks.pause();
    await vi.advanceTimersByTimeAsync(90);
    expect(s.elements[0].paused).toBe(false);
    const mid = param.valueAt(base + 0.09);
    expect(mid).toBeCloseTo(0.5, 1);
    const events: string[] = [];
    s.decks.on((event) => events.push(event.type));
    await s.decks.resume();
    expect(events).toContain("playing");
    expect(param.valueAt(s.context.currentTime)).toBeCloseTo(mid, 2);
    await vi.advanceTimersByTimeAsync(200);
    expect(s.elements[0].paused).toBe(false);
    expect(param.valueAt(s.context.currentTime)).toBeCloseTo(1, 2);
    void s.decks.pause();
    await vi.advanceTimersByTimeAsync(180);
    expect(s.elements[0].paused).toBe(true);
  });

  it("replaying the playing file restarts it and raises playing again", async () => {
    const s = setup();
    await playing(s);
    await vi.advanceTimersByTimeAsync(2000);
    const events: string[] = [];
    s.decks.on((event) => events.push(event.type));
    await playing(s, "https://rr1.googlevideo.com/a", 2);
    expect(events).toContain("playing");
    expect(s.elements[0].currentTime).toBeLessThan(0.5);
  });

  it("the sleep level survives a graph rebuild and ignores volume", async () => {
    const s = setup();
    await playing(s);
    s.decks.soundBus.setSleepLevel(0.3);
    s.decks.setVolume(0.2);
    s.decks.rebuildGraph();
    const masters = gains(s.context).filter((g) => g.gain.last("target")?.constant === 0.3);
    expect(masters.at(-1)!.gain.last("target")?.value).toBe(0.3);
  });

  it("masked seeks dip the EQ output around the seek", async () => {
    const s = setup();
    await playing(s);
    const eqOut = gains(s.context).find((g) => g.outputs.length === 2 && g.outputs.some((o) => o.kind === "gain"))!;
    s.decks.soundBus.seekMasked(30_000);
    expect(eqOut.gain.last("linear")?.value).toBe(0);
    expect(s.elements[0].currentTime).toBeLessThan(30);
    await vi.advanceTimersByTimeAsync(8);
    expect(s.elements[0].currentTime).toBeCloseTo(30, 1);
    await flush();
    expect(eqOut.gain.last("linear")?.value).toBe(1);
    const silent = setup();
    await playing(silent);
    const out = gains(silent.context).find((g) => g.outputs.length === 2 && g.outputs.some((o) => o.kind === "gain"))!;
    (silent.elements[0] as unknown as { dispatch: (t: string) => void }).dispatch = () => undefined;
    silent.decks.soundBus.seekMasked(10_000);
    await vi.advanceTimersByTimeAsync(8 + 119);
    expect(out.gain.last("linear")?.value).toBe(0);
    await vi.advanceTimersByTimeAsync(2);
    expect(out.gain.last("linear")?.value).toBe(1);
  });
});

describe("tempo", () => {
  it("linked rate moves pitch and plays without pitch preservation", () => {
    const h = createHarness();
    h.engine.setTempo({ rate: 1.25 });
    expect(h.engine.getView().tempo.semitones).toBe(3.9);
    h.engine.setTempo({ semitones: -2 });
    expect(h.engine.getView().tempo.rate).toBe(0.89);
    const s = setup();
    s.decks.setTempo({ rate: 1.25, semitones: 3.9, linked: true });
    expect(s.elements[0].preservesPitch).toBe(false);
  });

  it("unlinked rate keeps pitch; semitones round to one decimal", () => {
    const h = createHarness();
    h.engine.setTempo({ linked: false });
    h.engine.setTempo({ rate: 1.5 });
    expect(h.engine.getView().tempo.semitones).toBe(0);
    h.engine.setTempo({ semitones: 4.04 });
    expect(h.engine.getView().tempo.semitones).toBe(4);
    const s = setup();
    s.decks.setTempo({ rate: 1.5, semitones: 0, linked: false });
    expect(s.elements[0].preservesPitch).toBe(true);
  });

  it("re-linking takes semitones from the rate", () => {
    const h = createHarness();
    h.engine.setTempo({ linked: false });
    h.engine.setTempo({ rate: 0.8, semitones: 5 });
    h.engine.setTempo({ linked: true });
    expect(h.engine.getView().tempo.semitones).toBe(-3.9);
  });

  it("rate and pitch clamp", () => {
    const h = createHarness();
    h.engine.setTempo({ linked: false });
    h.engine.setTempo({ rate: 2.7, semitones: -15 });
    expect(h.engine.getView().tempo).toMatchObject({ rate: 2, semitones: -12 });
  });

  it("keep tempo off resets on the next normal start", async () => {
    const h = createHarness();
    h.engine.setKeepTempo(false);
    h.engine.playList([track(y("a")), track(y("b"))]);
    await flush();
    h.engine.setTempo({ rate: 1.3 });
    h.engine.next();
    expect(h.engine.getView().tempo).toMatchObject({ rate: 1, semitones: 0 });
    const k = createHarness();
    k.engine.playList([track(y("a")), track(y("b"))]);
    await flush();
    k.engine.setTempo({ rate: 1.3 });
    k.engine.next();
    expect(k.engine.getView().tempo.rate).toBe(1.3);
  });

  it("a rate change during a crossfade moves only the incoming deck", async () => {
    const s = setup({ policy: (i) => ({ kind: "crossfade", startAtMediaMs: i.current.endMs - 6000, fadeMs: 6000 }) });
    await playing(s);
    s.decks.setCandidate({ entryId: "e2", trackId: "b", tempo });
    s.elements[0].currentTime = 190;
    s.elements[0].dispatch("timeupdate");
    await flush();
    await vi.advanceTimersByTimeAsync(4100);
    expect(s.switches).toEqual(["e2"]);
    s.decks.setTempo({ rate: 0.9, semitones: -1.8, linked: true });
    expect(s.elements[1].playbackRate).toBe(0.9);
    expect(s.elements[0].playbackRate).toBe(1);
  });

  it("tempo, reverb and EQ commands wake a suspended context", async () => {
    const s = setup();
    await playing(s);
    for (const command of [
      () => s.decks.setTempo({ rate: 1, semitones: 2, linked: false }),
      () => s.decks.soundBus.setReverb(true, 0.4),
      () => s.decks.soundBus.shapeEq({ enabled: true, gains: [], preampDb: 0, bypass: false }),
    ]) {
      s.context.state = "suspended";
      const before = s.context.resumes;
      command();
      expect(s.context.resumes).toBe(before + 1);
    }
  });
});

describe("transitions (sound part B slots)", () => {
  async function nearEnd(s: ReturnType<typeof setup>, seconds = 190) {
    await playing(s);
    s.decks.setCandidate({ entryId: "e2", trackId: "b", tempo: { rate: 1.1, semitones: 1.7, linked: true } });
    s.elements[0].currentTime = seconds;
    s.elements[0].dispatch("timeupdate");
    await flush();
  }

  it("the next cached entry is prepared inside the window and the switch is armed", async () => {
    const s = setup();
    s.decks.soundBus.setTrackGainDb("b", -4);
    await nearEnd(s, 186);
    const idle = s.elements[1];
    expect(idle.src).toBe("nuvo-core://local/v1/cache/audio/b");
    expect(idle.playbackRate).toBe(1.1);
    const loudness = ((s.context.ofType("source")[1].outputs[0] as FakeNode).outputs[0] as FakeGain).gain;
    expect(loudness.last("set")?.value).toBeCloseTo(10 ** (-4 / 20), 3);
    expect(s.decks.lookaheadMs).toBe(30);
    await vi.advanceTimersByTimeAsync(14_000 - 10 - 30 - 1);
    expect(s.switches).toEqual([]);
    await vi.advanceTimersByTimeAsync(5);
    expect(s.switches).toEqual(["e2"]);
  });

  it("a gapless switch: both curves at one time, one view change, no loading", async () => {
    const h = createHarness();
    h.engine.playList([track(y("a")), track(y("b"))]);
    await flush();
    const seen: Array<string | undefined> = [];
    h.engine.subscribe((v) => seen.push(v.current?.track.id));
    h.deck.fireSwitch(h.engine.getView().entries[1].entryId, 0);
    expect(new Set(seen)).toEqual(new Set([y("b")]));
    expect(h.engine.getView().status).toBe("playing");
    expect(h.reports[0]).toMatchObject({ trackId: y("a"), completed: true });

    const s = setup();
    await nearEnd(s);
    await vi.advanceTimersByTimeAsync(9975);
    expect(s.switches).toEqual(["e2"]);
    const [a, b] = s.context.ofType("source").map((src) => (src.outputs[0] as FakeGain).gain.last("curve")!);
    expect(a.time).toBe(b.time);
    expect(a.duration).toBe(0.01);
    expect(s.elements[0].paused).toBe(false);
    await vi.advanceTimersByTimeAsync(60);
    expect(s.elements[0].paused).toBe(true);
    expect(s.elements[0].src).not.toBe("");
  });

  it("a 6 s crossfade at rate 0.85 starts at the right media time with equal power", async () => {
    const s = setup({ crossfadeSeconds: 6, policy: (i) => ({ kind: "crossfade", startAtMediaMs: i.current.endMs - 6000 * i.rate, fadeMs: 6000 }) });
    await playing(s);
    s.elements[0].playbackRate = 0.85;
    s.decks.setCandidate({ entryId: "e2", trackId: "b", tempo });
    s.elements[0].currentTime = 180;
    s.elements[0].dispatch("timeupdate");
    await flush();
    const switchAtMedia = 200_000 - 6000 * 0.85;
    const waitMs = (switchAtMedia - 180_000) / 0.85 - 30;
    await vi.advanceTimersByTimeAsync(waitMs - 2);
    expect(s.switches).toEqual([]);
    await vi.advanceTimersByTimeAsync(4);
    expect(s.switches).toEqual(["e2"]);
    const curves = s.context.ofType("source").map((src) => (src.outputs[0] as FakeGain).gain.last("curve")!.curve!);
    for (let i = 0; i < 64; i++) expect(curves[0][i] ** 2 + curves[1][i] ** 2).toBeCloseTo(1, 6);
  });

  it("a reorder discards the preparation; a failed one drops the cache entry", async () => {
    const s = setup();
    await nearEnd(s);
    s.decks.setCandidate({ entryId: "e3", trackId: "c", tempo });
    await flush();
    expect(s.elements[1].src).toBe("nuvo-core://local/v1/cache/audio/c");
    const f = setup();
    await playing(f);
    (f.elements[1] as unknown as { load: () => void }).load = () => undefined;
    f.decks.setCandidate({ entryId: "e3", trackId: "c", tempo });
    f.elements[0].currentTime = 190;
    f.elements[0].dispatch("timeupdate");
    await vi.advanceTimersByTimeAsync(5100);
    expect(f.dropped).toEqual(["c"]);
  });

  it("a late timer: the natural end starts the prepared deck once", async () => {
    const s = setup({ policy: (i) => ({ kind: "plain", startAtMediaMs: i.current.endMs + 60_000, fadeMs: 0 }) });
    await nearEnd(s);
    s.elements[0].dispatch("ended");
    expect(s.switches).toEqual(["e2"]);
    s.elements[1].dispatch("ended");
    await vi.advanceTimersByTimeAsync(70_000);
    expect(s.switches).toEqual(["e2"]);
  });

  it("pause during a crossfade pauses both; next to another entry fades the outgoing deck", async () => {
    const policy: TransitionPolicy = (i) => ({ kind: "crossfade", startAtMediaMs: i.current.endMs - 6000, fadeMs: 6000 });
    const s = setup({ policy });
    await nearEnd(s);
    await vi.advanceTimersByTimeAsync(4100);
    void s.decks.pause();
    await vi.advanceTimersByTimeAsync(200);
    expect(s.elements.every((e) => e.paused)).toBe(true);
    await s.decks.resume();
    expect(s.elements[1].paused).toBe(false);
    expect(s.elements[0].paused).toBe(true);
    const inGain = (s.context.ofType("source")[1].outputs[0] as FakeGain).gain;
    await vi.advanceTimersByTimeAsync(200);
    expect(inGain.valueAt(s.context.currentTime)).toBeCloseTo(1, 2);

    const n = setup({ policy });
    await nearEnd(n);
    await vi.advanceTimersByTimeAsync(4100);
    const loaded = n.decks.load({ token: 9, trackId: "z", source: source("https://rr1.googlevideo.com/z"), positionMs: 0, tempo, play: true });
    await vi.advanceTimersByTimeAsync(40);
    await loaded;
    const outGain = (n.context.ofType("source")[0].outputs[0] as FakeGain).gain;
    expect(outGain.last("curve")?.duration).toBeCloseTo(0.03, 3);
  });
});

describe("release and idle cost", () => {
  it("the convolver is disconnected while reverb is off and reconnected on enable", async () => {
    const s = setup();
    await playing(s);
    const convolver = s.context.ofType("convolver")[0];
    const send = gains(s.context).find((g) => g.outputs.includes(convolver));
    expect(send).toBeUndefined();
    s.decks.soundBus.setReverb(true, 0.5);
    expect(gains(s.context).find((g) => g.outputs.includes(convolver))).toBeDefined();
    s.decks.soundBus.setReverb(false, 0.5);
    await vi.advanceTimersByTimeAsync(200);
    expect(gains(s.context).find((g) => g.outputs.includes(convolver))).toBeUndefined();
  });

  it("a reverb level at or below the closed threshold keeps the convolver disconnected and unbuilt", async () => {
    const s = setup();
    await playing(s);
    const convolver = s.context.ofType("convolver")[0];
    s.decks.soundBus.setReverb(true, 0.005);
    await vi.advanceTimersByTimeAsync(300);
    expect(gains(s.context).find((g) => g.outputs.includes(convolver))).toBeUndefined();
  });

  it("dispose clears timers, listeners and nodes, and resolves a pending pause", async () => {
    const s = setup();
    await nearEnd2(s);
    const pending = s.decks.pause();
    s.decks.dispose();
    await pending;
    expect(vi.getTimerCount()).toBe(0);
    const before = s.events.length;
    s.elements[0].dispatch("timeupdate");
    expect(s.events.length).toBe(before);
    expect(s.context.nodes.every((n) => n.outputs.length === 0)).toBe(true);
  });

  it("a candidate change while preparing aborts the stale preparation without a drop", async () => {
    const s = setup();
    await nearEnd2(s);
    s.decks.setCandidate({ entryId: "e3", trackId: "c", tempo });
    await flush();
    expect(s.dropped).toEqual([]);
    expect(s.elements[1].src).toBe("nuvo-core://local/v1/cache/audio/c");
  });
});

describe("fix round", () => {
  const policy: TransitionPolicy = (i) => ({ kind: "crossfade", startAtMediaMs: i.current.endMs - 6000, fadeMs: 6000 });

  it("dispose empties both elements and releases their sources", async () => {
    const s = setup();
    const first = source("https://rr1.googlevideo.com/a");
    await s.decks.load({ token: 1, trackId: "a", source: first, positionMs: 0, tempo, play: true });
    await flush();
    s.decks.dispose();
    expect(s.elements.map((e) => e.src)).toEqual(["", ""]);
    expect(first.release).toHaveBeenCalled();
  });

  it("cancelling a transition ramps the incoming gain instead of jumping to 1", async () => {
    const n = setup({ policy });
    await nearEnd2(n);
    await vi.advanceTimersByTimeAsync(4100);
    void n.decks.load({ token: 9, trackId: "z", source: source("https://rr1.googlevideo.com/z"), positionMs: 0, tempo, play: true });
    const inGain = (n.context.ofType("source")[1].outputs[0] as FakeGain).gain;
    expect(inGain.events.some((e) => e.kind === "set" && e.value === 1 && e.time >= n.context.currentTime)).toBe(false);
    expect(inGain.last("curve")?.duration).toBeCloseTo(0.03, 3);
  });

  it("a load over audible playback fades the old deck before cutting", async () => {
    const s = setup();
    await playing(s);
    await vi.advanceTimersByTimeAsync(500);
    const param = (s.context.ofType("source")[0].outputs[0] as FakeGain).gain;
    void s.decks.load({ token: 2, trackId: "b", source: source("https://rr1.googlevideo.com/b"), positionMs: 0, tempo, play: true });
    expect(param.valueAt(s.context.currentTime)).toBeGreaterThan(0.9);
    expect(s.elements[0].src).toBe("https://rr1.googlevideo.com/a");
    await vi.advanceTimersByTimeAsync(40);
    expect(s.elements[0].src).toBe("https://rr1.googlevideo.com/b");
  });

  it("volume clamps to 0..1", () => {
    const s = setup();
    s.decks.setVolume(1.7);
    expect(s.elements[0].volume).toBe(1);
    s.decks.setVolume(-1);
    expect(s.elements[0].volume).toBe(0);
  });

  it("a second masked seek keeps the mask until its own seek ends", async () => {
    const s = setup();
    await playing(s);
    const out = gains(s.context).find((g) => g.outputs.length === 2 && g.outputs.some((o) => o.kind === "gain"))!;
    (s.elements[0] as unknown as { dispatch: (t: string) => void }).dispatch = () => undefined;
    s.decks.soundBus.seekMasked(10_000);
    await vi.advanceTimersByTimeAsync(50);
    s.decks.soundBus.seekMasked(20_000);
    await vi.advanceTimersByTimeAsync(100);
    expect(out.gain.last("linear")?.value).toBe(0);
    await vi.advanceTimersByTimeAsync(40);
    expect(out.gain.last("linear")?.value).toBe(1);
  });

  it("rebuildGraph disconnects the old graph", async () => {
    const s = setup();
    await playing(s);
    const old = s.context.nodes.filter((n) => n.kind !== "source");
    s.decks.rebuildGraph();
    expect(old.every((n) => n.outputs.length === 0)).toBe(true);
  });

  it("the shifter is fed ahead of the dry gain, which closes as it opens", async () => {
    const s = setup();
    await playing(s);
    s.decks.setTempo({ rate: 1, semitones: 3, linked: false });
    await flush();
    const worklet = s.context.ofType("worklet")[0];
    const feeder = s.context.nodes.find((node) => node.outputs.includes(worklet));
    expect(feeder?.outputs.length).toBeGreaterThan(1);
  });

  it("the pitch worklet is disconnected while the pitch stage is inactive", async () => {
    const s = setup();
    await playing(s);
    s.decks.setTempo({ rate: 1, semitones: 3, linked: false });
    await flush();
    const worklet = s.context.ofType("worklet")[0];
    expect(worklet.outputs).toHaveLength(1);
    s.decks.setTempo({ rate: 1, semitones: 0, linked: true });
    await vi.advanceTimersByTimeAsync(200);
    expect(worklet.outputs).toHaveLength(0);
    s.decks.setTempo({ rate: 1, semitones: 2, linked: false });
    await flush();
    expect(worklet.outputs).toHaveLength(1);
  });
});

async function nearEnd2(s: ReturnType<typeof setup>) {
  await playing(s);
  s.decks.setCandidate({ entryId: "e2", trackId: "b", tempo });
  s.elements[0].currentTime = 190;
  s.elements[0].dispatch("timeupdate");
  await flush();
}
