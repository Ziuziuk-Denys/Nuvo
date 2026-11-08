// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { offlineMode } from "@/engine/offlineMode";
import { OfflineModeRow } from "./OfflineModeRow";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("../../ports/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key }), getTranslationsForAllLocales: (key: string) => [key] }));

afterEach(() => offlineMode.set(false));

describe("OfflineModeRow", () => {
  it("flips the engine's switch and says so calmly", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    act(() => root.render(<OfflineModeRow />));
    const toggle = host.querySelector<HTMLElement>('[role="switch"]')!;
    expect(host.textContent).toContain("ui.settings.offline_mode.description");
    act(() => toggle.click());
    expect(offlineMode.isOn()).toBe(true);
    expect(host.textContent).toContain("ui.settings.offline_mode.on");
    act(() => root.unmount());
    host.remove();
  });
});
