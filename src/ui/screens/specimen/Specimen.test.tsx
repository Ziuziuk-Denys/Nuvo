// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { Specimen } from "./Specimen";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const setPreset = vi.hoisted(() => vi.fn());
const setMode = vi.hoisted(() => vi.fn());

vi.mock("../../ports/theme", () => ({
  PRESETS: [
    { id: "nuvo", modes: ["light", "dark"] },
    { id: "amber", modes: ["light", "dark"] },
  ],
  useLook: () => ({ preset: "nuvo", mode: "dark" }),
  useThemeMode: () => "dark",
  useSetThemeMode: () => setMode,
}));
vi.mock("../../ports/settings", () => ({
  useCustomizationStore: (select: (s: { setPreset: typeof setPreset }) => unknown) => select({ setPreset }),
}));
vi.mock("../../ports/backdrop", () => ({ usePageBackdrop: vi.fn() }));
vi.mock("../../ports/covers", () => ({
  coverSrc: (src: string) => src,
}));
vi.mock("../../ports/i18n", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  window.matchMedia ??= (query: string) =>
    ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }) as unknown as MediaQueryList;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("Specimen", () => {
  it("renders the five sections and the nine colour swatches", () => {
    act(() => root.render(<Specimen />));
    const titles = [...host.querySelectorAll("h2")].map((node) => node.textContent);
    expect(titles).toEqual(expect.arrayContaining(["Type", "Colour", "Bloom", "Controls", "Motion"]));
    expect(host.querySelectorAll("[data-swatch]")).toHaveLength(9);
  });

  it("switches the preset and the mode through the ports", () => {
    act(() => root.render(<Specimen />));
    const button = (name: string) => [...host.querySelectorAll("button")].find((node) => node.textContent === name)!;
    act(() => button("Amber").click());
    expect(setPreset).toHaveBeenCalledWith("amber");
    act(() => button("Light").click());
    expect(setMode).toHaveBeenCalledWith("light");
  });
});
