// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AutoUpdateRow, UpdateNotice } from "./UpdateRows";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../../ports/i18n", () => ({
  useTranslation: () => ({ t: (key: string, vars?: Record<string, string>) => (vars ? `${key}:${vars.version}` : key) }),
  getTranslationsForAllLocales: (key: string) => [key],
}));

let root: Root;
let host: HTMLDivElement;

function shell(view: unknown, over: Record<string, unknown> = {}) {
  const calls = { install: vi.fn(async () => true), release: vi.fn(async () => true), setMainSetting: vi.fn(async () => ({ ok: true })) };
  (window as unknown as { nuvoShell: unknown }).nuvoShell = {
    getUpdateState: async () => view,
    onUpdateState: () => () => undefined,
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

describe("UpdateNotice", () => {
  it("is empty until something is downloaded", async () => {
    shell({ phase: "downloading", mode: "install", version: "1.1.0", percent: 10 });
    await mount(<UpdateNotice />);
    expect(host.querySelector("button")).toBeNull();
  });

  it("offers a restart only after the download, and installs on click", async () => {
    const calls = shell({ phase: "ready", mode: "install", version: "1.1.0" });
    await mount(<UpdateNotice />);
    const button = host.querySelector("button");
    expect(button?.textContent).toBe("ui.settings.update_restart");
    expect(calls.install).not.toHaveBeenCalled();
    await act(async () => button?.click());
    expect(calls.install).toHaveBeenCalledTimes(1);
  });

  it("links to the release page where it cannot install", async () => {
    const calls = shell({ phase: "available", mode: "notify", version: "1.1.0" });
    await mount(<UpdateNotice />);
    const button = host.querySelector("button");
    expect(button?.textContent).toBe("ui.settings.update_available:1.1.0");
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

  it("is hidden where updates do not exist", async () => {
    shell({ phase: "off", mode: "off" });
    await mount(<AutoUpdateRow />);
    expect(host.querySelector('[role="switch"]')).toBeNull();
  });
});
