// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AutoUpdateRow, UpdateStatus } from "./UpdateRows";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../../ports/i18n", () => ({
  useTranslation: () => ({ t: (key: string, vars?: Record<string, string>) => (vars ? `${key}:${vars.version}` : key) }),
  getTranslationsForAllLocales: (key: string) => [key],
}));
vi.mock("../../ports/settings", () => ({ useAppVersion: () => "1.0.0" }));

let root: Root;
let host: HTMLDivElement;

function shell(view: unknown, over: Record<string, unknown> = {}) {
  const calls = {
    check: vi.fn(async () => undefined),
    install: vi.fn(async () => true),
    release: vi.fn(async () => true),
    setMainSetting: vi.fn(async () => ({ ok: true })),
  };
  (window as unknown as { nuvoShell: unknown }).nuvoShell = {
    getUpdateState: async () => view,
    onUpdateState: () => () => undefined,
    checkForUpdate: calls.check,
    installUpdate: calls.install,
    openReleasePage: calls.release,
    getMainSettings: async () => ({ autoUpdate: true }),
    setMainSetting: calls.setMainSetting,
    ...over,
  };
  return calls;
}

const mount = (node: React.ReactElement) => act(async () => root.render(node));

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

describe("UpdateStatus", () => {
  it("shows the download without a button until it is done", async () => {
    shell({ phase: "downloading", mode: "install", version: "1.1.0", percent: 10 });
    await mount(<UpdateStatus />);
    expect(host.querySelector("button")).toBeNull();
    expect(host.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow")).toBe("10");
  });

  it("offers a check before the first one and runs it on click", async () => {
    const calls = shell({ phase: "idle", mode: "install" });
    await mount(<UpdateStatus />);
    expect(host.textContent).toContain("ui.settings.update_check:1.0.0");
    const button = host.querySelector("button");
    expect(button?.textContent).toBe("ui.settings.update_check_now");
    await act(async () => button?.click());
    expect(calls.check).toHaveBeenCalledTimes(1);
  });

  it("disables the button while checking", async () => {
    shell({ phase: "checking", mode: "install" });
    await mount(<UpdateStatus />);
    expect(host.textContent).toContain("ui.settings.update_checking");
    expect(host.querySelector("button")?.disabled).toBe(true);
  });

  it("says the installed version is the latest", async () => {
    shell({ phase: "latest", mode: "notify" });
    await mount(<UpdateStatus />);
    expect(host.textContent).toContain("ui.settings.update_latest:1.0.0");
    expect(host.querySelector("button")?.textContent).toBe("ui.settings.update_check_again");
  });

  it("names a failed check and offers to try again", async () => {
    const calls = shell({ phase: "error", mode: "install" });
    await mount(<UpdateStatus />);
    expect(host.textContent).toContain("ui.settings.update_error");
    expect(host.textContent).toContain("ui.settings.update_error_desc");
    await act(async () => host.querySelector("button")?.click());
    expect(calls.check).toHaveBeenCalledTimes(1);
  });

  it("is empty where updates do not exist", async () => {
    shell({ phase: "off", mode: "off" });
    await mount(<UpdateStatus />);
    expect(host.textContent).toBe("");
  });

  it("offers a restart only after the download, and installs on click", async () => {
    const calls = shell({ phase: "ready", mode: "install", version: "1.1.0" });
    await mount(<UpdateStatus />);
    const button = host.querySelector("button");
    expect(button?.textContent).toBe("ui.settings.update_restart");
    expect(calls.install).not.toHaveBeenCalled();
    await act(async () => button?.click());
    expect(calls.install).toHaveBeenCalledTimes(1);
  });

  it("links to the release page where it cannot install", async () => {
    const calls = shell({ phase: "available", mode: "notify", version: "1.1.0" });
    await mount(<UpdateStatus />);
    expect(host.textContent).toContain("ui.settings.update_available:1.1.0");
    const button = host.querySelector("button");
    expect(button?.textContent).toBe("ui.settings.update_open");
    await act(async () => button?.click());
    expect(calls.release).toHaveBeenCalledTimes(1);
  });
});

describe("AutoUpdateRow", () => {
  it("writes the switch to main", async () => {
    const calls = shell({ phase: "idle", mode: "install" });
    await mount(<AutoUpdateRow />);
    const toggle = host.querySelector<HTMLButtonElement>('[role="switch"]');
    expect(toggle?.getAttribute("aria-checked")).toBe("true");
    await act(async () => toggle?.click());
    expect(calls.setMainSetting).toHaveBeenCalledWith("autoUpdate", false);
  });

  it("promises an install on quit only where Nuvo can install", async () => {
    shell({ phase: "idle", mode: "install" });
    await mount(<AutoUpdateRow />);
    expect(host.textContent).toContain("ui.settings.auto_update.description");
    expect(host.textContent).not.toContain("description_notify");
    shell({ phase: "idle", mode: "notify" });
    act(() => root.unmount());
    root = createRoot(host);
    await mount(<AutoUpdateRow />);
    expect(host.textContent).toContain("ui.settings.auto_update.description_notify");
  });

  it("is hidden where updates do not exist", async () => {
    shell({ phase: "off", mode: "off" });
    await mount(<AutoUpdateRow />);
    expect(host.querySelector('[role="switch"]')).toBeNull();
  });
});
