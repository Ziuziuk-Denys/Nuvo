// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NotchSection } from "./NotchSection";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const notch = vi.hoisted(() => {
  const settings = { mode: "on", expandOn: "hover", showLyrics: true, pulseOnTrackChange: true, display: "follow", setSettings: () => undefined };
  return { getNotchSession: vi.fn(), installPanelWidget: vi.fn(), useNotchSettingsStore: () => settings, settings };
});
vi.mock("../../ports/notch", () => notch);
vi.mock("../../ports/i18n", () => ({
  useTranslation: () => ({ t: (key: string, values?: Record<string, string>) => (values ? `${key} ${JSON.stringify(values)}` : key) }),
}));

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
  notch.settings.mode = "on";
});

const sessionNote = () => host.querySelector('[data-testid="notch-session"]')?.textContent ?? "";

describe("NotchSection", () => {
  it("says plainly that GNOME on Wayland can't show the Notch and offers the panel widget", async () => {
    notch.getNotchSession.mockResolvedValue({ session: "gnome-wayland", supported: false, panel: { target: "gnome", available: true } });
    await act(async () => root.render(<NotchSection />));
    expect(sessionNote()).toContain('settings.notch.unsupported_here {"desktop":"settings.notch.desktop_gnome"}');
    expect(sessionNote()).toContain("settings.notch.unsupported_on");
    expect(host.querySelector('[data-testid="notch-session"]')!.getAttribute("role")).toBe("status");
    expect(host.textContent).toContain("settings.notch.panel_instead");
  });

  it("leaves Always on out of the note when the mode is Auto, and names a supported session plainly", async () => {
    notch.settings.mode = "auto";
    notch.getNotchSession.mockResolvedValue({ session: "gnome-wayland", supported: false, panel: null });
    await act(async () => root.render(<NotchSection />));
    expect(sessionNote()).not.toContain("settings.notch.unsupported_on");
    notch.getNotchSession.mockResolvedValue({ session: "x11", supported: true, panel: null });
    act(() => root.unmount());
    root = createRoot(host);
    await act(async () => root.render(<NotchSection />));
    expect(sessionNote()).toBe('settings.notch.session {"session":"settings.notch.desktop_x11"}');
    expect(host.textContent).not.toContain("settings.notch.panel_instead");
  });

  it("names Windows and macOS and offers the Notch there", async () => {
    notch.getNotchSession.mockResolvedValue({ session: "windows", supported: true, panel: null });
    await act(async () => root.render(<NotchSection />));
    expect(sessionNote()).toBe('settings.notch.session {"session":"settings.notch.desktop_windows"}');
    expect(host.textContent).toContain("settings.notch.description");
  });
});
