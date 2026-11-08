// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { type Root, createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { DEFAULT_APPEARANCE, useAppearanceStore, type Appearance, type AppearancePatch } from "../../ports/appearance";
import { useCustomizationStore } from "../../ports/settings";
import { CustomCssBlock, ResetAppearanceRow } from "./CustomCssBlock";
import { resetCustomization } from "./CustomizationSection";
import { FontsGroup } from "./FontsGroup";
import { SafeModeBanner } from "./SafeModeBanner";
import { ThemeEditorHost } from "./ThemeEditor";
import { ThemeLibrary } from "./ThemeLibrary";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  mode: "light" as "light" | "dark",
  patches: [] as unknown[],
  closeSettings: () => undefined as void,
  openSettingsSection: (_section: string) => undefined as void,
  settingsOpen: false,
}));

vi.mock("../../ports/i18n", () => ({
  useTranslation: () => ({ t: (key: string, params?: Record<string, unknown>) => (params ? `${key} ${Object.values(params).join(" ")}` : key) }),
  getTranslationsForAllLocales: (key: string) => [key],
}));
vi.mock("../../ports/theme", async (importActual) => ({
  ...(await importActual<typeof import("../../ports/theme")>()),
  useLook: () => ({ preset: "nuvo", mode: mocks.mode }),
  useSetThemeMode: () => (m: "light" | "dark") => void (mocks.mode = m),
}));
vi.mock("../../ports/navigation", () => {
  const state = {
    get settingsOpen() {
      return mocks.settingsOpen;
    },
    closeSettings: () => mocks.closeSettings(),
    openSettingsSection: (section: string) => mocks.openSettingsSection(section),
  };
  return { useModalStore: Object.assign((select: (s: typeof state) => unknown) => select(state), { getState: () => state }) };
});
vi.mock("@/data/core/request", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  coreRequest: async (method: string, _path: string, patch?: AppearancePatch): Promise<Appearance> => {
    if (method === "GET") return DEFAULT_APPEARANCE;
    mocks.patches.push(patch!);
    return { ...useAppearanceStore.getState().saved, ...patch };
  },
}));

let host: HTMLDivElement;
let root: Root;
const shell = {
  importThemeFile: vi.fn(),
  exportTheme: vi.fn(async (_name: string, _text: string) => true),
  getMainSettings: vi.fn(),
  setMainSetting: vi.fn(async () => ({ ok: true })),
  listSystemFonts: vi.fn(async () => ({ ok: true, families: ["Noto Sans", "Inter"] })),
  importFontFile: vi.fn(),
  deleteFontFile: vi.fn(async () => true),
};

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  mocks.mode = "light";
  mocks.patches = [];
  mocks.settingsOpen = false;
  mocks.closeSettings = vi.fn();
  mocks.openSettingsSection = vi.fn();
  useAppearanceStore.setState({ saved: DEFAULT_APPEARANCE, safe: false, draft: null, loaded: true });
  (window as unknown as { nuvoShell: unknown }).nuvoShell = shell;
});

afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
});

const render = (node: ReactNode) => act(() => root.render(node));
const button = (text: string) => [...document.querySelectorAll("button")].find((b) => b.textContent?.trim().startsWith(text))!;
const loadButtons = () => [...document.querySelectorAll("button")].filter((b) => b.textContent?.trim() === "appearance.fonts.load_file");
const click = async (text: string) => act(async () => button(text).click());
const withEditor = () =>
  render(
    <>
      <ThemeLibrary />
      <ThemeEditorHost />
    </>,
  );

