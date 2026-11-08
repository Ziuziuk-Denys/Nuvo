import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { PAUSE_PATH, PLAY_PATH, MorphPlayIcon } from "./MorphPlayIcon";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("MorphPlayIcon", () => {
  it("both glyphs share one command structure, so the path can morph", () => {
    const shape = (d: string) => d.replace(/[\d.\s-]+/g, " ").trim();
    expect(shape(PLAY_PATH)).toBe(shape(PAUSE_PATH));
    expect(PLAY_PATH).not.toBe(PAUSE_PATH);
  });

  it("draws the given glyph at the given size, hidden from assistive tech", () => {
    const host = document.createElement("div");
    const root = createRoot(host);
    act(() => root.render(<MorphPlayIcon playing size={28} />));
    const svg = host.querySelector("svg")!;
    expect(svg.getAttribute("width")).toBe("28");
    expect(svg.getAttribute("height")).toBe("28");
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(host.querySelector("path")!.getAttribute("d")).toBe(PAUSE_PATH);
    act(() => root.render(<MorphPlayIcon playing={false} size={28} />));
    expect(host.querySelector("path")!.getAttribute("d")).toBe(PLAY_PATH);
    act(() => root.unmount());
  });
});
