// @vitest-environment node
import { execFile, execFileSync, spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Message } from "./dbus";
import { IDLE_STATE } from "./relay";
import { BUS_NAME, INTERFACE, OBJECT_PATH, PanelService, startPanelBus, type PanelBus, type PanelBusLike } from "./panelBus";
import type { SurfaceState } from "../../src/engine/types";

const execFileAsync = promisify(execFile);

function playing(overrides: Partial<SurfaceState> = {}): SurfaceState {
  return { ...IDLE_STATE, trackId: "t1", title: "Song", artists: "Artist", durationMs: 200_000, positionMs: 0, sampledAt: 0, status: "playing", ...overrides };
}

function fakeBus() {
  const bus = {
    onCall: (_call: Message) => undefined as void,
    replies: [] as Array<{ signature?: string; body?: unknown[] }>,
    errors: [] as string[],
    signals: [] as Array<Omit<Message, "type">>,
    reply(_call: Message, signature?: string, body?: unknown[]) {
      bus.replies.push({ signature, body });
    },
    error(_call: Message, name: string) {
      bus.errors.push(name);
    },
    signal(message: Omit<Message, "type">) {
      bus.signals.push(message);
    },
  };
  return bus satisfies PanelBusLike;
}

function setup(now = () => 0) {
  const bus = fakeBus();
  const command = vi.fn();
  const show = vi.fn();
  const service = new PanelService(bus, { mprisName: "org.mpris.MediaPlayer2.chromium.instance1", command, show, now });
  const call = (member: string, iface = INTERFACE, body: unknown[] = []) => bus.onCall({ type: 1, path: OBJECT_PATH, interface: iface, member, body });
  return { bus, command, show, service, call };
}

describe("PanelService", () => {
  afterEach(() => vi.useRealTimers());

  it("turns ToggleLike and Dislike into player commands only with a track", () => {
    const { service, command, call } = setup();
    call("ToggleLike");
    call("Dislike");
    expect(command).not.toHaveBeenCalled();
    service.update(playing());
    call("ToggleLike");
    service.update(playing({ liked: true }));
    call("ToggleLike");
    call("Dislike");
    expect(command.mock.calls.map(([c]) => c)).toEqual([{ type: "like" }, { type: "unlike" }, { type: "dislike" }]);
  });

  it("Show brings the window up", () => {
    const { show, call } = setup();
    call("Show");
    expect(show).toHaveBeenCalledOnce();
  });

  it("signals only the properties that changed", () => {
    const { service, bus } = setup();
    service.update(playing());
    expect(bus.signals).toHaveLength(0);
    service.update(playing({ liked: true }));
    service.update(playing({ liked: true, positionMs: 10 }));
    expect(bus.signals).toHaveLength(1);
    expect(bus.signals[0]).toMatchObject({ member: "PropertiesChanged", body: [INTERFACE, [["Liked", ["b", true]]], []] });
  });

  it("follows the lyrics line with one timer while playing", () => {
    vi.useFakeTimers();
    let now = 0;
    const { service, bus } = setup(() => now);
    service.setLyrics({
      trackId: "t1",
      lines: [
        { timeMs: 1000, text: "first" },
        { timeMs: 3000, text: "second" },
      ],
    });
    service.update(playing({ positionMs: 500, sampledAt: 0 }));
    expect(service.properties.LyricsLine).toBe("");
    now = 1000;
    vi.advanceTimersByTime(500);
    expect(service.properties.LyricsLine).toBe("first");
    now = 3000;
    vi.advanceTimersByTime(2000);
    expect(service.properties.LyricsLine).toBe("second");
    expect(vi.getTimerCount()).toBe(0);
    expect(bus.signals.map((s) => (s.body as [string, Array<[string, [string, unknown]]>])[1][0][1][1])).toEqual(["first", "second"]);
  });

  it("drops the line for another track, a paused track keeps its line and arms no timer", () => {
    vi.useFakeTimers();
    const { service } = setup(() => 99_999);
    service.setLyrics({ trackId: "other", lines: [{ timeMs: 0, text: "x" }] });
    service.update(playing());
    expect(service.properties.LyricsLine).toBe("");
    service.setLyrics({
      trackId: "t1",
      lines: [
        { timeMs: 0, text: "a" },
        { timeMs: 5000, text: "b" },
      ],
    });
    service.update(playing({ status: "paused", positionMs: 100 }));
    expect(service.properties.LyricsLine).toBe("a");
    expect(vi.getTimerCount()).toBe(0);
    service.update(IDLE_STATE);
    expect(service.properties).toMatchObject({ Liked: false, LyricsLine: "" });
  });

  it("answers Get, GetAll and Introspect, and refuses the rest", () => {
    const { service, bus, call } = setup();
    service.update(playing({ liked: true }));
    call("GetAll", "org.freedesktop.DBus.Properties", [INTERFACE]);
    call("Get", "org.freedesktop.DBus.Properties", [INTERFACE, "Liked"]);
    call("Get", "org.freedesktop.DBus.Properties", [INTERFACE, "Secret"]);
    call("Set", "org.freedesktop.DBus.Properties", [INTERFACE, "Liked", ["b", false]]);
    call("Introspect", "org.freedesktop.DBus.Introspectable");
    call("Explode");
    bus.onCall({ type: 1, path: "/elsewhere", interface: INTERFACE, member: "Show" });
    expect(bus.replies[0]).toEqual({
      signature: "a{sv}",
      body: [
        [
          ["MprisName", ["s", "org.mpris.MediaPlayer2.chromium.instance1"]],
          ["Liked", ["b", true]],
          ["LyricsLine", ["s", ""]],
        ],
      ],
    });
    expect(bus.replies[1]).toEqual({ signature: "v", body: [["b", true]] });
    expect(String(bus.replies[2].body?.[0])).toContain('<method name="Dislike"/>');
    expect(bus.errors).toEqual([
      "org.freedesktop.DBus.Error.UnknownProperty",
      "org.freedesktop.DBus.Error.PropertyReadOnly",
      "org.freedesktop.DBus.Error.UnknownMethod",
      "org.freedesktop.DBus.Error.UnknownObject",
    ]);
  });
});

