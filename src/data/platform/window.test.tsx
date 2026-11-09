import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import type { NuvoShell, WinState } from "@/shell/nuvoShell";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let push: (state: WinState) => void = () => undefined;
const shell = {
  minimize: vi.fn(async () => undefined),
  toggleMaximize: vi.fn(async () => undefined),
  close: vi.fn(async () => undefined),
  getWinState: vi.fn(async () => ({ maximized: false, fullscreen: false, visible: true })),
  onWinState: vi.fn((cb: (state: WinState) => void) => {
    push = cb;
    return () => undefined;
  }),
  getAppInfo: vi.fn(async () => ({ version: "1.0.0", platform: "linux", packaged: false, compositor: "hyprland" as const, tiling: true })),
};

beforeEach(() => {
  window.nuvoShell = shell as unknown as NuvoShell;
  document.body.innerHTML = "";
});
afterEach(() => vi.clearAllMocks());

async function load() {
  vi.resetModules();
  return import("./window");
}

function render(node: React.ReactNode) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(node));
  return { host, unmount: () => act(() => root.unmount()) };
}

describe("window state", () => {
  it("edge-to-edge when maximized, fullscreen or tiling", async () => {
    const { windowStateFrom } = await load();
    expect(windowStateFrom({ maximized: false, fullscreen: false, visible: true }, false).isEdgeToEdge).toBe(false);
    expect(windowStateFrom({ maximized: true, fullscreen: false, visible: true }, false).isEdgeToEdge).toBe(true);
    expect(windowStateFrom({ maximized: false, fullscreen: true, visible: true }, false)).toEqual({
      isMaximized: false,
      isFullScreen: true,
      isEdgeToEdge: true,
    });
    expect(windowStateFrom({ maximized: false, fullscreen: false, visible: true }, true).isEdgeToEdge).toBe(true);
  });

  it("the hook follows main's window state", async () => {
    const { useWindowState } = await load();
    const seen: boolean[] = [];
    function Probe() {
      seen.push(useWindowState().isMaximized);
      return null;
    }
    const view = render(<Probe />);
    await act(async () => {
      await Promise.resolve();
      push({ maximized: true, fullscreen: false, visible: true });
    });
    expect(seen.at(-1)).toBe(true);
    view.unmount();
  });
});

describe("window commands", () => {
  it("call the shell, and minimize is not offered on a tiling compositor", async () => {
    const { minimizeWindow, toggleMaximizeWindow, closeWindow, canMinimizeWindow } = await load();
    minimizeWindow();
    toggleMaximizeWindow();
    closeWindow();
    expect([shell.minimize, shell.toggleMaximize, shell.close].map((fn) => fn.mock.calls.length)).toEqual([1, 1, 1]);
    canMinimizeWindow();
    await act(async () => Promise.resolve());
    expect(canMinimizeWindow()).toBe(false);
  });
});

describe("button focus", () => {
  it("a mouse click leaves no focus on the button; keyboard activation keeps it", async () => {
    const { useDisableButtonFocus } = await load();
    function Probe() {
      useDisableButtonFocus();
      return <button id="go">Go</button>;
    }
    const view = render(<Probe />);
    const button = document.getElementById("go") as HTMLButtonElement;
    button.focus();
    button.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
    expect(document.activeElement).not.toBe(button);
    button.focus();
    button.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 0 }));
    expect(document.activeElement).toBe(button);
    view.unmount();
  });
});
