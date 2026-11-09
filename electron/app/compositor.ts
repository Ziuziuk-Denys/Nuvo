import { execFile } from "node:child_process";
import { default as net } from "node:net";
import { default as path } from "node:path";

export type CompositorKind = "hyprland" | "sway" | "wayland" | "none";
export type Anchor = "top-left" | "top-center" | "top-right";

export interface PlaceRequest {
  title: string;
  width: number;
  height: number;
  anchor: Anchor;
  pinned: boolean;
  margin: number;
  bounds?: "monitor" | "workArea";
}

export type Rect = Record<"x" | "y" | "width" | "height", number>;

export interface CompositorBridge {
  kind: "hyprland" | "sway";
  placeOverlay(request: PlaceRequest): Promise<boolean>;
}

export const REQUEST_TIMEOUT_MS = 1500;
export const MAX_REPLY_BYTES = 1024 * 1024;
export const LOOKUP_ATTEMPTS = 25;
export const LOOKUP_DELAY_MS = 40;

export function detectCompositor(env: NodeJS.ProcessEnv, argv: readonly string[], platform: NodeJS.Platform): CompositorKind {
  const forcedX11 = argv.includes("--ozone-platform=x11") || argv.includes("--ozone-platform-hint=x11");
  const wayland = platform === "linux" && (Boolean(env.WAYLAND_DISPLAY) || env.XDG_SESSION_TYPE === "wayland") && !forcedX11;
  if (!wayland) return "none";
  if (env.HYPRLAND_INSTANCE_SIGNATURE && env.XDG_RUNTIME_DIR) return "hyprland";
  if (env.SWAYSOCK) return "sway";
  return "wayland";
}

export function overlayOrigin(area: Rect, width: number, margin: number, anchor: Anchor): { x: number; y: number } {
  const y = Math.round(area.y + margin);
  if (anchor === "top-left") return { x: Math.round(area.x + margin), y };
  if (anchor === "top-right") return { x: Math.round(area.x + area.width - width - margin), y };
  return { x: Math.round(area.x + (area.width - width) / 2), y };
}

export type HyprMonitor = Rect & {
  focused: boolean;
  scale: number;
  transform: number;
  reserved: [number, number, number, number];
};

export function hyprWorkArea(monitor: HyprMonitor): Rect {
  let width = monitor.width / monitor.scale;
  let height = monitor.height / monitor.scale;
  if (monitor.transform % 2 === 1) [width, height] = [height, width];
  const [left, top, right, bottom] = monitor.reserved;
  return { x: monitor.x + left, y: monitor.y + top, width: width - left - right, height: height - top - bottom };
}

export function escapeSwayTitle(title: string): string {
  return title.replace(/[\\^$.*+?()[\]{}|"]/g, "\\$&");
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** One Hyprland request per connection: write, close the writing side, read until the server closes. */
export function hyprRequest(socketPath: string, request: string, timeoutMs = REQUEST_TIMEOUT_MS): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    const chunks: Buffer[] = [];
    let received = 0;
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("hyprland request timed out"));
    }, timeoutMs);
    socket.on("connect", () => socket.end(request));
    socket.on("data", (chunk) => {
      chunks.push(chunk);
      received += chunk.length;
      if (received > MAX_REPLY_BYTES) {
        clearTimeout(timer);
        socket.destroy();
        reject(new Error("hyprland reply too large"));
      }
    });
    socket.on("end", () => {
      clearTimeout(timer);
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    socket.on("error", (cause) => {
      clearTimeout(timer);
      reject(cause);
    });
  });
}

export function hyprSocketPath(env: NodeJS.ProcessEnv): string {
  return path.join(env.XDG_RUNTIME_DIR ?? "", "hypr", env.HYPRLAND_INSTANCE_SIGNATURE ?? "", ".socket.sock");
}

const isNum = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

function isRect(value: unknown): value is Rect {
  const r = value as Rect | null;
  return typeof r === "object" && r !== null && isNum(r.x) && isNum(r.y) && isNum(r.width) && isNum(r.height);
}

function isHyprMonitor(value: unknown): value is HyprMonitor {
  const m = value as HyprMonitor | null;
  return isRect(m) && isNum(m.scale) && m.scale > 0 && isNum(m.transform) && Array.isArray(m.reserved) && m.reserved.length === 4 && m.reserved.every(isNum);
}

type HyprClient = { address: string; title: string; pid: number; mapped: boolean; pinned: boolean };

