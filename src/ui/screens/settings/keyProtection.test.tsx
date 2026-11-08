// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KeyProtectionRow } from "./KeyProtectionRow";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const core = vi.hoisted(() => ({ keyStorage: vi.fn(), setKeyPassphrase: vi.fn() }));
vi.mock("../../ports/core", () => ({ coreApi: core }));
vi.mock("../../ports/i18n", () => ({
  useTranslation: () => ({ t: (key: string, vars?: Record<string, unknown>) => (vars ? `${key} ${JSON.stringify(vars)}` : key) }),
  getTranslationsForAllLocales: (key: string) => [key],
}));

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  localStorage.clear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.clearAllMocks();
});

const mount = async () => {
  await act(async () => root.render(<KeyProtectionRow />));
  await act(async () => void (await Promise.resolve()));
};
const button = (text: string) => [...host.querySelectorAll("button")].find((b) => b.textContent === text)!;

describe("KeyProtectionRow", () => {
  it("shows nothing while the system keyring holds the key", async () => {
    core.keyStorage.mockResolvedValue({ protection: "keyring" });
    await mount();
    expect(host.textContent).toBe("");
  });

  it("warns once about a plain key file, then only the quiet line", async () => {
    core.keyStorage.mockResolvedValue({ protection: "file" });
    await mount();
    expect(host.querySelector("[role=alert]")?.textContent).toBe("ui.settings.key.warning");
    expect(host.textContent).toContain("ui.settings.key.file");
    act(() => root.unmount());
    root = createRoot(host);
    await mount();
    expect(host.querySelector("[role=alert]")).toBeNull();
    expect(host.textContent).toContain("ui.settings.key.file");
  });

  it("refuses a short passphrase and seals with a good one", async () => {
    core.keyStorage.mockResolvedValue({ protection: "file" });
    core.setKeyPassphrase.mockResolvedValue({ protection: "passphrase" });
    await mount();
    const field = host.querySelector<HTMLInputElement>('input[type="password"]')!;
    const type = (value: string) =>
      act(() => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value);
        field.dispatchEvent(new Event("input", { bubbles: true }));
      });
    type("short");
    await act(async () => button("ui.settings.key.set").click());
    expect(core.setKeyPassphrase).not.toHaveBeenCalled();
    expect(host.textContent).toContain("ui.settings.key.too_short");
    type("correct horse");
    await act(async () => button("ui.settings.key.set").click());
    expect(core.setKeyPassphrase).toHaveBeenCalledWith("correct horse");
    expect(host.textContent).toContain("ui.settings.key.sealed");
    await act(async () => button("ui.settings.key.remove").click());
    expect(core.setKeyPassphrase).toHaveBeenLastCalledWith(null);
  });
});
