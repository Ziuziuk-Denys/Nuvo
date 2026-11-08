// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PanelWidgetRow } from "./PanelWidgetRow";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const notch = vi.hoisted(() => ({ installPanelWidget: vi.fn(), enablePanelWidget: vi.fn(), openExtensionsApp: vi.fn() }));
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
  vi.clearAllMocks();
});

const button = () => host.querySelector<HTMLButtonElement>('[data-testid="panel-install"]')!;
const note = () => host.querySelector('[data-testid="panel-note"]')?.textContent ?? null;
const byId = (id: string) => host.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`);

describe("PanelWidgetRow", () => {
  it("offers the GNOME extension instead of the Notch and installs only on the click", async () => {
    notch.installPanelWidget.mockResolvedValue({ ok: true, next: "relogin" });
    await act(async () => root.render(<PanelWidgetRow panel={{ target: "gnome", available: true }} instead />));
    expect(host.textContent).toContain("settings.notch.panel_instead");
    expect(host.textContent).toContain("settings.notch.panel_gnome");
    expect(notch.installPanelWidget).not.toHaveBeenCalled();
    await act(async () => button().click());
    expect(notch.installPanelWidget).toHaveBeenCalledOnce();
    expect(note()).toBe("settings.notch.panel_relogin");
  });

  it("GNOME: after an install that needs a login, Turn on only enables and the Extensions app opens on request", async () => {
    notch.installPanelWidget.mockResolvedValue({ ok: true, next: "relogin" });
    notch.enablePanelWidget.mockResolvedValueOnce({ ok: true, next: "relogin" }).mockResolvedValueOnce({ ok: true, next: "ready" });
    notch.openExtensionsApp.mockResolvedValue(true);
    await act(async () => root.render(<PanelWidgetRow panel={{ target: "gnome", available: true }} instead={false} />));
    expect(byId("panel-turn-on")).toBeNull();
    await act(async () => button().click());
    await act(async () => byId("panel-open-extensions")!.click());
    expect(notch.openExtensionsApp).toHaveBeenCalledOnce();
    await act(async () => byId("panel-turn-on")!.click());
    expect(note()).toBe("settings.notch.panel_not_loaded");
    await act(async () => byId("panel-turn-on")!.click());
    expect(notch.enablePanelWidget).toHaveBeenCalledTimes(2);
    expect(notch.installPanelWidget).toHaveBeenCalledOnce();
    expect(note()).toBe("settings.notch.panel_ready");
    expect(byId("panel-turn-on")).toBeNull();
  });

  it("GNOME: a pending install from before the login shows Turn on at start", async () => {
    await act(async () => root.render(<PanelWidgetRow panel={{ target: "gnome", available: true, pendingEnable: true }} instead />));
    expect(note()).toBe("settings.notch.panel_relogin");
    expect(byId("panel-turn-on")).not.toBeNull();
  });

  it("a profile with moved folders shows the manual steps and no install button", async () => {
    await act(async () =>
      root.render(<PanelWidgetRow panel={{ target: "gnome", available: true, manual: true, source: "/r/nuvo.zip", pendingEnable: true }} instead />),
    );
    expect(button()).toBeNull();
    expect(byId("panel-turn-on")).toBeNull();
    expect(note()).toBe('settings.notch.panel_manual_gnome {"path":"/r/nuvo.zip"}');
  });

  it("Waybar: says where the files went and copies the module only on its own button", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    notch.installPanelWidget.mockResolvedValue({ ok: true, next: "add-module", snippet: "{ snippet }" });
    await act(async () => root.render(<PanelWidgetRow panel={{ target: "waybar", available: true }} instead={false} />));
    expect(host.textContent).toContain("settings.notch.panel_set_up");
    await act(async () => button().click());
    expect(note()).toContain("settings.notch.panel_add_module");
    expect(writeText).not.toHaveBeenCalled();
    await act(async () => byId("panel-copy-module")!.click());
    expect(writeText).toHaveBeenCalledWith("{ snippet }");
  });

  it("explains a build without the files and a missing tool", async () => {
    await act(async () => root.render(<PanelWidgetRow panel={{ target: "plasma", available: false }} instead={false} />));
    expect(button().disabled).toBe(true);
    expect(note()).toBe("settings.notch.panel_missing_files");
    notch.installPanelWidget.mockResolvedValue({ ok: false, error: "missing-tool" });
    await act(async () => root.render(<PanelWidgetRow panel={{ target: "plasma", available: true }} instead={false} />));
    await act(async () => button().click());
    expect(note()).toBe("settings.notch.panel_missing_tool");
  });
});