function has(tool: string): boolean {
  try {
    execFileSync("sh", ["-c", `command -v ${tool}`], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** A private bus for this test only: never the owner's session bus. */
describe.skipIf(!has("dbus-daemon") || !has("gdbus"))("quest.nuvo.Nuvo.Player on a real bus", () => {
  let daemon: ChildProcess;
  let dir: string;
  let address: string;
  let panel: PanelBus | null;
  const commands: unknown[] = [];
  let shown = 0;

  const gdbus = async (...args: string[]) =>
    (await execFileAsync("gdbus", args, { env: { ...process.env, DBUS_SESSION_BUS_ADDRESS: address }, timeout: 5000 })).stdout.trim();
  const callMethod = (method: string, ...args: string[]) =>
    gdbus("call", "--session", "--dest", BUS_NAME, "--object-path", OBJECT_PATH, "--method", method, ...args);

  beforeAll(async () => {
    const cache = path.join(homedir(), ".cache");
    mkdirSync(cache, { recursive: true });
    dir = mkdtempSync(path.join(cache, "nuvo-dbus-"));
    address = `unix:path=${path.join(dir, "bus")}`;
    daemon = spawn("dbus-daemon", ["--session", "--nofork", "--nopidfile", `--address=${address}`, "--print-address"], {
      stdio: ["ignore", "pipe", "inherit"],
    });
    await new Promise<void>((resolve) => daemon.stdout!.once("data", () => resolve()));
    panel = await startPanelBus(
      { mprisName: "org.mpris.MediaPlayer2.chromium.instance42", command: (c) => commands.push(c), show: () => shown++, now: Date.now },
      { DBUS_SESSION_BUS_ADDRESS: address },
    );
  });

  afterAll(() => {
    panel?.close();
    daemon?.kill();
    rmSync(dir, { recursive: true, force: true });
  });

  it("owns the name and serves properties to a stock client", async () => {
    expect(panel).not.toBeNull();
    panel!.service.update(playing({ liked: true }));
    expect(await callMethod("org.freedesktop.DBus.Properties.GetAll", INTERFACE)).toBe(
      "({'MprisName': <'org.mpris.MediaPlayer2.chromium.instance42'>, 'Liked': <true>, 'LyricsLine': <''>},)",
    );
    expect(await callMethod("org.freedesktop.DBus.Properties.Get", INTERFACE, "Liked")).toBe("(<true>,)");
    expect(await gdbus("introspect", "--session", "--dest", BUS_NAME, "--object-path", OBJECT_PATH)).toContain("ToggleLike");
  });

  it("runs methods and reports errors", async () => {
    await callMethod(`${INTERFACE}.ToggleLike`);
    await callMethod(`${INTERFACE}.Dislike`);
    await callMethod(`${INTERFACE}.Show`);
    expect(commands).toEqual([{ type: "unlike" }, { type: "dislike" }]);
    expect(shown).toBe(1);
    await expect(callMethod(`${INTERFACE}.Nope`)).rejects.toThrow(/UnknownMethod/);
  });

  it("emits PropertiesChanged that a monitor sees", async () => {
    const monitor = spawn("gdbus", ["monitor", "--session", "--dest", BUS_NAME, "--object-path", OBJECT_PATH], {
      env: { ...process.env, DBUS_SESSION_BUS_ADDRESS: address },
    });
    let seen = "";
    monitor.stdout.on("data", (chunk: Buffer) => (seen += chunk.toString()));
    await new Promise((resolve) => setTimeout(resolve, 500));
    panel!.service.setLyrics({ trackId: "t1", lines: [{ timeMs: 0, text: "Line one" }] });
    await expect.poll(() => seen, { timeout: 3000 }).toContain("'LyricsLine': <'Line one'>");
    monitor.kill();
  });

  it("a second owner stays out", async () => {
    const second = await startPanelBus(
      { mprisName: "x", command: () => undefined, show: () => undefined, now: Date.now },
      { DBUS_SESSION_BUS_ADDRESS: address },
    );
    expect(second).toBeNull();
  });
});
