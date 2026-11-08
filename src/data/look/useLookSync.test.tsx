// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { getPreset, PRESETS } from "./presets";
import { useLookStore } from "./lookStore";
import { effectivePreset, modeStep, useLookSync } from "./useLookSync";
import { useAppearanceStore } from "@/data/look/appearance/appearanceStore";
import { SAMPLE } from "@/data/look/appearance/sampleTheme";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const theme = vi.hoisted(() => ({ choice: "dark" as string, resolved: "dark" as string, setTheme: vi.fn() }));
vi.mock("next-themes", () => ({ useTheme: () => ({ theme: theme.choice, resolvedTheme: theme.resolved, setTheme: theme.setTheme }) }));

const lightOnly = PRESETS.find((preset) => preset.modes.length === 1 && preset.modes[0] === "light")!;
const both = getPreset("nuvo");

describe("look rules", () => {
  it("glass turns a light-only preset into nuvo", () => {
    expect(effectivePreset(lightOnly.id, true).id).toBe("nuvo");
    expect(effectivePreset(lightOnly.id, false).id).toBe(lightOnly.id);
    expect(effectivePreset("orbit", true).id).toBe("orbit");
  });

  it("a one-mode preset forces its mode and remembers the old one; a two-mode preset restores it", () => {
    expect(modeStep(lightOnly, "dark", null)).toEqual({ setTheme: "light", before: "dark" });
    expect(modeStep(lightOnly, "light", "dark")).toEqual({ before: "dark" });
    expect(modeStep(lightOnly, "light", null)).toEqual({ before: null });
    expect(modeStep(both, "light", "dark")).toEqual({ setTheme: "dark", before: null });
    expect(modeStep(both, "system", null)).toEqual({ before: null });
  });
});

let root: Root;

function Probe() {
  useLookSync();
  return null;
}

beforeEach(() => {
  theme.choice = "dark";
  theme.resolved = "dark";
  theme.setTheme.mockClear();
  useLookStore.setState({ preset: "nuvo", coverGlow: true, accentFromCover: false, backgroundImage: null, themeBeforePreset: null });
  useAppearanceStore.setState({ draft: null });
  root = createRoot(document.createElement("div"));
});

afterEach(() => {
  act(() => root.unmount());
  document.documentElement.removeAttribute("style");
  document.documentElement.removeAttribute("data-look");
  document.documentElement.removeAttribute("data-preset");
  document.documentElement.removeAttribute("data-cover-glow");
});

const rootStyle = (name: string) => document.documentElement.style.getPropertyValue(name);

describe("useLookSync", () => {
  it("paints the preset's tokens for the mode and mirrors cover glow, at once on change", () => {
    act(() => root.render(<Probe />));
    expect(rootStyle("--n-field")).toBe(getPreset("nuvo").tokens.dark!["n-field"]);
    expect(document.documentElement.dataset.coverGlow).toBe("on");
    expect(document.documentElement.dataset.preset).toBe("nuvo");
    act(() => useLookStore.setState({ preset: "orbit", coverGlow: false }));
    expect(document.documentElement.dataset.preset).toBe("orbit");
    expect(rootStyle("--n-field")).toBe(getPreset("orbit").tokens.dark!["n-field"]);
    expect(document.documentElement.dataset.coverGlow).toBe("off");
  });

  it("choosing a one-mode preset in the other mode switches the window and remembers the choice", () => {
    theme.choice = "light";
    theme.resolved = "light";
    useLookStore.setState({ preset: "orbit" });
    act(() => root.render(<Probe />));
    expect(theme.setTheme).toHaveBeenCalledWith("dark");
    expect(useLookStore.getState().themeBeforePreset).toBe("light");
  });

  it("a custom theme replaces the preset's tokens and never forces a mode", () => {
    useLookStore.setState({ preset: "orbit" });
    theme.choice = "light";
    theme.resolved = "light";
    useAppearanceStore.setState({ draft: { ...SAMPLE, id: "t1" } as never });
    act(() => root.render(<Probe />));
    expect(document.documentElement.dataset.look).toBe("custom:t1");
    expect(document.documentElement.dataset.preset).toBe("custom:t1");
    expect(theme.setTheme).not.toHaveBeenCalled();
    expect(rootStyle("--n-field")).toBe(SAMPLE.modes.light.field);
  });
});
