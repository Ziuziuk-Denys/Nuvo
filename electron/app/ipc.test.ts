import { describe, expect, it, vi } from "vitest";
import { IpcRegistry, type IpcEventLike } from "./ipc";
import { validateBindings, validateNotchAction, validateSurfaceState } from "./validate";

function setup() {
  const handlers = new Map<string, (event: IpcEventLike, payload?: unknown) => unknown>();
  const frameOf = (url: string | null) => (url === null ? null : { url });
  const mainFrame = frameOf("file:///app/index.html#/library?x=1");
  const notchFrame = frameOf("file:///app/notch.html");
  const main = { id: "main", mainFrame };
  const notch = { id: "notch", mainFrame: notchFrame };
  const refused = vi.fn();
  const registry = new IpcRegistry(
    { handle: (c, l) => handlers.set(c, l), on: (c, l) => handlers.set(c, l) },
    {
      contents: (who) => (who === "main" ? main : notch),
      page: (who) => (who === "main" ? { fileUrl: "file:///app/index.html", devOrigin: "http://localhost:5173" } : { fileUrl: "file:///app/notch.html" }),
      refused,
    },
  );
  const ev = (sender: typeof main, senderFrame: unknown = sender.mainFrame) => ({ sender, senderFrame }) as IpcEventLike;
  return { handlers, main, notch, refused, registry, ev, frameOf, mainFrame, notchFrame };
}

describe("ipc sender checks", () => {
  it("the Discord switch is set from the main window only", () => {
    const s = setup();
    const set = vi.fn();
    s.registry.handle("settings:main-set", "main", (payload) => set(payload));
    const payload = { key: "discord", value: { enabled: true } };
    expect(() => s.handlers.get("settings:main-set")!(s.ev(s.notch), payload)).toThrow("sender not allowed");
    expect(set).not.toHaveBeenCalled();
    s.handlers.get("settings:main-set")!(s.ev(s.main), payload);
    expect(set).toHaveBeenCalledWith(payload);
  });

  it("global shortcuts set from the Notch window are rejected", async () => {
    const s = setup();
    const set = vi.fn((_bindings: unknown) => []);
    s.registry.handle("shortcuts:set-global", "main", (payload) => set(validateBindings(payload)));
    expect(() => s.handlers.get("shortcuts:set-global")!(s.ev(s.notch), [])).toThrow("sender not allowed");
    expect(set).not.toHaveBeenCalled();
    expect(s.refused).toHaveBeenCalledWith("shortcuts:set-global");
    s.handlers.get("shortcuts:set-global")!(s.ev(s.main), [{ commandId: "player.toggle", accelerator: "Ctrl+P" }]);
    expect(set).toHaveBeenCalledTimes(1);
  });

  it("a player state from the Notch window is ignored", () => {
    const s = setup();
    const accept = vi.fn();
    s.registry.on("player:state", "main", (payload) => {
      const state = validateSurfaceState(payload);
      if (state) accept(state);
    });
    const payload = {
      trackId: null,
      title: "",
      artists: "",
      durationMs: 0,
      positionMs: 0,
      sampledAt: 1,
      status: "idle",
      liked: false,
      source: "youtube",
      upNext: [],
    };
    s.handlers.get("player:state")!(s.ev(s.notch), payload);
    expect(accept).not.toHaveBeenCalled();
    s.handlers.get("player:state")!(s.ev(s.main), payload);
    expect(accept).toHaveBeenCalledTimes(1);
  });
});

describe("ipc sender frame", () => {
  const run = (s: ReturnType<typeof setup>, event: IpcEventLike) => {
    const run = vi.fn();
    s.registry.on("player:state", "main", run);
    s.handlers.get("player:state")!(event, {});
    return run;
  };

  it("denies a subframe, another file URL and a null frame", () => {
    const s = setup();
    expect(run(s, s.ev(s.main, s.frameOf("file:///app/index.html")))).not.toHaveBeenCalled();
    expect(run(s, s.ev(s.main, null))).not.toHaveBeenCalled();
    const other = { id: "main", mainFrame: s.frameOf("file:///tmp/evil.html") };
    s.main.mainFrame = other.mainFrame as typeof s.main.mainFrame;
    expect(run(s, s.ev(s.main))).not.toHaveBeenCalled();
    expect(s.refused).toHaveBeenCalledWith("player:state");
  });

  it("allows the app file URL with hash and query, the dev origin, and the notch page", () => {
    const s = setup();
    expect(run(s, s.ev(s.main))).toHaveBeenCalled();
    s.main.mainFrame = s.frameOf("http://localhost:5173/x?y#z") as typeof s.main.mainFrame;
    expect(run(s, s.ev(s.main))).toHaveBeenCalled();
    const notchRun = vi.fn();
    s.registry.on("notch:settings", "notch", notchRun);
    s.handlers.get("notch:settings")!(s.ev(s.notch), {});
    expect(notchRun).toHaveBeenCalled();
  });
});

describe("notch action validation", () => {
  it("bounds seek, volume and ids; rejects unknown", () => {
    expect(validateNotchAction({ type: "seek", positionMs: 5000 })).toEqual({ type: "seek", positionMs: 5000 });
    expect(validateNotchAction({ type: "seek", positionMs: NaN })).toBeNull();
    expect(validateNotchAction({ type: "seek", positionMs: 90_000_000 })).toBeNull();
    expect(validateNotchAction({ type: "volumeDelta", delta: 2 })).toBeNull();
    expect(validateNotchAction({ type: "volumeDelta", delta: -0.05 })).toEqual({ type: "volumeDelta", delta: -0.05 });
    expect(validateNotchAction({ type: "playUpNext", trackId: "x".repeat(300) })).toBeNull();
    expect(validateNotchAction({ type: "playUpNext", trackId: "a b" })).toBeNull();
    expect(validateNotchAction({ type: "playUpNext", trackId: "dQw4w9WgXcQ" })).not.toBeNull();
    expect(validateNotchAction({ type: "rm -rf" })).toBeNull();
    expect(validateNotchAction("next")).toBeNull();
    expect(validateNotchAction({ type: "next", junk: 1 })).toEqual({ type: "next" });
  });
});
