// @vitest-environment jsdom
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Icon } from "./Icon";
import { ICON_NAMES, ICON_STROKE } from "./index";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const svg = () => host.querySelector("svg")!;

describe("Icon", () => {
  it.each(ICON_NAMES)("renders %s as an svg with drawn content", (name) => {
    act(() => root.render(<Icon name={name} />));
    expect(svg()).not.toBeNull();
    expect(svg().children.length).toBeGreaterThan(0);
  });

  it("keeps its drawing across re-renders", () => {
    act(() => root.render(<Icon name="play" className="a" />));
    const drawing = svg().firstElementChild;
    act(() => root.render(<Icon name="play" className="b" />));
    expect(svg().firstElementChild).toBe(drawing);
  });

  it("sets width, height and the optical stroke from size", () => {
    act(() => root.render(<Icon name="play" size={16} />));
    expect(svg().getAttribute("width")).toBe("16");
    expect(svg().getAttribute("height")).toBe("16");
    expect(svg().getAttribute("stroke-width")).toBe(String(ICON_STROKE[16]));
  });

  it("defaults to 20 and hides from assistive tech", () => {
    act(() => root.render(<Icon name="search" className="x" />));
    expect(svg().getAttribute("width")).toBe("20");
    expect(svg().getAttribute("aria-hidden")).toBe("true");
    expect(svg().getAttribute("stroke")).toBe("currentColor");
    expect(svg().getAttribute("class")).toBe("x");
  });

  it("gives every masked glyph its own mask id", () => {
    act(() =>
      root.render(
        <>
          <Icon name="library" />
          <Icon name="library" />
        </>,
      ),
    );
    const masks = [...host.querySelectorAll("mask")].map((mask) => mask.id);
    expect(new Set(masks).size).toBe(2);
    for (const svgNode of host.querySelectorAll("svg")) {
      const id = svgNode.querySelector("mask")!.id;
      expect(svgNode.querySelector("[mask]")!.getAttribute("mask")).toBe(`url(#${id})`);
    }
  });
});
