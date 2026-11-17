// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { fullyShown, seenBox, targetElement } from "./targets";

type Rect = { left: number; top: number; width: number; height: number };

function sized<T extends HTMLElement>(element: T, box: Rect): T {
  element.getBoundingClientRect = () => ({ ...box, x: box.left, y: box.top, right: box.left + box.width, bottom: box.top + box.height, toJSON: () => box });
  return element;
}

function place(attribute: string, box: Rect, parent: HTMLElement = document.body): HTMLElement {
  const element = sized(document.createElement("div"), box);
  element.setAttribute("data-tour", attribute);
  parent.append(element);
  return element;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("targetElement", () => {
  it("finds a hooked control on screen", () => {
    const element = place("queue", { left: 100, top: 700, width: 30, height: 30 });
    expect(targetElement("queue")).toBe(element);
  });

  it("finds the recognize section in the top bar and the sources on its screen", () => {
    const box = { left: 10, top: 100, width: 46, height: 46 };
    const sources = place("recognize-sources", box);
    const section = place("", box);
    section.setAttribute("data-nav", "recognize");
    expect(targetElement("nav-recognize")).toBe(section);
    expect(targetElement("recognize-sources")).toBe(sources);
  });

  it("finds the open palette panel, not other dialogs", () => {
    const box = { left: 280, top: 60, width: 640, height: 300 };
    sized(document.body.appendChild(document.createElement("div")), box).setAttribute("role", "dialog");
    const panel = sized(document.createElement("div"), box);
    panel.setAttribute("role", "dialog");
    panel.append(document.createElement("div"));
    panel.firstElementChild!.setAttribute("role", "listbox");
    document.body.append(panel);
    expect(targetElement("palette")).toBe(panel);
  });

  it("rings like and dislike together, and the cover that opens the lyrics", () => {
    const box = { left: 200, top: 720, width: 70, height: 40 };
    const island = document.createElement("div");
    island.setAttribute("data-island", "");
    const open = sized(document.createElement("button"), box);
    open.append(Object.assign(document.createElement("span"), { textContent: "Song" }));
    open.firstElementChild!.setAttribute("data-island-title", "");
    const rate = sized(document.createElement("span"), box);
    island.append(open, rate);
    document.body.append(island);
    // each button sits in its own tooltip wrapper, so the ring takes the span holding both
    for (const name of ["data-like", "data-dislike"]) {
      const wrapper = document.createElement("span");
      const control = document.createElement("button");
      control.setAttribute(name, "");
      wrapper.append(control);
      rate.append(wrapper);
    }
    expect(targetElement("rate")).toBe(rate);
    expect(targetElement("lyrics")).toBe(open);
  });

  it("treats a control with no size as missing", () => {
    place("queue", { left: 0, top: 0, width: 0, height: 0 });
    expect(targetElement("queue")).toBeNull();
  });

  it("finds a control below the fold, so the tour can scroll to it", () => {
    const element = place("modes", { left: 100, top: innerHeight + 20, width: 300, height: 100 });
    expect(targetElement("modes")).toBe(element);
    expect(fullyShown(element)).toBe(false);
  });

  it("treats a panel that opened mostly past the window edge as off screen", () => {
    const element = place("presets", { left: 100, top: innerHeight - 10, width: 300, height: 600 });
    expect(fullyShown(element)).toBe(false);
  });
});

describe("seenBox", () => {
  it("cuts the target at the list that scrolls it, not only at the window", () => {
    const list = sized(document.createElement("div"), { left: 300, top: 60, width: 600, height: 500 });
    list.style.overflowY = "auto";
    document.body.append(list);
    const element = place("presets", { left: 320, top: -100, width: 560, height: 300 }, list);
    expect(seenBox(element)).toEqual({ x: 320, y: 60, width: 560, height: 140 });
    expect(fullyShown(element)).toBe(false);
  });

  it("has nothing to show once the list scrolled the target away", () => {
    const list = sized(document.createElement("div"), { left: 300, top: 60, width: 600, height: 500 });
    list.style.overflowY = "hidden";
    document.body.append(list);
    const element = place("presets", { left: 320, top: -260, width: 560, height: 300 }, list);
    expect(seenBox(element)).toBeNull();
  });
});
