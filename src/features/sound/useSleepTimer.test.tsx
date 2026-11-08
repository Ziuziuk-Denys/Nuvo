import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { act, createElement, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { soundActions, usePlayerSnapshot as usePlayerStore } from "./engineLink";
import { armSleepTimer, cancelSleepTimer, formatSleepClock, useSleepStore, useSleepTimer } from "./useSleepTimer";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const MINUTE = 60_000;
const TRACK_1 = { id: "t1", title: "One", artists: "A", durationMs: 100_000 };
const TRACK_2 = { id: "t2", title: "Two", artists: "B", durationMs: 100_000 };

describe("sleep timer", () => {
  let pause: ReturnType<typeof vi.spyOn>;
  let setFade: ReturnType<typeof vi.spyOn>;

  const advance = (ms: number) => act(() => void vi.advanceTimersByTime(ms));
  const lastFade = () => setFade.mock.calls.at(-1)?.[0];

  beforeEach(() => {
    vi.useFakeTimers();
    usePlayerStore.setState({
      status: "playing",
      currentTrack: TRACK_1 as never,
      queue: [TRACK_1, TRACK_2] as never,
      currentIndex: 0,
      positionMs: 0,
      durationMs: 100_000,
    });
    pause = vi.spyOn(soundActions, "pauseForSleep").mockImplementation(() => {});
    setFade = vi.spyOn(soundActions, "setSleepLevel").mockImplementation(() => {});
  });

  afterEach(() => {
    act(() => cancelSleepTimer());
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("pauses a 15 minute timer at 15:00 and fades from 14:30", () => {
    act(() => armSleepTimer({ kind: "minutes", minutes: 15 }));
    advance(14 * MINUTE + 29_000);
    expect(pause).not.toHaveBeenCalled();
    expect(setFade).not.toHaveBeenCalled();

    advance(2_000);
    expect(lastFade()).toBeLessThan(1);
    advance(29_000);
    expect(pause).toHaveBeenCalledTimes(1);
    expect(useSleepStore.getState().plan).toBeNull();

    advance(500);
    expect(lastFade()).toBe(1);
  });

  it("keeps counting wall time while playback is paused", () => {
    act(() => armSleepTimer({ kind: "minutes", minutes: 15 }));
    usePlayerStore.setState({ status: "paused" });
    advance(5 * MINUTE);
    expect(useSleepStore.getState().remainingMs).toBe(10 * MINUTE);
    advance(10 * MINUTE);
    expect(pause).toHaveBeenCalledTimes(1);
  });

  it("stops at the end of the armed track", () => {
    act(() => armSleepTimer({ kind: "end_of_track" }));
    usePlayerStore.setState({ positionMs: 90_000 });
    advance(1_000);
    expect(pause).not.toHaveBeenCalled();
    expect(lastFade()).toBeCloseTo(0.333, 2);

    usePlayerStore.setState({ positionMs: 99_500 });
    advance(1_000);
    expect(pause).toHaveBeenCalledTimes(1);
  });

  it("moves an end-of-track timer to the track a skip lands on", () => {
    act(() => armSleepTimer({ kind: "end_of_track" }));
    usePlayerStore.setState({ currentTrack: TRACK_2 as never, positionMs: 0 });
    advance(1_000);
    expect(pause).not.toHaveBeenCalled();
    expect(useSleepStore.getState().trackId).toBe("t2");

    usePlayerStore.setState({ positionMs: 99_500 });
    advance(1_000);
    expect(pause).toHaveBeenCalledTimes(1);
  });

  it("waits for the last queue item when armed for end of queue", () => {
    act(() => armSleepTimer({ kind: "end_of_queue" }));
    usePlayerStore.setState({ positionMs: 99_500 });
    advance(1_000);
    expect(pause).not.toHaveBeenCalled();

    usePlayerStore.setState({ currentIndex: 1 });
    advance(1_000);
    expect(pause).toHaveBeenCalledTimes(1);
  });

  it("runs no timers when disarmed and restores the volume on cancel", () => {
    expect(vi.getTimerCount()).toBe(0);
    act(() => armSleepTimer({ kind: "minutes", minutes: 15 }));
    advance(14 * MINUTE + 40_000);
    expect(lastFade()).toBeLessThan(1);
    act(() => cancelSleepTimer());
    expect(lastFade()).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("exposes the armed target and remaining time to the UI", () => {
    const seen: { current: ReturnType<typeof useSleepTimer> | null } = { current: null };
    const Probe = () => {
      const state = useSleepTimer();
      useEffect(() => {
        seen.current = state;
      });
      return null;
    };
    act(() => createRoot(document.createElement("div")).render(createElement(Probe)));
    expect(seen.current!.target).toBeNull();
    act(() => armSleepTimer({ kind: "minutes", minutes: 30 }));
    expect(seen.current!.target).toEqual({ kind: "minutes", minutes: 30 });
    expect(formatSleepClock(seen.current!.remainingMs!)).toBe("30:00");
  });
});
