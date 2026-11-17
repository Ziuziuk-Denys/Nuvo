// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const player = vi.hoisted(() => ({ repeat: "all" as "off" | "all" | "one" }));

vi.mock("../../ports/player", () => ({
  usePlayerStore: { getState: () => ({ repeat: player.repeat }) },
  playerEngine: { setRepeat: (mode: "off" | "all" | "one") => (player.repeat = mode) },
}));

const { useHoldTrack } = await import("./useHoldTrack");

function Probe() {
  useHoldTrack();
  return null;
}

let root: Root;

beforeEach(() => {
  root = createRoot(document.createElement("div"));
});

afterEach(() => {
  player.repeat = "all";
});

describe("holding the track in the studio", () => {
  it("repeats the song while open and gives the old mode back on close", () => {
    act(() => root.render(<Probe />));
    expect(player.repeat).toBe("one");
    act(() => root.unmount());
    expect(player.repeat).toBe("all");
  });

  it("leaves a repeat-one the owner already had", () => {
    player.repeat = "one";
    act(() => root.render(<Probe />));
    act(() => root.unmount());
    expect(player.repeat).toBe("one");
  });
});
