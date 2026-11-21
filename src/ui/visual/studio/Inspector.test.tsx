// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { partsFor, sceneOf, type Selection } from "../../ports/visual";
import { Inspector } from "./Inspector";

vi.mock("../../ports/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("./usePreview", () => ({ usePreview: () => "" }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;
const onChange = vi.fn();

function show(selection: Selection) {
  const scene = sceneOf(selection);
  const parts = partsFor("lyrics").filter((part) => part.id === selection.lyrics);
  act(() => root.render(<Inspector scene={scene} parts={parts} coverUrl="" onChange={onChange} />));
}

const button = (name: string) => [...host.querySelectorAll("button")].find((element) => element.textContent === name);
const base: Selection = { background: "night", atmosphere: [], centrepiece: null, lyrics: "line" };

beforeEach(() => {
  onChange.mockReset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("text look", () => {
  it("opens the text panel with colour and size first, even for a style with nothing else to tune", () => {
    show(base);
    const labels = [...host.querySelectorAll("span")].map((element) => element.textContent);
    expect(labels.indexOf("visual.text.colour")).toBeGreaterThanOrEqual(0);
    expect(labels.indexOf("visual.text.size")).toBeGreaterThan(labels.indexOf("visual.text.colour"));
    expect(button("visual.text.auto")?.getAttribute("aria-pressed")).toBe("true");
  });

  it("switches to a colour from the cover or a picked one", () => {
    show(base);
    act(() => button("visual.text.cover")!.click());
    expect(onChange).toHaveBeenLastCalledWith({ ...base, text: { size: 1, ink: "cover" } });
    act(() => button("visual.text.custom")!.click());
    const custom = onChange.mock.lastCall![0] as Selection;
    expect(Array.isArray(custom.text?.ink)).toBe(true);
    show(custom);
    const swatches = host.querySelectorAll("[data-ink-swatch]");
    expect(swatches.length).toBeGreaterThan(3);
    act(() => (swatches[2] as HTMLButtonElement).click());
    expect((onChange.mock.lastCall![0] as Selection).text?.ink).not.toEqual(custom.text?.ink);
  });

  it("sets the size in real percent between 70 and 150", () => {
    show(base);
    const field = host.querySelector<HTMLInputElement>('input[aria-label="visual.text.size"]')!;
    expect(field.value).toBe("100");
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    act(() => {
      setter.call(field, "200");
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect((onChange.mock.lastCall![0] as Selection).text?.size).toBeCloseTo(1.5);
  });

  it("offers no colour for wiped glass, whose words show the picture behind", () => {
    show({ ...base, background: "glass", lyrics: "wipe" });
    expect(button("visual.text.auto")).toBeUndefined();
    expect(host.querySelector('input[aria-label="visual.text.size"]')).not.toBeNull();
  });
});