export function createHyprlandPlacer(socketPath: string, pid: number, request = hyprRequest) {
  let lua: boolean | null = null;
  return async (place: PlaceRequest): Promise<boolean> => {
    let client: HyprClient | undefined;
    for (let attempt = 0; attempt < LOOKUP_ATTEMPTS && !client; attempt++) {
      const clients = JSON.parse(await request(socketPath, "j/clients")) as HyprClient[];
      if (!Array.isArray(clients)) throw new Error("hyprland: malformed clients");
      client = clients.find((c) => c?.title === place.title && typeof c.address === "string" && /^0x[0-9a-f]+$/.test(c.address) && c.pid === pid && c.mapped);
      if (!client) await sleep(LOOKUP_DELAY_MS);
    }
    if (!client) throw new Error("hyprland: window not found");
    const monitors = JSON.parse(await request(socketPath, "j/monitors")) as HyprMonitor[];
    if (!Array.isArray(monitors)) throw new Error("hyprland: malformed monitors");
    const valid = monitors.filter(isHyprMonitor);
    const monitor = valid.find((m) => m.focused) ?? valid[0];
    if (!monitor) throw new Error("hyprland: no monitor");
    const area = place.bounds === "monitor" ? hyprWorkArea({ ...monitor, reserved: [0, 0, 0, 0] }) : hyprWorkArea(monitor);
    const origin = overlayOrigin(area, place.width, place.margin, place.anchor);
    lua ??= (await request(socketPath, "dispatch hl.dsp.no_op()")).trim() === "ok";
    const window = `address:${client.address}`;
    if (lua) {
      const w = JSON.stringify(window);
      const calls = [
        `hl.dispatch(hl.dsp.window.float({ action = "enable", window = ${w} }))`,
        `hl.dispatch(hl.dsp.window.move({ x = ${origin.x}, y = ${origin.y}, "exact", window = ${w} }))`,
        `hl.dispatch(hl.dsp.window.pin({ action = ${JSON.stringify(place.pinned ? "enable" : "disable")}, window = ${w} }))`,
        ...[
          ["border_size", 0],
          ["rounding", 0],
          ["no_shadow", 1],
          ["no_blur", 1],
        ].map(([prop, value]) => `hl.dispatch(hl.dsp.window.set_prop({ prop = ${JSON.stringify(prop)}, value = ${value}, window = ${w} }))`),
      ];
      return (await request(socketPath, `dispatch function() ${calls.join(" ")} end`)).trim() === "ok";
    }
    const commands = [
      `dispatch setfloating ${window}`,
      `dispatch movewindowpixel exact ${origin.x} ${origin.y},${window}`,
      ...(client.pinned !== place.pinned ? [`dispatch pin ${window}`] : []),
      `dispatch setprop ${window} noborder 1`,
      `dispatch setprop ${window} noshadow 1`,
      `dispatch setprop ${window} rounding 0`,
      `dispatch setprop ${window} noblur 1`,
    ];
    const answer = await request(socketPath, `[[BATCH]]${commands.join(";")}`);
    return answer
      .split(/\s+/)
      .filter(Boolean)
      .every((part) => part === "ok");
  };
}

export type Exec = (file: string, args: string[], timeoutMs: number) => Promise<string>;

export const execText: Exec = (file, args, timeoutMs) =>
  new Promise((resolve, reject) => {
    execFile(file, args, { timeout: timeoutMs }, (error, stdout) => (error ? reject(error) : resolve(stdout)));
  });

export function createSwayPlacer(pid: number, exec: Exec = execText) {
  return async (place: PlaceRequest): Promise<boolean> => {
    const query = place.bounds === "monitor" ? "get_outputs" : "get_workspaces";
    const workspaces = JSON.parse(await exec("swaymsg", ["-r", "-t", query], REQUEST_TIMEOUT_MS)) as Array<{ focused: boolean; rect: Rect }>;
    if (!Array.isArray(workspaces)) throw new Error("sway: malformed workspaces");
    const rects = workspaces.filter((w) => isRect(w?.rect));
    const area = (rects.find((w) => w.focused) ?? rects[0])?.rect;
    if (!area) throw new Error("sway: no workspace");
    const origin = overlayOrigin(area, place.width, place.margin, place.anchor);
    const criteria = `[pid=${pid} title="^${escapeSwayTitle(place.title)}$"]`;
    const command = `${criteria} floating enable, sticky ${place.pinned ? "enable" : "disable"}, border none, move absolute position ${origin.x} ${origin.y}`;
    for (let attempt = 0; attempt < LOOKUP_ATTEMPTS; attempt++) {
      const answer = JSON.parse(await exec("swaymsg", ["-r", command], REQUEST_TIMEOUT_MS)) as Array<{ success: boolean }>;
      if (Array.isArray(answer) && answer.length > 0 && answer.every((a) => typeof a === "object" && a !== null && a.success === true)) return true;
      await sleep(LOOKUP_DELAY_MS);
    }
    return false;
  };
}

export function createCompositorBridge(
  kind: CompositorKind,
  env: NodeJS.ProcessEnv,
  pid: number,
  log: (message: string) => void,
  exec?: Exec,
): CompositorBridge | null {
  if (kind !== "hyprland" && kind !== "sway") return null;
  const place = kind === "hyprland" ? createHyprlandPlacer(hyprSocketPath(env), pid) : createSwayPlacer(pid, exec);
  let lastFailure: string | null = null;
  return {
    kind,
    async placeOverlay(request) {
      try {
        const ok = await place(request);
        if (ok) lastFailure = null;
        return ok;
      } catch (error) {
        const message = String(error instanceof Error ? error.message : error);
        if (message !== lastFailure) log(`[compositor] ${message}`);
        lastFailure = message;
        return false;
      }
    },
  };
}
