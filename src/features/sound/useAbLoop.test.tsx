import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { act, createElement } from "react";
import { type Root, createRoot } from "react-dom/client";
import { soundActions, usePlayerSnapshot as usePlayerStore } from "./engineLink";
import { setLoopPointHere, useAbLoop, useAbLoopStore } from "./useAbLoop";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Probe() {
  useAbLoop();
  return null;
}

const clock = { base: 0, at: 0 };
const mediaMs = () => clock.base + (Date.now() - clock.at) * usePlayerStore.getState().playbackRate;
const placeAt = (ms: number) => {
  clock.base = ms;
  clock.at = Date.now();
};

describe("A-B loop", () => {
  let seekPositions: number[];
  let seek: ReturnType<typeof vi.spyOn>;
  let root: Root;

  const setLoop = (a: number, b: number) =>
    act(() => {
      useAbLoopStore.getState().setPoint("a", a);
      useAbLoopStore.getState().setPoint("b", b);
    });

  beforeEach(() => {
    vi.useFakeTimers();
    placeAt(0);
    seekPositions = [];
    usePlayerStore.setState({ currentTrack: { id: "t1" } as never, positionMs: 0, status: "playing", playbackRate: 1 });
    useAbLoopStore.getState().clear();
    vi.spyOn(soundActions, "livePositionMs").mockImplementation(mediaMs);
    seek = vi.spyOn(soundActions, "seekMasked").mockImplementation((target: number) => {
      seekPositions.push(mediaMs());
      usePlayerStore.setState({ positionMs: target });
      placeAt(target);
    });
    root = createRoot(document.createElement("div"));
    act(() => root.render(createElement(Probe)));
  });

  afterEach(() => {
    act(() => root.unmount());
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("sets points at the playback position", () => {
    usePlayerStore.setState({ positionMs: 10_000 });
    act(() => setLoopPointHere("a"));
    usePlayerStore.setState({ positionMs: 20_000 });
    act(() => setLoopPointHere("b"));
    expect(useAbLoopStore.getState()).toMatchObject({ a: 10_000, b: 20_000 });
  });

  it("jumps to A at B on a timer, with no position update, and never overshoots by more than 30 ms", () => {
    placeAt(19_000);
    setLoop(10_000, 20_000);
    act(() => vi.advanceTimersByTime(950));
    expect(seek).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(100));
    expect(seek).toHaveBeenCalledTimes(1);
    expect(seek).toHaveBeenCalledWith(10_000);
    expect(Math.abs(seekPositions[0] - 20_000)).toBeLessThanOrEqual(30);

    act(() => vi.advanceTimersByTime(9_900));
    expect(seek).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(200));
    expect(seek).toHaveBeenCalledTimes(2);
    expect(Math.abs(seekPositions[1] - 20_000)).toBeLessThanOrEqual(30);
  });

  it("aims at B in wall time at double speed", () => {
    act(() => usePlayerStore.setState({ playbackRate: 2 }));
    placeAt(19_000);
    setLoop(10_000, 20_000);
    act(() => vi.advanceTimersByTime(480));
    expect(seek).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(40));
    expect(seek).toHaveBeenCalledTimes(1);
    expect(Math.abs(seekPositions[0] - 20_000)).toBeLessThanOrEqual(30);
  });

  it("re-aims when the user seeks past B", () => {
    placeAt(12_000);
    setLoop(10_000, 20_000);
    placeAt(25_000);
    act(() => usePlayerStore.setState({ positionMs: 25_000 }));
    expect(seek).toHaveBeenCalledWith(10_000);
  });

  it("does nothing while paused or with only A set", () => {
    act(() => usePlayerStore.setState({ status: "paused" }));
    placeAt(19_000);
    setLoop(10_000, 20_000);
    act(() => vi.advanceTimersByTime(5_000));
    expect(seek).not.toHaveBeenCalled();

    act(() => {
      useAbLoopStore.getState().clear();
      useAbLoopStore.getState().setPoint("a", 10_000);
      usePlayerStore.setState({ status: "playing" });
    });
    act(() => vi.advanceTimersByTime(5_000));
    expect(seek).not.toHaveBeenCalled();
  });

  it("clears on track change", () => {
    act(() => useAbLoopStore.getState().setPoint("a", 10_000));
    act(() => usePlayerStore.setState({ currentTrack: { id: "t2" } as never }));
    expect(useAbLoopStore.getState()).toMatchObject({ a: null, b: null });
  });
});
