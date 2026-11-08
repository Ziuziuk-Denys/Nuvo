// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CoreError } from "@/imports/core";
import type { LastfmStatus } from "../../ports/lastfm";
import { LastfmSection } from "./LastfmSection";
import { SECTION_GROUPS } from "./sections";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const status = (patch: Partial<LastfmStatus> = {}): LastfmStatus => ({
  hasCredentials: false,
  connected: false,
  user: null,
  enabled: true,
  queued: 0,
  lastError: null,
  ...patch,
});

const lastfm = vi.hoisted(() => ({
  readLastfm: vi.fn(),
  saveLastfmKeys: vi.fn(),
  setLastfmEnabled: vi.fn(),
  startLastfmAuth: vi.fn(),
  finishLastfmAuth: vi.fn(),
  disconnectLastfm: vi.fn(),
}));
vi.mock("../../ports/lastfm", async (original) => ({ ...(await original<typeof import("../../ports/lastfm")>()), ...lastfm }));
const system = vi.hoisted(() => ({ openExternal: vi.fn() }));
vi.mock("../../ports/system", () => system);
vi.mock("../../ports/i18n", () => ({
  useTranslation: () => ({ t: (key: string, vars?: Record<string, unknown>) => (vars ? `${key} ${JSON.stringify(vars)}` : key) }),
  getTranslationsForAllLocales: (key: string) => [key],
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

const byText = (text: string) => [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === text)!;
const toggle = () => host.querySelector<HTMLButtonElement>('[role="switch"]')!;

function type(input: HTMLInputElement, value: string): void {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("LastfmSection", () => {
  it("is a section of its own under Integrations", () => {
    expect(SECTION_GROUPS.find((group) => group.labelKey === "settings.groups.integrations")?.ids).toContain("Lastfm");
  });

  it("asks for the key first, then saves it and allows Connect", async () => {
    lastfm.readLastfm.mockResolvedValue(status());
    lastfm.saveLastfmKeys.mockResolvedValue(status({ hasCredentials: true }));
    await act(async () => root.render(<LastfmSection />));
    expect(byText("settings.lastfm.connect").disabled).toBe(true);
    expect(toggle().disabled).toBe(true);
    const [key, secret] = host.querySelectorAll("input");
    act(() => type(key, " abc123 "));
    act(() => type(secret, "def456"));
    await act(async () => byText("settings.lastfm.save").click());
    expect(lastfm.saveLastfmKeys).toHaveBeenCalledWith("abc123", "def456");
    expect(byText("settings.lastfm.connect").disabled).toBe(false);
  });

  it("opens the approval page, waits for Done, and shows the account once Last.fm approved", async () => {
    lastfm.readLastfm.mockResolvedValue(status({ hasCredentials: true }));
    lastfm.startLastfmAuth.mockResolvedValue({ token: "tok", authUrl: "https://www.last.fm/api/auth?api_key=k&token=tok" });
    lastfm.finishLastfmAuth
      .mockRejectedValueOnce(new CoreError(409, "CONFLICT"))
      .mockResolvedValueOnce(status({ hasCredentials: true, connected: true, user: "ann" }));
    await act(async () => root.render(<LastfmSection />));
    await act(async () => byText("settings.lastfm.connect").click());
    expect(system.openExternal).toHaveBeenCalledWith("https://www.last.fm/api/auth?api_key=k&token=tok");
    expect(host.textContent).toContain("settings.lastfm.approve_hint");
    await act(async () => byText("settings.lastfm.done").click());
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("settings.lastfm.not_approved");
    await act(async () => byText("settings.lastfm.done").click());
    expect(lastfm.finishLastfmAuth).toHaveBeenLastCalledWith("tok");
    expect(host.textContent).toContain("ann");
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(toggle().disabled).toBe(false);
  });

  it("pauses and resumes scrobbling with the switch, shows the queue, and disconnects", async () => {
    lastfm.readLastfm.mockResolvedValue(status({ hasCredentials: true, connected: true, user: "ann", queued: 3 }));
    lastfm.setLastfmEnabled.mockResolvedValue(status({ hasCredentials: true, connected: true, user: "ann", enabled: false }));
    lastfm.disconnectLastfm.mockResolvedValue(status({ hasCredentials: true }));
    await act(async () => root.render(<LastfmSection />));
    expect(host.textContent).toContain('settings.lastfm.scrobbling · settings.lastfm.queued {"count":3}');
    expect(host.querySelector("input")).toBeNull();
    await act(async () => toggle().click());
    expect(lastfm.setLastfmEnabled).toHaveBeenCalledWith(false);
    expect(host.textContent).toContain("settings.lastfm.paused");
    await act(async () => byText("settings.lastfm.disconnect").click());
    expect(lastfm.disconnectLastfm).toHaveBeenCalled();
    expect(host.textContent).toContain("settings.lastfm.signed_out_title");
  });

  it("tells a refused key from Last.fm out of reach", async () => {
    lastfm.readLastfm.mockRejectedValue(new CoreError(0, "CORE_DOWN"));
    await act(async () => root.render(<LastfmSection />));
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("settings.lastfm.unreachable");
    lastfm.readLastfm.mockResolvedValue(status());
    lastfm.saveLastfmKeys.mockRejectedValue(new CoreError(400, "INVALID"));
    act(() => root.render(<></>));
    await act(async () => root.render(<LastfmSection />));
    const [key, secret] = host.querySelectorAll("input");
    act(() => type(key, "abc"));
    act(() => type(secret, "def"));
    await act(async () => byText("settings.lastfm.save").click());
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("settings.lastfm.refused");
  });
});
