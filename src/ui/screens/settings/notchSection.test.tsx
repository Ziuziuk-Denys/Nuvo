// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NotchSection } from "./NotchSection";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const notch = vi.hoisted(() => {
  const settings = {
    mode: "on",
    expandOn: "hover",
    showLyrics: true,
    pulseOnTrackChange: true,
    display: "follow",
    position: "center",
    edge: "auto",
    offset: 0,
    stacking: "above",
    setSettings: vi.fn(),
  };
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
  notch.settings.setSettings.mockClear();
});

const press = (text: string) => [...document.body.querySelectorAll<HTMLButtonElement>("button, [role='menuitem']")].find((b) => b.textContent === text);
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
    const always = [...host.querySelectorAll("button")].find((button) => button.textContent === "settings.notch.mode_on");
    expect(always?.disabled).toBe(false);
  });

  it("sets the side, the top edge and the gap", async () => {
    notch.getNotchSession.mockResolvedValue({ session: "hyprland", supported: true, panel: null, displays: [] });
    await act(async () => root.render(<NotchSection />));
    act(() => press("settings.notch.position_right")!.click());
    act(() => press("settings.notch.edge_bar")!.click());
    act(() => press('settings.notch.offset_px {"px":"16"}')!.click());
    expect(notch.settings.setSettings.mock.calls).toEqual([[{ position: "right" }], [{ edge: "bar" }], [{ offset: 16 }]]);
  });

  it("offers stacking only where the desktop lets a window choose it", async () => {
    notch.getNotchSession.mockResolvedValue({ session: "hyprland", supported: true, panel: null, displays: [] });
    await act(async () => root.render(<NotchSection />));
    expect(press("settings.notch.stacking_normal")).toBeUndefined();
    act(() => root.unmount());
    root = createRoot(host);
    notch.getNotchSession.mockResolvedValue({ session: "windows", supported: true, panel: null, displays: [] });
    await act(async () => root.render(<NotchSection />));
    act(() => press("settings.notch.stacking_normal")!.click());
    expect(notch.settings.setSettings).toHaveBeenCalledWith({ stacking: "normal" });
  });

  it("lists the screens and pins the Notch to one of them", async () => {
    const displays = [
      { id: "1", label: "eDP-1" },
      { id: "2", label: "DP-2" },
    ];
    notch.getNotchSession.mockResolvedValue({ session: "x11", supported: true, panel: null, displays });
    await act(async () => root.render(<NotchSection />));
    await act(async () => press("settings.notch.display_follow")!.click());
    expect(press("eDP-1")).toBeDefined();
    await act(async () => press("DP-2")!.click());
    expect(notch.settings.setSettings).toHaveBeenCalledWith({ display: "2" });
  });
});
