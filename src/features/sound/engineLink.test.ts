import { describe, expect, it, vi, afterEach } from "vitest";
import type { Engine } from "@/engine/engine";
import type { Track } from "@/engine/types";
import { connectSound, engineSound, soundActions, usePlayerSnapshot, type SoundBackend } from "./engineLink";
import { TEMPO_PRESETS } from "./lib/tempo";

const track = { id: "t1", title: "A", artists: "X" } as Track;

function fakeEngine() {
  const calls: string[] = [];
  let listener: (() => void) | null = null;
  const unsubscribe = vi.fn();
  let resolver: unknown = "unset";
  const view = {
    current: { track },
    status: "playing",
    positionMs: 1000,
    durationMs: 5000,
    tempo: { rate: 1.25, semitones: 3, linked: false, keepAcrossTracks: true },
    reverb: { on: true, level: 0.4 },
    entries: [{ track }],
    index: 0,
  };
  const engine = {
    getView: () => view,
    subscribe: (fn: () => void) => {
      listener = fn;
      return unsubscribe;
    },
    seekTo: vi.fn(),
    pauseFor: vi.fn(),
    setTempo: (change: object) => calls.push(`tempo ${JSON.stringify(change)}`),
    setReverb: (change: object) => calls.push(`reverb ${JSON.stringify(change)}`),
    setTempoResolver: (fn: unknown) => {
      resolver = fn;
    },
  };
  return { engine: engine as unknown as Engine, calls, unsubscribe, view, fire: () => listener?.(), resolver: () => resolver };
}

function fakeBus() {
  return { shapeEq: vi.fn(), setTrackGainDb: vi.fn(), analyser: vi.fn(() => null), setSleepLevel: vi.fn(), seekMasked: vi.fn() };
}

afterEach(() => vi.restoreAllMocks());

describe("engineSound", () => {
  it("mirrors the engine view into the snapshot and stops on disconnect", () => {
    const f = fakeEngine();
    const { backend, mirror } = engineSound(f.engine, fakeBus(), () => 0);
    const disconnect = connectSound(backend, mirror);
    expect(usePlayerSnapshot.getState()).toMatchObject({
      currentTrack: track,
      status: "playing",
      positionMs: 1000,
      durationMs: 5000,
      playbackRate: 1.25,
      pitchSemitones: 3,
      isPitchLinked: false,
      isReverbEnabled: true,
      reverbLevel: 0.4,
      keepSpeedAcrossTracks: true,
      queue: [track],
      currentIndex: 0,
    });
    f.view.positionMs = 2000;
    f.fire();
    expect(usePlayerSnapshot.getState().positionMs).toBe(2000);
    disconnect();
    expect(f.unsubscribe).toHaveBeenCalled();
  });

  it("sets a tempo in one engine call, then reverb", () => {
    const f = fakeEngine();
    const { backend } = engineSound(f.engine, fakeBus(), () => 0);
    backend.setTempo({ rate: 1.25, pitchSemitones: 3, pitchLinked: false, reverb: 0.5 });
    expect(f.calls).toEqual(['tempo {"rate":1.25,"semitones":3,"linked":false}', 'reverb {"on":true,"level":0.5}']);
    f.calls.length = 0;
    backend.setTempo({ rate: 1.25, pitchSemitones: 3, pitchLinked: true, reverb: null });
    expect(f.calls).toEqual(['tempo {"rate":1.25,"linked":true}', 'reverb {"on":false}']);
    f.calls.length = 0;
    backend.setTempo(TEMPO_PRESETS.normal);
    expect(f.calls.at(-1)).toBe('reverb {"on":false}');
  });

  it("maps the tempo resolver and clears it with null", () => {
    const f = fakeEngine();
    const { backend } = engineSound(f.engine, fakeBus(), () => 0);
    backend.setTempoResolver(() => ({ rate: 0.8, pitchSemitones: -2, pitchLinked: true, reverb: null }));
    const resolve = f.resolver() as (t: Track) => unknown;
    expect(resolve(track)).toEqual({ rate: 0.8, semitones: -2, linked: true, reverb: null });
    backend.setTempoResolver(null);
    expect(f.resolver()).toBeNull();
  });

  it("passes seek, sleep pause and the bus actions through", () => {
    const f = fakeEngine();
    const bus = fakeBus();
    const { backend } = engineSound(f.engine, bus, () => 42);
    backend.seek(900);
    backend.pauseForSleep();
    backend.seekMasked(700);
    backend.setSleepLevel(0.5);
    backend.setTrackGainDb("t1", -2);
    backend.setEq({ enabled: true, gains: [], preampDb: 0, bypass: false } as never);
    expect(f.engine.seekTo).toHaveBeenCalledWith(900);
    expect(f.engine.pauseFor).toHaveBeenCalledWith("sleep");
    expect(bus.seekMasked).toHaveBeenCalledWith(700);
    expect(bus.setSleepLevel).toHaveBeenCalledWith(0.5);
    expect(bus.setTrackGainDb).toHaveBeenCalledWith("t1", -2);
    expect(bus.shapeEq).toHaveBeenCalled();
    expect(backend.livePositionMs()).toBe(42);
  });
});

describe("connectSound", () => {
  it("routes actions to the backend, and falls back after disconnect", () => {
    const seek = vi.fn();
    const backend = { seek } as unknown as SoundBackend;
    const disconnect = connectSound(backend, () => () => {});
    soundActions.seek(10);
    expect(seek).toHaveBeenCalledWith(10);
    disconnect();
    soundActions.seek(20);
    expect(seek).toHaveBeenCalledTimes(1);
    expect(soundActions.analyser()).toBeNull();
    usePlayerSnapshot.setState({ positionMs: 777 });
    expect(soundActions.livePositionMs()).toBe(777);
  });
});
