// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { getPreset } from "./presets";
import { useLookStore } from "./lookStore";
import { useLookSync } from "./useLookSync";
import { useAppearanceStore } from "@/data/look/appearance/appearanceStore";
import { SAMPLE } from "@/data/look/appearance/sampleTheme";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const theme = vi.hoisted(() => ({ choice: "dark" as string, resolved: "dark" as string, setTheme: vi.fn() }));
vi.mock("next-themes", () => ({ useTheme: () => ({ theme: theme.choice, resolvedTheme: theme.resolved, setTheme: theme.setTheme }) }));

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
    act(() => useLookStore.setState({ preset: "frost", coverGlow: false }));
    expect(document.documentElement.dataset.preset).toBe("frost");
    expect(rootStyle("--n-field")).toBe(getPreset("frost").tokens.dark!["n-field"]);
    expect(document.documentElement.dataset.coverGlow).toBe("off");
  });

  it("the mode a retired one-mode preset replaced comes back once, and no preset forces a mode", () => {
    useLookStore.setState({ preset: "amber", themeBeforePreset: "light" });
    act(() => root.render(<Probe />));
    expect(theme.setTheme).toHaveBeenCalledWith("light");
    expect(useLookStore.getState().themeBeforePreset).toBeNull();
    theme.setTheme.mockClear();
    act(() => useLookStore.setState({ preset: "ink" }));
    expect(theme.setTheme).not.toHaveBeenCalled();
  });

  it("a custom theme replaces the preset's tokens and never forces a mode", () => {
    useLookStore.setState({ preset: "frost", themeBeforePreset: "dark" });
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
