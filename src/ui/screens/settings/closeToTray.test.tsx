// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { CloseToTrayRow, MenuEntryRow } from "./CloseToTrayRow";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../../ports/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key }), getTranslationsForAllLocales: (key: string) => [key] }));

let root: Root;
let host: HTMLDivElement;

function shell(over: Record<string, unknown> = {}) {
  const setMainSetting = vi.fn(async () => ({ ok: true }));
  (window as unknown as { nuvoShell: unknown }).nuvoShell = {
    getTrayStatus: async () => ({ available: true, closeToTray: true }),
    getMainSettings: async () => ({ closeToTray: true }),
    setMainSetting,
    ...over,
  };
  return setMainSetting;
}

async function mount(): Promise<void> {
  await act(async () => root.render(<CloseToTrayRow />));
}

const toggle = () => host.querySelector<HTMLButtonElement>('[role="switch"]');

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  delete (window as unknown as { nuvoShell?: unknown }).nuvoShell;
});

describe("CloseToTrayRow", () => {
  it("shows the stored value and writes a change to main", async () => {
    const setMainSetting = shell();
    await mount();
    expect(toggle()?.getAttribute("aria-checked")).toBe("true");
    await act(async () => toggle()?.click());
    expect(setMainSetting).toHaveBeenCalledWith("closeToTray", false);
    expect(toggle()?.getAttribute("aria-checked")).toBe("false");
  });

  it("is hidden without a tray, so closing always quits", async () => {
    shell({ getTrayStatus: async () => ({ available: false, closeToTray: true }) });
    await mount();
    expect(toggle()).toBeNull();
  });

  it("returns to the old value when main refuses", async () => {
    shell({ setMainSetting: vi.fn(async () => ({ ok: false, error: "closeToTray must be a boolean" })) });
    await mount();
    await act(async () => toggle()?.click());
    expect(toggle()?.getAttribute("aria-checked")).toBe("true");
  });
});

describe("MenuEntryRow", () => {
  it("is shown only where main can write the entry, and writes a change", async () => {
    shell({ getMainSettings: async () => ({ menuEntry: true, menuEntryAvailable: false }) });
    await act(async () => root.render(<MenuEntryRow />));
    expect(toggle()).toBeNull();
    const setMainSetting = shell({ getMainSettings: async () => ({ menuEntry: true, menuEntryAvailable: true }) });
    await act(async () => root.render(<MenuEntryRow key="again" />));
    expect(host.textContent).toContain("ui.settings.menu_entry.title");
    await act(async () => toggle()?.click());
    expect(setMainSetting).toHaveBeenCalledWith("menuEntry", false);
    expect(toggle()?.getAttribute("aria-checked")).toBe("false");
  });
});
