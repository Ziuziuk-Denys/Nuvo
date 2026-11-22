// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { strongHardware, useEffectsMark, useEffectsStore, useVisualQuality } from "./effects";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  act(() => useEffectsStore.setState({ reduce: false, fps: 15 }));
  localStorage.clear();
});

describe("effects", () => {
  it("keeps the switch and the frame rate, and marks the document while effects are reduced", () => {
    let reduced: boolean | null = null;
    function Probe() {
      reduced = useEffectsMark();
      return null;
    }
    const root = createRoot(document.body.appendChild(document.createElement("div")));
    act(() => root.render(<Probe />));
    expect(reduced).toBe(false);
    expect(document.documentElement.hasAttribute("data-reduce-effects")).toBe(false);
    act(() => useEffectsStore.getState().setReduce(true));
    act(() => useEffectsStore.getState().setFps(30));
    expect(reduced).toBe(true);
    expect(document.documentElement.hasAttribute("data-reduce-effects")).toBe(true);
    expect(JSON.parse(localStorage.getItem("nuvo.effects")!)).toEqual({ reduce: true, fps: 30, look: "auto", lookAsked: false });
    act(() => root.unmount());
  });
});

describe("visual quality", () => {
  it("a chosen look wins, Auto follows the hardware, and choosing counts as asked", () => {
    const quality = { current: "" };
    function Probe() {
      quality.current = useVisualQuality();
      return null;
    }
    const root = createRoot(document.createElement("div"));
    act(() => useEffectsStore.getState().setLook("performance"));
    act(() => root.render(<Probe />));
    expect(quality.current).toBe("performance");
    expect(useEffectsStore.getState().lookAsked).toBe(true);
    act(() => useEffectsStore.getState().setLook("visuals"));
    expect(quality.current).toBe("visuals");
    act(() => useEffectsStore.getState().setLook("auto"));
    expect(quality.current).toBe(strongHardware() ? "visuals" : "performance");
    act(() => root.unmount());
  });
});