describe("theme editor", () => {
  it("New theme from this leaves Settings for the live app, shows nine roles, and Save stores and activates the theme", async () => {
    withEditor();
    await click("appearance.theme.new_from");
    expect(mocks.closeSettings).toHaveBeenCalled();
    expect(document.querySelector("aside[aria-label='appearance.editor.label']")).not.toBeNull();
    expect(document.querySelectorAll("aside button[aria-label^='appearance.editor.edit_role']")).toHaveLength(9);
    await click("appearance.editor.save");
    const patch = mocks.patches[0] as AppearancePatch;
    expect(patch.themes).toHaveLength(1);
    expect(patch.active?.presetId).toBe(`custom:${patch.themes![0].id}`);
    expect(useAppearanceStore.getState().draft).toBeNull();
    expect(document.querySelector("aside[aria-label='appearance.editor.label']")).toBeNull();
    expect(mocks.openSettingsSection).toHaveBeenCalledWith("appearance");
  });

  it("Escape closes the sheet, keeps the draft and Settings offers it again", async () => {
    withEditor();
    await click("appearance.theme.new_from");
    await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(document.querySelector("aside[aria-label='appearance.editor.label']")).toBeNull();
    expect(useAppearanceStore.getState().draft).not.toBeNull();
    expect(document.body.textContent).toContain("appearance.theme.unsaved");
    await click("appearance.theme.open_draft");
    expect(document.querySelector("aside[aria-label='appearance.editor.label']")).not.toBeNull();
  });

  it("unreadable text blocks Save; a warning alone does not", async () => {
    withEditor();
    await click("appearance.theme.new_from");
    const draft = useAppearanceStore.getState().draft!;
    act(() => useAppearanceStore.getState().setDraft({ ...draft, modes: { light: { ...draft.modes.light!, ink: draft.modes.light!.field } } }));
    expect(button("appearance.editor.save").disabled).toBe(true);
    expect(document.body.textContent).toContain("appearance.contrast.blocked");
    // the sheet keeps text it can show, so the warning and Fix for me stay readable
    const sheetInk = document.querySelector<HTMLElement>("aside")!.style.getPropertyValue("--n-ink");
    expect(sheetInk).not.toBe("");
    expect(sheetInk).not.toBe(draft.modes.light!.field);
    act(() => useAppearanceStore.getState().setDraft({ ...draft, modes: { light: { ...draft.modes.light!, ink: "#8f8a99" } } }));
    expect(button("appearance.editor.save").disabled).toBe(false);
    expect(document.body.textContent).toContain("appearance.contrast.warn");
  });

  it("Fix for me makes the warned colour pass", async () => {
    withEditor();
    await click("appearance.theme.new_from");
    const draft = useAppearanceStore.getState().draft!;
    act(() => useAppearanceStore.getState().setDraft({ ...draft, modes: { light: { ...draft.modes.light!, ink: "#8f8a99" } } }));
    await click("appearance.contrast.fix");
    expect(useAppearanceStore.getState().draft!.modes.light!.ink).not.toBe("#8f8a99");
    expect(document.body.textContent).not.toContain("appearance.contrast.warn");
  });

  it("a refused save keeps the draft open with a message", async () => {
    withEditor();
    await click("appearance.theme.new_from");
    const draft = useAppearanceStore.getState().draft;
    const save = useAppearanceStore.getState().save;
    useAppearanceStore.setState({ save: async () => false });
    await click("appearance.editor.save");
    expect(useAppearanceStore.getState().draft).toBe(draft);
    expect(document.body.textContent).toContain("appearance.errors.save_failed");
    useAppearanceStore.setState({ save });
  });
});

