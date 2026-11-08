// @vitest-environment jsdom
import { act, useState } from "react";
import { type Root, createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { LEGACY_SHORTCUTS_KEY } from "./bindings";
import type { GlobalBinding } from "./globalSync";
import type { CommandDefinition } from "./registry";
import { createShortcuts, type ShortcutShell, type Shortcuts } from "./shortcuts";
import { useShellShortcuts, type ShellShortcutOptions } from "./useShellShortcuts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const BASE = "nuvo-core://local";
type Route = () => Response;

let routes: Record<string, Route>;
let calls: Array<{ method: string; path: string; body: string | null }>;
let ran: string[];
let appCommand: ((command: { commandId: string }) => void) | null;
let globalLists: GlobalBinding[][];
let remoteSubscriptions: number;
let shortcuts: Shortcuts;
let stop: () => void;

const fetchFake = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const method = init?.method ?? "GET";
  const path = String(input).slice(BASE.length);
  calls.push({ method, path, body: typeof init?.body === "string" ? init.body : null });
  const route = routes[`${method} ${path}`];
  if (!route) throw new TypeError(`fetch failed: ${method} ${path}`);
  return route();
}) as typeof fetch;

const command = (id: string, extra: Partial<CommandDefinition>): CommandDefinition => ({
  id,
  labelKey: id,
  group: "playback",
  run: () => ran.push(id),
  ...extra,
});
const flush = () =>
  act(async () => {
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  });
const key = (code: string, keyName: string) => window.dispatchEvent(new KeyboardEvent("keydown", { code, key: keyName, bubbles: true, cancelable: true }));

beforeEach(() => {
  localStorage.clear();
  routes = {};
  calls = [];
  ran = [];
  appCommand = null;
  globalLists = [];
  remoteSubscriptions = 0;
  // onRemoteCommand is on the real shell too; the registry must never subscribe to it
  const shell: ShortcutShell & { onRemoteCommand(): () => void } = {
    setGlobalShortcuts: async (bindings) => {
      globalLists.push(bindings);
      return bindings.map((binding) => ({ commandId: binding.commandId, ok: true }));
    },
    onAppCommand: (callback) => {
      appCommand = callback;
      return () => {
        appCommand = null;
      };
    },
    onRemoteCommand: () => {
      remoteSubscriptions += 1;
      return () => undefined;
    },
  };
  shortcuts = createShortcuts({
    base: BASE,
    fetch: fetchFake,
    storage: () => localStorage,
    shell,
    strict: true,
    windowFocused: () => true,
    overlayOpen: () => false,
    escapeGuarded: () => false,
    commands: [
      command("player.toggle", { defaultApp: "Space", globalAllowed: true }),
      command("player.mute", { defaultApp: "M", globalAllowed: true }),
      command("library.like-toggle", { group: "library", defaultGlobal: "Alt+Shift+L", globalAllowed: true }),
    ],
  });
  stop = () => undefined;
});

afterEach(() => stop());

