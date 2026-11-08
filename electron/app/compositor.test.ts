import { mkdtempSync, rmSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi, afterEach } from "vitest";
import { notchOrigin } from "../notch/placement";
import { createCompositorBridge, createHyprlandPlacer, createSwayPlacer, detectCompositor, hyprRequest, hyprWorkArea, overlayOrigin } from "./compositor";

const request = { title: "Nuvo Notch", width: 400, height: 60, anchor: "top-center" as const, pinned: true, margin: 8 };
const monitor = { focused: true, x: 0, y: 0, width: 1920, height: 1080, scale: 1, transform: 0, reserved: [0, 30, 0, 0] as [number, number, number, number] };

let dirs: string[] = [];
let servers: net.Server[] = [];
afterEach(() => {
  servers.forEach((s) => s.close());
  dirs.forEach((d) => rmSync(d, { recursive: true, force: true }));
  servers = [];
  dirs = [];
});

/** A fake Hyprland socket answering by request prefix and recording every request. */
async function fakeHyprland(answer: (request: string) => string | null): Promise<{ path: string; requests: string[] }> {
  const dir = mkdtempSync(path.join(tmpdir(), "hypr-"));
  dirs.push(dir);
  const socketPath = path.join(dir, ".socket.sock");
  const requests: string[] = [];
  const server = net.createServer({ allowHalfOpen: true }, (socket) => {
    socket.on("error", () => {});
    let data = "";
    socket.on("data", (chunk) => (data += chunk));
    socket.on("end", () => {
      requests.push(data);
      const reply = answer(data);
      if (reply !== null) socket.end(reply);
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(socketPath, resolve));
  return { path: socketPath, requests };
}

describe("compositor", () => {
  it("the session matrix", () => {
    expect(detectCompositor({}, [], "linux")).toBe("none");
    expect(detectCompositor({ WAYLAND_DISPLAY: "wayland-0" }, [], "linux")).toBe("wayland");
    expect(detectCompositor({ WAYLAND_DISPLAY: "wayland-0", HYPRLAND_INSTANCE_SIGNATURE: "abc", XDG_RUNTIME_DIR: "/run/user/1000" }, [], "linux")).toBe(
      "hyprland",
    );
    expect(detectCompositor({ WAYLAND_DISPLAY: "wayland-0", SWAYSOCK: "/run/sway" }, [], "linux")).toBe("sway");
    expect(
      detectCompositor({ WAYLAND_DISPLAY: "wayland-0", HYPRLAND_INSTANCE_SIGNATURE: "abc", XDG_RUNTIME_DIR: "/run" }, ["--ozone-platform=x11"], "linux"),
    ).toBe("none");
  });

  it("overlay origins", () => {
    const area = { x: 0, y: 30, width: 1920, height: 1050 };
    expect(overlayOrigin(area, 400, 8, "top-left")).toEqual({ x: 8, y: 38 });
    expect(overlayOrigin(area, 400, 8, "top-right")).toEqual({ x: 1512, y: 38 });
    expect(overlayOrigin(area, 400, 8, "top-center")).toEqual({ x: 760, y: 38 });
  });

  it("classic Hyprland: one batch, pin only when it differs", async () => {
    for (const pinned of [false, true]) {
      const hypr = await fakeHyprland((r) => {
        if (r === "j/clients") return JSON.stringify([{ address: "0xabc", title: "Nuvo Notch", pid: 42, mapped: true, pinned }]);
        if (r === "j/monitors") return JSON.stringify([monitor]);
        if (r.startsWith("dispatch hl.dsp")) return "unknown request";
        return r
          .split(";")
          .map(() => "ok")
          .join("\n");
      });
      expect(await createHyprlandPlacer(hypr.path, 42)(request)).toBe(true);
      const batch = hypr.requests.find((r) => r.startsWith("[[BATCH]]"))!;
      expect(batch).toContain("dispatch setfloating address:0xabc");
      expect(batch).toContain("dispatch movewindowpixel exact 760 38,address:0xabc");
      expect(batch.includes("dispatch pin address:0xabc")).toBe(!pinned);
      for (const prop of ["noborder 1", "noshadow 1", "rounding 0", "noblur 1"]) expect(batch).toContain(`setprop address:0xabc ${prop}`);
    }
  });

  it("Lua Hyprland: one function with float, move, pin and four properties", async () => {
    const hypr = await fakeHyprland((r) => {
      if (r === "j/clients") return JSON.stringify([{ address: "0xabc", title: "Nuvo Notch", pid: 42, mapped: true, pinned: false }]);
      if (r === "j/monitors") return JSON.stringify([monitor]);
      return "ok";
    });
    expect(await createHyprlandPlacer(hypr.path, 42)(request)).toBe(true);
    const fn = hypr.requests.find((r) => r.startsWith("dispatch function()"))!;
    for (const part of ["window.float", "window.move", '"exact"', "window.pin", "border_size", "rounding", "no_shadow", "no_blur"]) expect(fn).toContain(part);
  });

  it("a rotated, scaled monitor's work area", () => {
    expect(hyprWorkArea({ focused: true, x: 0, y: 100, width: 3840, height: 2160, scale: 2, transform: 1, reserved: [0, 40, 0, 0] })).toEqual({
      x: 0,
      y: 140,
      width: 1080,
      height: 1880,
    });
  });

  it("sway criteria are escaped and the command complete", async () => {
    const calls: string[][] = [];
    const exec = async (_file: string, args: string[]) => {
      calls.push(args);
      return args.includes("get_workspaces")
        ? JSON.stringify([{ focused: true, rect: { x: 0, y: 0, width: 1920, height: 1080 } }])
        : JSON.stringify([{ success: true }]);
    };
    expect(await createSwayPlacer(7, exec)(request)).toBe(true);
    expect(calls[1][1]).toBe('[pid=7 title="^Nuvo Notch$"] floating enable, sticky enable, border none, move absolute position 760 8');
    await createSwayPlacer(7, exec)({ ...request, title: "Nuvo (Notch)" });
    expect(calls[3][1]).toContain('title="^Nuvo \\(Notch\\)$"');
  });

  it("a missing socket resolves false and logs a message once", async () => {
    const log = vi.fn();
    const env = { XDG_RUNTIME_DIR: "/nonexistent", HYPRLAND_INSTANCE_SIGNATURE: "none" };
    const bridge = createCompositorBridge("hyprland", env, 1, log)!;
    expect(await bridge.placeOverlay(request)).toBe(false);
    expect(await bridge.placeOverlay(request)).toBe(false);
    expect(log).toHaveBeenCalledTimes(1);
  });

  it("a silent socket times out after 1.5 s without throwing", async () => {
    const hypr = await fakeHyprland(() => null);
    const started = Date.now();
    await expect(hyprRequest(hypr.path, "j/clients", 200)).rejects.toThrow("timed out");
    expect(Date.now() - started).toBeLessThan(1500);
    const log = vi.fn();
    const bridge = createCompositorBridge(
      "hyprland",
      { XDG_RUNTIME_DIR: path.dirname(path.dirname(path.dirname(hypr.path))), HYPRLAND_INSTANCE_SIGNATURE: "x" },
      1,
      log,
    )!;
    await expect(bridge.placeOverlay(request)).resolves.toBe(false);
  });
});

describe("compositor input validation", () => {
  const client = { address: "0xabc", title: "Nuvo Notch", pid: 42, mapped: true, pinned: false };
  const placeWith = async (monitors: unknown, clients: unknown = [client]) => {
    const hypr = await fakeHyprland((r) => {
      if (r === "j/clients") return JSON.stringify(clients);
      if (r === "j/monitors") return JSON.stringify(monitors);
      return r
        .split(";")
        .map(() => "ok")
        .join("\n");
    });
    const ok = await createHyprlandPlacer(hypr.path, 42)(request).catch(() => false);
    return { ok, requests: hypr.requests };
  };

  it("skips malformed monitors and never sends NaN or Infinity", async () => {
    for (const bad of [
      { ...monitor, reserved: undefined },
      { ...monitor, scale: 0 },
      { ...monitor, width: null },
      { ...monitor, x: "1" },
    ]) {
      const result = await placeWith([bad]);
      expect(result.ok).toBe(false);
      expect(result.requests.join("")).not.toMatch(/NaN|Infinity|undefined|null/);
    }
    const mixed = await placeWith([{ ...monitor, scale: 0, focused: true }, monitor]);
    expect(mixed.ok).toBe(true);
  });

  it("rejects a client address that is not hex", async () => {
    const result = await placeWith([monitor], [{ ...client, address: "0xabc;dispatch exec evil" }]);
    expect(result.ok).toBe(false);
    expect(result.requests.join("")).not.toContain("evil");
  });

  it("caps a reply by bytes and decodes multibyte text intact", async () => {
    const big = await fakeHyprland(() => "x".repeat(2 * 1024 * 1024));
    await expect(hyprRequest(big.path, "j/clients")).rejects.toThrow("too large");
    const text = await fakeHyprland(() => "\u00e9\u4e2d".repeat(1000));
    expect(await hyprRequest(text.path, "j/clients")).toBe("\u00e9\u4e2d".repeat(1000));
  });

  it("requires every sway result to have boolean success", async () => {
    const workspaces = JSON.stringify([{ focused: true, rect: { x: 0, y: 0, width: 1920, height: 1080 } }]);
    for (const answer of [[null], [{ success: "yes" }], [{}], [{ success: true }, 5]]) {
      const exec = async (_f: string, args: string[]) => (args.includes("get_workspaces") ? workspaces : JSON.stringify(answer));
      expect(await createSwayPlacer(7, exec)(request)).toBe(false);
    }
    const badRect = async () => JSON.stringify([{ focused: true, rect: { x: 0, y: 0, width: "a", height: 1 } }]);
    await expect(createSwayPlacer(7, badRect)(request)).rejects.toThrow();
  }, 10000);

  it("matches the Notch origin when the compositor reserves nothing", () => {
    const geometries = [
      { x: 0, y: 0, width: 1920, height: 1080, scale: 1 },
      { x: 0, y: 0, width: 2560, height: 1440, scale: 1.25 },
      { x: 1920, y: 0, width: 2560, height: 1440, scale: 1 },
    ];
    for (const g of geometries) {
      const area = hyprWorkArea({ ...monitor, ...g, reserved: [0, 0, 0, 0] });
      const display = { x: g.x, y: g.y, width: g.width / g.scale, height: g.height / g.scale };
      expect(overlayOrigin(area, 400, 0, "top-center")).toEqual(notchOrigin(display, 400));
    }
  });

  it("monitor bounds ignore a reserved top panel and match the Notch origin", async () => {
    const display = { x: 0, y: 0, width: 1920, height: 1080 };
    const panel = { ...monitor, reserved: [0, 32, 0, 0] as [number, number, number, number] };
    const hypr = await fakeHyprland((r) => {
      if (r === "j/clients") return JSON.stringify([{ address: "0xabc", title: "Nuvo Notch", pid: 42, mapped: true, pinned: false }]);
      if (r === "j/monitors") return JSON.stringify([panel]);
      if (r.startsWith("dispatch hl.dsp")) return "unknown request";
      return r
        .split(";")
        .map(() => "ok")
        .join("\n");
    });
    const notch = { ...request, margin: 0, bounds: "monitor" as const };
    expect(await createHyprlandPlacer(hypr.path, 42)(notch)).toBe(true);
    const expected = notchOrigin(display, 400);
    expect(hypr.requests.find((r) => r.startsWith("[[BATCH]]"))).toContain(`movewindowpixel exact ${expected.x} ${expected.y},`);

    const calls: string[][] = [];
    const exec = async (_f: string, args: string[]) => {
      calls.push(args);
      if (args.includes("get_outputs")) return JSON.stringify([{ focused: true, rect: display }]);
      if (args.includes("get_workspaces")) return JSON.stringify([{ focused: true, rect: { ...display, y: 28, height: 1052 } }]);
      return JSON.stringify([{ success: true }]);
    };
    expect(await createSwayPlacer(7, exec)(notch)).toBe(true);
    expect(calls[1][1]).toContain(`position ${expected.x} ${expected.y}`);
    await createSwayPlacer(7, exec)({ ...notch, bounds: "workArea" });
    expect(calls[3][1]).toContain(`position ${expected.x} 28`);
  });
});
