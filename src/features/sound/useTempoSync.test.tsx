import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { soundActions, usePlayerSnapshot as usePlayerStore } from "./engineLink";
import type { TempoSettings } from "./lib/tempo";
import { useSoundStore } from "./store/soundStore";
import { TEMPO_PRESETS } from "./lib/tempo";
import { useTempoSync } from "./useTempoSync";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Probe() {
  useTempoSync();
  return null;
}

const initialSound = useSoundStore.getState();
const neutralPlayer = { playbackRate: 1, pitchSemitones: 0, isPitchLinked: true, isReverbEnabled: false, reverbLevel: 0.35, keepSpeedAcrossTracks: true };

function setTrack(id: string, artists: string) {
  act(() => usePlayerStore.setState({ currentTrack: { id, artists } as never }));
}

const rate = () => usePlayerStore.getState().playbackRate;
const setRate = (value: number) =>
  usePlayerStore.setState({ playbackRate: value, pitchSemitones: Number((12 * Math.log2(value)).toFixed(1)), isPitchLinked: true });

describe("useTempoSync", () => {
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    vi.spyOn(soundActions, "setTempo").mockImplementation((t: TempoSettings) =>
      usePlayerStore.setState({
        playbackRate: t.rate,
        pitchSemitones: t.pitchSemitones,
        isPitchLinked: t.pitchLinked,
        isReverbEnabled: t.reverb !== null,
        reverbLevel: t.reverb ?? usePlayerStore.getState().reverbLevel,
      }),
    );
    vi.spyOn(soundActions, "setTempoResolver").mockImplementation(() => undefined);
    useSoundStore.setState(initialSound, true);
    usePlayerStore.setState({ ...neutralPlayer, currentTrack: null });
    root = createRoot(document.createElement("div"));
    act(() => root.render(createElement(Probe)));
  });

  afterEach(() => {
    act(() => root.unmount());
    vi.restoreAllMocks();
  });

  it("track memory beats artist memory beats global", () => {
    useSoundStore.getState().rememberTempo("artist", "Massive Attack", TEMPO_PRESETS.spedUp);
    useSoundStore.getState().rememberTempo("track", "t1", TEMPO_PRESETS.slowedReverb);
    setTrack("t1", "Massive Attack");
    expect(rate()).toBe(0.85);
    expect(usePlayerStore.getState().isReverbEnabled).toBe(true);
    setTrack("t2", "massive attack");
    expect(rate()).toBe(1.25);
    expect(usePlayerStore.getState().isReverbEnabled).toBe(false);
  });

  it("restores the global values on a track without memory", () => {
    act(() => setRate(0.9));
    useSoundStore.getState().rememberTempo("track", "t1", TEMPO_PRESETS.nightcore);
    setTrack("t1", "A");
    expect(usePlayerStore.getState()).toMatchObject({ playbackRate: 1.25, pitchSemitones: 3, isPitchLinked: false });
    setTrack("t2", "B");
    expect(usePlayerStore.getState()).toMatchObject({ playbackRate: 0.9, isPitchLinked: true });
  });

  it("resets to neutral between tracks without memory when speed is not kept", () => {
    usePlayerStore.setState({ keepSpeedAcrossTracks: false });
    setTrack("t1", "A");
    act(() => setRate(0.7));
    setTrack("t2", "B");
    expect(rate()).toBe(1);
  });

  it("keeps the stored global between tracks without memory when speed is kept", () => {
    setTrack("t1", "A");
    act(() => setRate(0.7));
    expect(useSoundStore.getState().globalTempo.rate).toBe(0.7);
    setTrack("t2", "B");
    expect(rate()).toBe(0.7);
  });

  it("a memory track is not overwritten when speed is not kept", () => {
    usePlayerStore.setState({ keepSpeedAcrossTracks: false });
    useSoundStore.getState().rememberTempo("track", "t1", TEMPO_PRESETS.slowed);
    setTrack("t0", "A");
    setTrack("t1", "A");
    expect(rate()).toBe(0.85);
    expect(useSoundStore.getState().tempoByTrack.t1).toEqual(TEMPO_PRESETS.slowed);
  });

  it("edits while remembered update only that track and not the global", () => {
    useSoundStore.getState().rememberTempo("track", "t1", TEMPO_PRESETS.slowed);
    useSoundStore.getState().rememberTempo("track", "t2", TEMPO_PRESETS.spedUp);
    setTrack("t1", "A");
    act(() => setRate(0.7));
    const { tempoByTrack, globalTempo } = useSoundStore.getState();
    expect(tempoByTrack.t1.rate).toBe(0.7);
    expect(tempoByTrack.t2).toEqual(TEMPO_PRESETS.spedUp);
    expect(globalTempo).toEqual(TEMPO_PRESETS.normal);
    setTrack("t3", "B");
    expect(rate()).toBe(1);
  });

  it("does not re-apply a tempo that is already playing", () => {
    setTrack("t1", "A");
    const setTempo = vi.mocked(soundActions.setTempo);
    setTempo.mockClear();
    setTrack("t2", "B");
    expect(setTempo).not.toHaveBeenCalled();
  });

  it("forgetting returns to the global values", () => {
    setTrack("t1", "A");
    act(() => setRate(0.8));
    act(() => useSoundStore.getState().rememberTempo("track", "t1", TEMPO_PRESETS.spedUp));
    expect(rate()).toBe(1.25);
    act(() => useSoundStore.getState().forgetTempo("track", "t1"));
    expect(rate()).toBe(0.8);
  });

  it("mounting on a memory track leaves the stored global alone", () => {
    act(() => root.unmount());
    const global = { ...TEMPO_PRESETS.slowed, rate: 0.9, pitchSemitones: -1.8 };
    useSoundStore.setState({ globalTempo: global });
    useSoundStore.getState().rememberTempo("track", "t1", TEMPO_PRESETS.nightcore);
    usePlayerStore.setState({ ...neutralPlayer, playbackRate: 0.9, pitchSemitones: -1.8, currentTrack: { id: "t1", artists: "A" } as never });
    root = createRoot(document.createElement("div"));
    act(() => root.render(createElement(Probe)));
    expect(rate()).toBe(1.25);
    expect(useSoundStore.getState().globalTempo).toEqual(global);
    setTrack("t2", "B");
    expect(rate()).toBe(0.9);
  });
});