describe("createShortcuts", () => {
  it("loads the stored bindings, then sends main one global list", async () => {
    routes["GET /v1/shortcuts"] = () =>
      Response.json({ bindings: { version: 1, app: { "player.toggle": "P" }, global: { "library.like-toggle": "Alt+Shift+J" } } });
    stop = shortcuts.start();
    await flush();
    expect(globalLists).toEqual([[{ commandId: "library.like-toggle", accelerator: "Alt+Shift+J" }]]);
    key("KeyP", "p");
    expect(ran).toEqual(["player.toggle"]);
  });

  it("moves the old renderer settings into the daemon once", async () => {
    routes["GET /v1/shortcuts"] = () => Response.json({ bindings: null });
    routes["PUT /v1/shortcuts"] = () => new Response(null, { status: 204 });
    localStorage.setItem(LEGACY_SHORTCUTS_KEY, JSON.stringify({ state: { mainApp: { playPause: "P" } }, version: 0 }));
    stop = shortcuts.start();
    await flush();
    expect(calls.filter((call) => call.method === "PUT").map((call) => JSON.parse(call.body!))).toEqual([
      { version: 1, app: { "player.toggle": "P" }, global: {} },
    ]);
    expect(localStorage.getItem(LEGACY_SHORTCUTS_KEY)).toBeNull();
    expect(shortcuts.registry.bindingFor("player.toggle", "app")).toBe("P");
  });

  it("keeps defaults while the library is locked and never overwrites the stored copy (Review Focus 2)", async () => {
    routes["GET /v1/shortcuts"] = () => new Response(null, { status: 423 });
    stop = shortcuts.start();
    await flush();
    key("Space", " ");
    expect(ran).toEqual(["player.toggle"]);
    shortcuts.registry.setBinding("player.mute", "app", "N");
    await flush();
    expect(calls.some((call) => call.method === "PUT")).toBe(false);

    routes["GET /v1/shortcuts"] = () => Response.json({ bindings: { version: 1, app: { "player.toggle": "P" }, global: {} } });
    window.dispatchEvent(new Event("focus"));
    await flush();
    expect(shortcuts.registry.bindingFor("player.toggle", "app")).toBe("P");
    expect(calls.some((call) => call.method === "PUT")).toBe(false);
  });

  it("runs app:command as a global trigger and leaves player:command to the engine (test 20 route, test 35 owner)", async () => {
    routes["GET /v1/shortcuts"] = () => Response.json({ bindings: null });
    stop = shortcuts.start();
    await flush();
    appCommand?.({ commandId: "library.like-toggle" });
    expect(ran).toEqual(["library.like-toggle"]);
    expect(remoteSubscriptions).toBe(0);
  });

  it("gives keys to the recorder while recording, and a window blur ends it (test 30)", async () => {
    routes["GET /v1/shortcuts"] = () => Response.json({ bindings: null });
    routes["PUT /v1/shortcuts"] = () => new Response(null, { status: 204 });
    stop = shortcuts.start();
    await flush();
    shortcuts.recorder.start("player.mute", "app");
    key("Space", " ");
    expect(ran).toEqual([]);
    expect(shortcuts.recorder.state).toMatchObject({ kind: "recording", rejection: { reason: "conflict", conflictId: "player.toggle" } });
    window.dispatchEvent(new Event("blur"));
    expect(shortcuts.recorder.state).toEqual({ kind: "idle" });
    expect(shortcuts.registry.bindingFor("player.mute", "app")).toBe("M");
  });
});

describe("useShellShortcuts", () => {
  let root: Root;
  let host: HTMLDivElement;
  let track: boolean;
  let back: ReturnType<typeof vi.fn<() => boolean>>;
  let current: { set: (patch: Partial<Record<"search" | "queue" | "lyrics", boolean>>) => void; state: Record<"search" | "queue" | "lyrics", boolean> };

  function Harness() {
    const [state, setState] = useState({ search: false, queue: false, lyrics: false });
    current = { state, set: (patch) => setState((previous) => ({ ...previous, ...patch })) };
    const options: ShellShortcutOptions = {
      searchOpen: state.search,
      openSearch: () => current.set({ search: true }),
      closeSearch: () => current.set({ search: false }),
      rightPanelOpen: state.queue,
      openRightPanel: () => current.set({ queue: true }),
      closeRightPanel: () => current.set({ queue: false }),
      fullscreenOpen: state.lyrics,
      openFullscreen: () => current.set({ lyrics: true }),
      closeFullscreen: () => current.set({ lyrics: false }),
      onEscapeFallback: back,
      openRecognize: vi.fn(),
    };
    useShellShortcuts(shortcuts, options, hasTrack);
    return null;
  }
  const hasTrack = () => track;

  beforeEach(() => {
    routes["GET /v1/shortcuts"] = () => Response.json({ bindings: null });
    track = false;
    back = vi.fn(() => true);
    host = document.createElement("div");
    root = createRoot(host);
    act(() => root.render(<Harness />));
  });

  afterEach(() => act(() => root.unmount()));

  it("closes surfaces in the reverse order they opened, then falls back (test 21)", () => {
    act(() => key("Slash", "/"));
    act(() => key("KeyQ", "q"));
    expect(current.state).toMatchObject({ search: true, queue: true });
    act(() => key("Escape", "Escape"));
    expect(current.state).toMatchObject({ search: true, queue: false });
    act(() => key("Escape", "Escape"));
    expect(current.state).toMatchObject({ search: false, queue: false });
    act(() => key("Escape", "Escape"));
    expect(back).toHaveBeenCalledTimes(1);
  });

  it("F opens lyrics only with a track and closes them again (test 19)", () => {
    act(() => key("KeyF", "f"));
    expect(current.state.lyrics).toBe(false);
    track = true;
    act(() => key("KeyF", "f"));
    expect(current.state.lyrics).toBe(true);
    act(() => key("KeyF", "f"));
    expect(current.state.lyrics).toBe(false);
  });

  it("removes its commands and listener on unmount", () => {
    act(() => root.unmount());
    act(() => key("Slash", "/"));
    expect(shortcuts.registry.command("nav.search")).toBeNull();
    root = createRoot(host);
  });
});