describe("saved themes", () => {
  it("an imported theme with CSS shows the CSS and turns it on only on request", async () => {
    const file = {
      format: "nuvo-theme",
      version: 1,
      id: "x1",
      name: "Shared",
      modes: {
        dark: {
          field: "#101010",
          deep: "#000000",
          raised: "#1a1a1a",
          ink: "#f0f0f0",
          ink2: "rgba(240,240,240,0.7)",
          ink3: "rgba(240,240,240,0.56)",
          hair: "rgba(240,240,240,0.1)",
          tint: "rgba(240,240,240,0.06)",
          accent: "#4a9eff",
        },
      },
      defaultMode: "dark",
      css: ".x { color: red }",
    };
    shell.importThemeFile.mockResolvedValueOnce({ ok: true, text: JSON.stringify(file) });
    withEditor();
    await click("appearance.theme.import");
    expect(document.querySelector("pre")?.textContent).toBe(".x { color: red }");
    expect(mocks.patches).toEqual([]);
    expect(document.querySelector("aside[aria-label='appearance.editor.label']")).toBeNull();
    await click("appearance.theme.colours_and_css");
    expect(mocks.patches[0]).toEqual({ customCss: { enabled: true, text: "/* Shared */\n.x { color: red }" } });
    expect(useAppearanceStore.getState().draft?.name).toBe("Shared");
    expect(document.querySelector("aside[aria-label='appearance.editor.label']")).not.toBeNull();
  });

  it("a saved theme is a tile; picking it activates it, export carries CSS only when asked", async () => {
    const theme = {
      format: "nuvo-theme" as const,
      version: 1 as const,
      id: "t1",
      name: "Dusk",
      modes: {
        dark: {
          field: "#101010",
          deep: "#000000",
          raised: "#1a1a1a",
          ink: "#f0f0f0",
          ink2: "rgba(240,240,240,0.7)",
          ink3: "rgba(240,240,240,0.56)",
          hair: "rgba(240,240,240,0.1)",
          tint: "rgba(240,240,240,0.06)",
          accent: "#4a9eff",
        },
      },
      defaultMode: "dark" as const,
    };
    useAppearanceStore.setState({ saved: { ...DEFAULT_APPEARANCE, themes: [theme], customCss: { enabled: true, text: "a{}" } } });
    withEditor();
    await click("Dusk");
    expect(mocks.patches[0]).toEqual({ active: { presetId: "custom:t1" } });
    await click("appearance.theme.export");
    expect(JSON.parse(shell.exportTheme.mock.calls[0][1]).css).toBeUndefined();
    await act(async () => document.querySelector<HTMLButtonElement>("button[role=switch][aria-label='appearance.theme.export_css']")!.click());
    await click("appearance.theme.export");
    expect(JSON.parse(shell.exportTheme.mock.calls[1][1]).css).toBe("a{}");
  });
});

