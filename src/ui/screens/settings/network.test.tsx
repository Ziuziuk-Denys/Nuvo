// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { NetworkSection } from "./NetworkSection";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const system = vi.hoisted(() => ({
  readProxy: vi.fn(async (): Promise<{ mode: "system"; inForce?: string | null }> => ({ mode: "system" })),
  onNetworkChanged: vi.fn((_listener: () => void) => () => undefined),
  saveProxy: vi.fn(async (): Promise<{ ok: boolean; error?: string }> => ({ ok: true })),
  runNetworkCheck: vi.fn(async () => ({
    checkedAt: "2026-11-02T10:00:00Z",
    summary: "SoundCloud is blocked on this network.",
    code: "blocked" as string | undefined,
    service: "SoundCloud" as string | undefined,
    rows: [
      { check: "dns", host: "music.youtube.com", ok: true, ms: 12 },
      { check: "https", host: "api-v2.soundcloud.com", ok: false, code: "blocked", ms: 40 },
    ],
  })),
  systemReport: vi.fn(async () => null),
  appFacts: vi.fn(async () => null),
  readTools: vi.fn(async () => null),
}));
vi.mock("../../ports/system", () => system);
vi.mock("../../ports/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key }), getTranslationsForAllLocales: (key: string) => [key] }));

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

const byText = (text: string) => [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === text)!;

function type(input: HTMLInputElement, value: string): void {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("NetworkSection", () => {
  it("runs the connection check and lists every row with its cause", async () => {
    await act(async () => root.render(<NetworkSection />));
    await act(async () => byText("ui.settings.check").click());
    expect(host.textContent).toContain("ui.settings.check_service");
    expect(host.textContent).not.toContain("SoundCloud is blocked on this network.");
    expect(host.textContent).toContain("dns music.youtube.com · ui.settings.check_ok · 12 ms");
    expect(host.textContent).toContain("https api-v2.soundcloud.com · blocked · 40 ms");
  });

  it("says what to do when YouTube is blocked", async () => {
    system.runNetworkCheck.mockResolvedValueOnce({ checkedAt: "", summary: "", code: "blocked", service: "YouTube", rows: [] });
    await act(async () => root.render(<NetworkSection />));
    await act(async () => byText("ui.settings.check").click());
    expect(host.textContent).toContain("ui.network_advice.blocked");
  });

  it("names the three modes and says what the automatic mode found, again when the network changes", async () => {
    system.readProxy.mockResolvedValueOnce({ mode: "system", inForce: null });
    await act(async () => root.render(<NetworkSection />));
    for (const mode of ["system", "none", "manual"]) expect(byText(`ui.settings.proxy.${mode}`)).toBeTruthy();
    expect(host.textContent).toContain("ui.settings.proxy.not_found");
    system.readProxy.mockResolvedValueOnce({ mode: "system", inForce: "socks5://127.0.0.1:2080" });
    await act(async () => system.onNetworkChanged.mock.calls[0][0]());
    expect(host.textContent).toContain("ui.settings.proxy.found");
  });

  it("saves No proxy at once", async () => {
    await act(async () => root.render(<NetworkSection />));
    await act(async () => byText("ui.settings.proxy.none").click());
    expect(system.saveProxy).toHaveBeenCalledWith({ mode: "none" });
  });

  it("says when main refuses a manual address", async () => {
    system.saveProxy.mockResolvedValueOnce({ ok: false, error: "proxy.url is invalid" });
    await act(async () => root.render(<NetworkSection />));
    await act(async () => byText("ui.settings.proxy.manual").click());
    await act(async () => type(host.querySelector("input")!, "http://user:pw@proxy:99999"));
    await act(async () => byText("ui.settings.proxy_save").click());
    expect(system.saveProxy).toHaveBeenCalledWith({ mode: "manual", url: "http://user:pw@proxy:99999" });
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("ui.settings.proxy_refused");
  });

  it("copies the report to the clipboard", async () => {
    const writeText = vi.fn(async (_text: string) => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    system.systemReport.mockResolvedValueOnce({ phase: "ok" } as never);
    await act(async () => root.render(<NetworkSection />));
    await act(async () => byText("ui.settings.report_copy").click());
    expect(writeText.mock.calls[0][0]).toContain('"phase": "ok"');
    expect(byText("ui.settings.report_copied")).toBeTruthy();
  });
});
