// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DiscordSection, STATUS_POLL_MS } from "./DiscordSection";
import { SECTION_GROUPS } from "./sections";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const system = vi.hoisted(() => ({ readDiscord: vi.fn(), writeDiscord: vi.fn(), readDiscordStatus: vi.fn() }));
vi.mock("../../ports/system", () => system);
vi.mock("../../ports/i18n", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  getTranslationsForAllLocales: (key: string) => [key],
}));

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  system.readDiscordStatus.mockResolvedValue(null);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.clearAllMocks();
});

const toggle = () => host.querySelector<HTMLButtonElement>('[role="switch"]')!;

describe("DiscordSection", () => {
  it("is a section under Integrations", () => {
    expect(SECTION_GROUPS.find((group) => group.labelKey === "settings.groups.integrations")?.ids).toContain("Discord");
  });

  it("shows the switch off by default and writes the choice", async () => {
    system.readDiscord.mockResolvedValue(false);
    system.writeDiscord.mockResolvedValue(true);
    await act(async () => root.render(<DiscordSection />));
    expect(host.textContent).toContain("settings.discord.enabled.description");
    expect(toggle().getAttribute("aria-checked")).toBe("false");
    await act(async () => toggle().click());
    expect(system.writeDiscord).toHaveBeenCalledWith(true);
    expect(toggle().getAttribute("aria-checked")).toBe("true");
  });

  it("puts the switch back when main refuses", async () => {
    system.readDiscord.mockResolvedValue(false);
    system.writeDiscord.mockResolvedValue(false);
    await act(async () => root.render(<DiscordSection />));
    await act(async () => toggle().click());
    expect(toggle().getAttribute("aria-checked")).toBe("false");
  });

  it("shows the connection under the switch while it is on, and asks again", async () => {
    vi.useFakeTimers();
    system.readDiscord.mockResolvedValue(true);
    system.readDiscordStatus.mockResolvedValue({ state: "no_client", message: "Discord is not running" });
    await act(async () => root.render(<DiscordSection />));
    const line = () => host.querySelector('[data-testid="discord-status"]');
    expect(line()?.textContent).toBe("settings.discord.status.no_client");
    expect(line()?.getAttribute("role")).toBe("status");
    system.readDiscordStatus.mockResolvedValue({ state: "connected" });
    await act(async () => vi.advanceTimersByTime(STATUS_POLL_MS));
    expect(line()?.textContent).toBe("settings.discord.status.connected");
    system.writeDiscord.mockResolvedValue(true);
    await act(async () => toggle().click());
    expect(line()).toBeNull();
    const calls = system.readDiscordStatus.mock.calls.length;
    await act(async () => vi.advanceTimersByTime(STATUS_POLL_MS * 3));
    expect(system.readDiscordStatus.mock.calls.length).toBe(calls);
    vi.useRealTimers();
  });

  it("says when this build can't reach Discord at all", async () => {
    system.readDiscord.mockResolvedValue(true);
    system.readDiscordStatus.mockResolvedValue({ state: "off", message: "Discord presence is not configured in this build." });
    await act(async () => root.render(<DiscordSection />));
    expect(host.querySelector('[data-testid="discord-status"]')?.textContent).toBe("settings.discord.status.unavailable");
  });

  it("stays off and disabled outside the app shell", async () => {
    system.readDiscord.mockResolvedValue(null);
    await act(async () => root.render(<DiscordSection />));
    expect(toggle().disabled).toBe(true);
  });
});
