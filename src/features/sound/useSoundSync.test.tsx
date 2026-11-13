import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { soundActions, usePlayerSnapshot as usePlayerStore } from "./engineLink";
import { useSoundStore } from "./store/soundStore";
import { useSoundSync } from "./useSoundSync";
import { BUILT_IN_PRESETS, autoPreamp } from "./lib/eq";
import { scheduleLoudness } from "./measureLoudness";

vi.mock("./measureLoudness", async (original) => ({ ...(await original<typeof import("./measureLoudness")>()), scheduleLoudness: vi.fn() }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Probe() {
  useSoundSync();
  return null;
}

function mount() {
  const root = createRoot(document.createElement("div"));
  act(() => root.render(createElement(Probe)));
  return root;
}

const initialSound = useSoundStore.getState();

function setTrack(id: string, artists: string, durationMs = 180_000) {
  usePlayerStore.setState({ currentTrack: { id, artists, durationMs } as never });
}

describe("useSoundSync", () => {
  let setEq: ReturnType<typeof vi.spyOn>;
  let setNorm: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    useSoundStore.setState(initialSound, true);
    usePlayerStore.setState({ currentTrack: null });
    setEq = vi.spyOn(soundActions, "setEq").mockImplementation(() => {});
    setNorm = vi.spyOn(soundActions, "setTrackGainDb").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.mocked(scheduleLoudness).mockClear();
  });

  it("re-shapes the shared EQ when the equalizer is enabled mid-track", () => {
    mount();
    act(() => useSoundStore.setState({ eqEnabled: true }));
    expect((setEq.mock.calls.at(-1)![0] as { enabled: boolean }).enabled).toBe(true);
  });

  it("uses the artist profile when no track profile exists", () => {
    useSoundStore.setState({ eqEnabled: true, byArtist: { "some band": "rock" } });
    mount();
    act(() => setTrack("t1", "Some Band"));
    const last = setEq.mock.calls.at(-1)![0] as { gains: number[]; enabled: boolean };
    expect(last.enabled).toBe(true);
    expect(last.gains).toEqual(BUILT_IN_PRESETS.rock);
  });

  it("track profile beats artist profile", () => {
    useSoundStore.setState({ eqEnabled: true, byArtist: { "some band": "rock" }, byTrack: { t1: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0] } });
    mount();
    act(() => setTrack("t1", "Some Band"));
    expect((setEq.mock.calls.at(-1)![0] as { gains: number[] }).gains[0]).toBe(1);
  });

  it("sends loudness gain only when normalization is on", () => {
    useSoundStore.setState({ loudness: { t1: { db: 3, at: 1 } } });
    mount();
    act(() => setTrack("t1", "x"));
    expect(setNorm).toHaveBeenLastCalledWith("t1", 3);
    act(() => useSoundStore.getState().setNormalization("off"));
    expect(setNorm).toHaveBeenLastCalledWith("t1", 0);
  });

  it("a measurement landing mid-track waits for the next play of that track", () => {
    mount();
    act(() => setTrack("t1", "x"));
    expect(setNorm).toHaveBeenLastCalledWith("t1", 0);
    const callsBefore = setNorm.mock.calls.length;
    act(() => useSoundStore.getState().setLoudness("t1", 4));
    expect(setNorm.mock.calls.length).toBe(callsBefore);
    act(() => setTrack("t2", "x"));
    act(() => setTrack("t1", "x"));
    expect(setNorm).toHaveBeenLastCalledWith("t1", 4);
  });

  it("measures each new track while normalization is on", () => {
    mount();
    act(() => setTrack("t1", "x", 200_000));
    expect(scheduleLoudness).toHaveBeenCalledWith("t1", expect.any(Function), 200_000);
    act(() => useSoundStore.getState().setNormalization("off"));
    act(() => setTrack("t2", "x"));
    expect(vi.mocked(scheduleLoudness).mock.calls.map(([id]) => id)).not.toContain("t2");
  });

  it("applies the auto preamp only when autoGain is on", () => {
    useSoundStore.setState({ eqEnabled: true, gains: [...BUILT_IN_PRESETS.bass_boost] });
    mount();
    expect((setEq.mock.calls.at(-1)![0] as { preampDb: number }).preampDb).toBe(autoPreamp(BUILT_IN_PRESETS.bass_boost));
    expect((setEq.mock.calls.at(-1)![0] as { preampDb: number }).preampDb).toBeLessThan(-5);
    act(() => useSoundStore.getState().setAutoGain(false));
    expect((setEq.mock.calls.at(-1)![0] as { preampDb: number }).preampDb).toBe(0);
  });
});
