// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { placeHandle, TrimSheetHost, useTrimSheet } from "./TrimSheet";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({ save: vi.fn(async () => undefined), clear: vi.fn(async () => undefined), trims: {} as Record<string, unknown> }));
vi.mock("../ports/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("../ports/escape", () => ({ isEscapeGuarded: () => false }));
vi.mock("../ports/library", () => ({
  MIN_TRIM_MS: 5000,
  saveTrim: mocks.save,
  clearTrim: mocks.clear,
  useTrims: (select: (state: { byTrack: Record<string, unknown> }) => unknown) => select({ byTrack: mocks.trims }),
}));

const song = { id: "t1", title: "Song", artists: "Band", coverUrl: "", durationMs: 200_000 };
let root: Root;

beforeEach(() => {
  root = createRoot(document.body.appendChild(document.createElement("div")));
  act(() => root.render(<TrimSheetHost />));
});
afterEach(() => {
  act(() => useTrimSheet.getState().close());
  act(() => root.unmount());
  document.body.innerHTML = "";
  mocks.trims = {};
  vi.clearAllMocks();
});

const press = (label: string) => act(async () => [...document.querySelectorAll("button")].find((b) => b.textContent === label)!.click());
const knob = (label: string) => document.querySelector<HTMLElement>(`[role="slider"][aria-label="${label}"]`)!;
const key = (node: HTMLElement, name: string) => act(() => void node.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true })));

describe("placeHandle", () => {
  it("snaps to whole seconds, stays on the song and keeps five seconds between the handles", () => {
    expect(placeHandle({ start: 0, end: 200_000 }, "start", 30_400, 200_000)).toEqual({ start: 30_000, end: 200_000 });
    expect(placeHandle({ start: 0, end: 20_000 }, "start", 19_000, 200_000)).toEqual({ start: 15_000, end: 20_000 });
    expect(placeHandle({ start: 10_000, end: 200_000 }, "end", 2_000, 200_000)).toEqual({ start: 10_000, end: 15_000 });
    expect(placeHandle({ start: 0, end: 100_000 }, "end", 900_000, 200_000)).toEqual({ start: 0, end: 200_000 });
  });
});

describe("TrimSheet", () => {
  it("moves the handles from the keyboard and saves the kept part", async () => {
    act(() => useTrimSheet.getState().open(song));
    key(knob("ui.trim.start"), "PageUp");
    key(knob("ui.trim.end"), "PageDown");
    expect(knob("ui.trim.start").getAttribute("aria-valuetext")).toBe("0:10");
    expect(knob("ui.trim.end").getAttribute("aria-valuetext")).toBe("3:10");
    await press("ui.trim.save");
    expect(mocks.save).toHaveBeenCalledWith(song, 10_000, 190_000);
    expect(useTrimSheet.getState().track).toBeNull();
  });

  it("opens a saved trim where it was and plays the whole song again on reset", async () => {
    mocks.trims = { t1: { trackId: "t1", startMs: 30_000, endMs: 150_000 } };
    act(() => useTrimSheet.getState().open(song));
    expect(knob("ui.trim.start").getAttribute("aria-valuenow")).toBe("30000");
    await press("ui.trim.reset");
    expect(mocks.clear).toHaveBeenCalledWith("t1");
  });
});
