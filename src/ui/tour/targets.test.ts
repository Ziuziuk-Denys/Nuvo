// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { targetElement } from "./targets";

function place(attribute: string, box: { left: number; top: number; width: number; height: number }): HTMLElement {
  const element = document.createElement("div");
  element.setAttribute("data-tour", attribute);
  element.getBoundingClientRect = () => ({ ...box, x: box.left, y: box.top, right: box.left + box.width, bottom: box.top + box.height, toJSON: () => box });
  document.body.append(element);
  return element;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("targetElement", () => {
  it("finds a hooked control on screen", () => {
    const element = place("like", { left: 100, top: 700, width: 30, height: 30 });
    expect(targetElement("like")).toBe(element);
  });

  it("finds the recognize entry on the rail and the sources on its screen", () => {
    const box = { left: 10, top: 100, width: 46, height: 46 };
    const sources = place("recognize-sources", box);
    const rail = place("", box);
    rail.setAttribute("data-nav", "recognize");
    expect(targetElement("rail-recognize")).toBe(rail);
    expect(targetElement("recognize-sources")).toBe(sources);
  });

  it("treats a control with no size as missing", () => {
    place("like", { left: 0, top: 0, width: 0, height: 0 });
    expect(targetElement("like")).toBeNull();
  });

  it("treats a panel that opened mostly past the window edge as missing", () => {
    place("presets", { left: 100, top: innerHeight - 10, width: 300, height: 600 });
    expect(targetElement("presets")).toBeNull();
  });
});
