import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import type { IslandMode } from "./geometry";
import { EXPAND_DWELL_MS, HOVER_EXIT_MS, IslandMachine, PULSE_MS } from "./machine";

describe("IslandMachine", () => {
  let modes: IslandMode[];
  let machine: IslandMachine;

  beforeEach(() => {
    vi.useFakeTimers();
    modes = [];
    machine = new IslandMachine((m) => modes.push(m));
  });

  afterEach(() => {
    machine.dispose();
    vi.useRealTimers();
  });

  it("is idle without a track and never expands then", () => {
    expect(machine.mode).toBe("idle");
    machine.pointerEnter();
    vi.advanceTimersByTime(EXPAND_DWELL_MS * 2);
    expect(machine.mode).toBe("hover");
    machine.click();
    expect(machine.mode).toBe("hover");
  });

  it("hover, dwell expands, leaving collapses after the exit delay", () => {
    machine.setTrack(true, false);
    expect(machine.mode).toBe("live");
    machine.pointerEnter();
    expect(machine.mode).toBe("hover");
    vi.advanceTimersByTime(EXPAND_DWELL_MS);
    expect(machine.mode).toBe("expanded");
    machine.pointerLeave();
    vi.advanceTimersByTime(HOVER_EXIT_MS - 1);
    expect(machine.mode).toBe("expanded");
    vi.advanceTimersByTime(1);
    expect(machine.mode).toBe("live");
    expect(modes).toEqual(["live", "hover", "expanded", "live"]);
  });

  it("re-entering before the exit delay keeps it open", () => {
    machine.setTrack(true, false);
    machine.click();
    machine.pointerLeave();
    vi.advanceTimersByTime(HOVER_EXIT_MS / 2);
    machine.pointerEnter();
    vi.advanceTimersByTime(HOVER_EXIT_MS * 2);
    expect(machine.mode).toBe("expanded");
  });

  it("click trigger ignores dwell", () => {
    machine.setTrigger("click");
    machine.setTrack(true, false);
    machine.pointerEnter();
    vi.advanceTimersByTime(EXPAND_DWELL_MS * 3);
    expect(machine.mode).toBe("hover");
    machine.click();
    expect(machine.mode).toBe("expanded");
  });

  it("a track change pulses to hover size and returns", () => {
    machine.setTrack(true, true);
    expect(machine.mode).toBe("hover");
    vi.advanceTimersByTime(PULSE_MS);
    expect(machine.mode).toBe("live");
  });

  it("holding the scrubber prevents collapse until released outside", () => {
    machine.setTrack(true, false);
    machine.click();
    machine.hold(true);
    machine.pointerLeave();
    vi.advanceTimersByTime(HOVER_EXIT_MS * 5);
    expect(machine.mode).toBe("expanded");
    machine.hold(false);
    expect(machine.mode).toBe("live");
  });

  it("losing the track collapses to idle", () => {
    machine.setTrack(true, false);
    machine.click();
    machine.setTrack(false, true);
    expect(machine.mode).toBe("idle");
  });

  it("losing the track during the dwell never expands", () => {
    machine.setTrack(true, false);
    machine.pointerEnter();
    expect(machine.mode).toBe("hover");
    vi.advanceTimersByTime(EXPAND_DWELL_MS / 2);
    machine.setTrack(false, true);
    expect(machine.mode).toBe("idle");
    vi.advanceTimersByTime(EXPAND_DWELL_MS);
    expect(machine.mode).toBe("idle");
  });

  it("losing the track during a pulse returns to idle at once", () => {
    machine.setTrack(true, true);
    expect(machine.mode).toBe("hover");
    vi.advanceTimersByTime(PULSE_MS / 2);
    machine.setTrack(false, true);
    expect(machine.mode).toBe("idle");
  });

  it("switching to click cancels a pending dwell", () => {
    machine.setTrack(true, false);
    machine.pointerEnter();
    expect(machine.mode).toBe("hover");
    vi.advanceTimersByTime(EXPAND_DWELL_MS / 2);
    machine.setTrigger("click");
    vi.advanceTimersByTime(EXPAND_DWELL_MS);
    expect(machine.mode).toBe("hover");
    machine.click();
    expect(machine.mode).toBe("expanded");
  });

  it("no timers after dispose", () => {
    machine.setTrack(true, true);
    vi.advanceTimersByTime(PULSE_MS / 2);
    machine.dispose();
    const beforeDispose = modes.length;
    vi.advanceTimersByTime(PULSE_MS);
    machine.pointerEnter();
    vi.advanceTimersByTime(EXPAND_DWELL_MS * 2);
    expect(modes.length).toBe(beforeDispose);
    expect(machine.mode).toBe("idle");
  });
});