describe("custom CSS and safe mode", () => {
  it("Apply refuses fetching CSS with its line and saves clean CSS", async () => {
    render(<CustomCssBlock />);
    await click("appearance.css.show");
    const area = document.querySelector("textarea")!;
    const type = (text: string) =>
      act(() => {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(area, text);
        area.dispatchEvent(new Event("input", { bubbles: true }));
      });
    type("a { color: red }\nbody { background: url(https://example.org/x.png) }");
    await click("appearance.css.apply");
    expect(document.body.textContent).toContain("appearance.css.line 2 appearance.css_errors.fetch");
    expect(mocks.patches).toEqual([]);
    type("a { color: red }");
    await click("appearance.css.apply");
    expect(mocks.patches).toEqual([{ customCss: { enabled: true, text: "a { color: red }" } }]);
  });

  it("Reset appearance is guarded and turns safe mode on", async () => {
    render(<ResetAppearanceRow />);
    const reset = button("appearance.safe.reset");
    expect(reset.hasAttribute("data-nuvo-guard")).toBe(true);
    await click("appearance.safe.reset");
    expect(shell.setMainSetting).toHaveBeenCalledWith("appearance", { safe: true });
    expect(useAppearanceStore.getState().safe).toBe(true);
  });

  it("the safe-mode banner shows only with something custom saved and turns it back on", async () => {
    useAppearanceStore.setState({ safe: true });
    render(<SafeModeBanner />);
    expect(document.querySelector("[role=status]")).toBeNull();
    act(() => useAppearanceStore.setState({ saved: { ...DEFAULT_APPEARANCE, customCss: { enabled: true, text: "a{}" } } }));
    expect(document.querySelector("[role=status][data-nuvo-guard]")).not.toBeNull();
    await click("appearance.safe.edit");
    expect(mocks.openSettingsSection).toHaveBeenCalledWith("customization");
    await click("appearance.safe.turn_on");
    expect(shell.setMainSetting).toHaveBeenCalledWith("appearance", { safe: false });
    expect(useAppearanceStore.getState().safe).toBe(false);
  });

  it("the safe-mode banner stays off Settings, which says the same in its reset row", () => {
    useAppearanceStore.setState({ safe: true, saved: { ...DEFAULT_APPEARANCE, customCss: { enabled: true, text: "a{}" } } });
    mocks.settingsOpen = true;
    render(<SafeModeBanner />);
    expect(document.querySelector("[role=status]")).toBeNull();
  });

  it("Reset customization turns off everything it names and keeps what was typed", async () => {
    const theme = { format: "nuvo-theme" as const, version: 1 as const, id: "t1", name: "Mine", modes: {}, defaultMode: "dark" as const };
    useAppearanceStore.setState({
      safe: true,
      saved: {
        ...DEFAULT_APPEARANCE,
        themes: [theme],
        active: { presetId: "custom:t1" },
        fonts: { ...DEFAULT_APPEARANCE.fonts, ui: { kind: "system", family: "Inter" } },
        customCss: { enabled: true, text: "a { color: red }" },
      },
    });
    useCustomizationStore.setState({ preset: "vinyl", backgroundImage: "data:image/png;base64,AA==", backgroundDim: 40 });
    await act(() => resetCustomization());
    expect(useCustomizationStore.getState()).toMatchObject({ preset: "nuvo", backgroundImage: null, backgroundDim: 0 });
    const saved = useAppearanceStore.getState().saved;
    expect(saved.active.presetId).toBe("nuvo");
    expect(saved.customCss).toEqual({ enabled: false, text: "a { color: red }" });
    expect(saved.fonts).toEqual(DEFAULT_APPEARANCE.fonts);
    expect(saved.themes).toEqual([theme]);
    expect(useAppearanceStore.getState().safe).toBe(false);
  });
});

describe("fonts", () => {
  it("an uninstalled system font shows the note; a font file in use cannot be deleted", async () => {
    const file = { id: "a".repeat(64), family: "My Font", format: "woff2" as const, bytes: 10, addedAt: 1 };
    useAppearanceStore.setState({
      saved: {
        ...DEFAULT_APPEARANCE,
        fonts: { ...DEFAULT_APPEARANCE.fonts, ui: { kind: "system", family: "Gone Sans" }, lyrics: { kind: "file", id: file.id } },
        fontFiles: [file],
      },
    });
    render(<FontsGroup />);
    await act(async () => undefined);
    expect(document.body.textContent).toContain("appearance.fonts.missing");
    const remove = document.querySelector<HTMLButtonElement>("button[aria-label='appearance.fonts.delete My Font']")!;
    expect(remove.disabled).toBe(true);
  });

  it("a loaded font file becomes the chosen font of its row", async () => {
    const file = { id: "b".repeat(64), family: "Loaded", format: "ttf" as const, bytes: 10, addedAt: 1 };
    shell.importFontFile.mockResolvedValueOnce({ ok: true, file });
    render(<FontsGroup />);
    await act(async () => undefined);
    await act(async () => loadButtons()[1].click());
    expect(mocks.patches[0]).toEqual({ fontFiles: [file], fonts: { ...DEFAULT_APPEARANCE.fonts, lyrics: { kind: "file", id: file.id } } });
  });

  it("a refused font file shows its reason", async () => {
    shell.importFontFile.mockResolvedValueOnce({ ok: false, error: "limit" });
    render(<FontsGroup />);
    await act(async () => undefined);
    await act(async () => loadButtons()[0].click());
    expect(document.body.textContent).toContain("appearance.fonts.errors.limit");
    expect(mocks.patches).toEqual([]);
  });
});
