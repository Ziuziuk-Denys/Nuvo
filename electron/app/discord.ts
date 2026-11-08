/** Discord presence over the documented local RPC protocol. Off by default, no library. */
import { default as net } from "node:net";
import { default as path } from "node:path";
import type { SurfaceState } from "../../src/engine/types";

/** Public application id; empty keeps presence inert ("not configured in this build"). */
export const DISCORD_APPLICATION_ID = "1568940310556573696";
export const RETRY_MS = 30_000;
export const UPDATE_INTERVAL_MS = 4000;
export const SEEK_THRESHOLD_MS = 2000;
export const MAX_FRAME = 64 * 1024;

export const OP = { handshake: 0, frame: 1, close: 2, ping: 3, pong: 4 } as const;

export function encodeFrame(op: number, payload: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  const header = Buffer.alloc(8);
  header.writeUInt32LE(op, 0);
  header.writeUInt32LE(body.length, 4);
  return Buffer.concat([header, body]);
}

/** Reassembles frames split across chunks and splits several frames in one chunk. */
export class FrameDecoder {
  private buffer = Buffer.alloc(0);

  push(chunk: Buffer): Array<{ op: number; payload: unknown }> {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const frames: Array<{ op: number; payload: unknown }> = [];
    while (this.buffer.length >= 8) {
      const op = this.buffer.readUInt32LE(0);
      const length = this.buffer.readUInt32LE(4);
      if (length > MAX_FRAME) throw new Error("discord frame too large");
      if (this.buffer.length < 8 + length) break;
      const body = this.buffer.subarray(8, 8 + length).toString("utf8");
      this.buffer = this.buffer.subarray(8 + length);
      frames.push({ op, payload: JSON.parse(body) });
    }
    return frames;
  }
}

/** 80 candidates: two bases, four places, ten numbers; on Windows ten named pipes. */
export function socketCandidates(env: NodeJS.ProcessEnv, platform: NodeJS.Platform = process.platform): string[] {
  if (platform === "win32") return Array.from({ length: 10 }, (_, n) => `\\\\?\\pipe\\discord-ipc-${n}`);
  const bases = [env.XDG_RUNTIME_DIR, "/tmp"].filter((b): b is string => Boolean(b));
  const places = ["", "app/com.discordapp.Discord", "snap.discord", ".flatpak/dev.vencord.Vesktop/xdg-run"];
  const out: string[] = [];
  for (const base of bases) for (const place of places) for (let n = 0; n < 10; n++) out.push(path.join(base, place, `discord-ipc-${n}`));
  return out;
}

function fit(text: string): string {
  const chars = Array.from(text);
  const cut = chars.slice(0, 128).join("");
  return cut.length >= 2 ? cut : cut.padEnd(2, " ");
}

function sanitizeImageUrl(url?: string): string | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return undefined;
    if (parsed.username || parsed.password) return undefined;
    const host = parsed.hostname || "";
    if (!["i.ytimg.com", "lh3.googleusercontent.com", "yt3.googleusercontent.com"].includes(host)) return undefined;
    return parsed.toString();
  } catch {
    return undefined;
  }
}

function sanitizePageUrl(url?: string, maxLen = 512): string | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return undefined;
    if (parsed.username || parsed.password) return undefined;
    const str = parsed.toString();
    return str.length <= maxLen ? str : undefined;
  } catch {
    return undefined;
  }
}

function capLabel(text: string): string {
  return Array.from(text).slice(0, 32).join("");
}

export interface Activity {
  type: 2;
  details: string;
  state: string;
  timestamps: { start: number; end: number };
  assets: { large_image: string; large_text?: string };
  buttons?: Array<{ label: string; url: string }>;
}

/** Public metadata only; null for pause, idle and no track. */
export function buildActivity(state: SurfaceState, now: number): Activity | null {
  if (!state.trackId || state.status !== "playing") return null;
  const start = now - state.positionMs;
  const imageUrl = sanitizeImageUrl(state.publicCoverUrl) ?? "nuvo";
  const pageUrl = sanitizePageUrl(state.sourcePageUrl);
  return {
    type: 2,
    details: fit(state.title),
    state: fit(state.artists),
    timestamps: { start, end: start + state.durationMs },
    assets: { large_image: imageUrl, ...(state.album ? { large_text: fit(state.album) } : {}) },
    ...(pageUrl ? { buttons: [{ label: capLabel("Open track"), url: pageUrl }] } : {}),
  };
}

export type DiscordStatus = { state: "off" | "connecting" | "connected" | "no_client" | "error"; message?: string };

export interface PresenceDeps {
  applicationId: string;
  candidates(): string[];
  connect(socketPath: string): net.Socket;
  now(): number;
  pid: number;
  log(message: string): void;
}

export class DiscordPresence {
  private enabled = false;
  private socket: net.Socket | null = null;
  private ready = false;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private status: DiscordStatus = { state: "off" };
  private latest: SurfaceState | null = null;
  private lastSentKey: string | null = null;
  private lastSentAt = -Infinity;
  private lastSentActivity: Activity | null = null;
  private pending: ReturnType<typeof setTimeout> | null = null;
  private nonce = 0;
  private loggedNoClient = false;
  private connectGen = 0;
  private handshakeTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly deps: PresenceDeps) {}

  get current(): DiscordStatus {
    return this.status;
  }

  setEnabled(enabled: boolean): void {
    if (enabled === this.enabled) return;
    this.enabled = enabled;
    if (!enabled) return this.stop();
    if (!this.deps.applicationId) {
      this.status = { state: "off", message: "Discord presence is not configured in this build." };
      return;
    }
    void this.connect();
  }

  update(state: SurfaceState): void {
    this.latest = state;
    if (!this.ready) return;
    const activity = buildActivity(state, this.deps.now());
    const key = activity ? `${state.trackId}|${state.status}` : "none";
    const drifted =
      activity && this.lastSentActivity ? Math.abs(activity.timestamps.start - this.lastSentActivity.timestamps.start) > SEEK_THRESHOLD_MS : false;
    if (key === this.lastSentKey && !drifted) return;
    this.schedule();
  }

  private schedule(): void {
    if (this.pending) return;
    const wait = this.lastSentAt + UPDATE_INTERVAL_MS - this.deps.now();
    if (wait <= 0) return this.send();
    this.pending = setTimeout(() => {
      this.pending = null;
      this.send();
    }, wait);
  }

  private send(): void {
    if (!this.socket || !this.ready || !this.latest) return;
    const activity = buildActivity(this.latest, this.deps.now());
    this.lastSentKey = activity ? `${this.latest.trackId}|${this.latest.status}` : "none";
    this.lastSentActivity = activity;
    this.lastSentAt = this.deps.now();
    this.socket.write(encodeFrame(OP.frame, { cmd: "SET_ACTIVITY", args: { pid: this.deps.pid, activity }, nonce: String(++this.nonce) }));
  }

  private async connect(): Promise<void> {
    if (!this.enabled) return;
    const gen = ++this.connectGen;
    this.status = { state: "connecting" };
    for (const candidate of this.deps.candidates()) {
      const socket = await new Promise<net.Socket | null>((resolve) => {
        const s = this.deps.connect(candidate);
        s.once("connect", () => resolve(s));
        s.once("error", () => resolve(null));
      });
      if (!socket) continue;
      if (!this.enabled || gen !== this.connectGen) {
        socket.destroy();
        return;
      }
      this.attach(socket, gen);
      return;
    }
    if (gen !== this.connectGen) return;
    this.status = { state: "no_client", message: "Discord is not running" };
    if (!this.loggedNoClient) this.deps.log("[discord] no client");
    this.loggedNoClient = true;
    this.scheduleRetry();
  }

  private attach(socket: net.Socket, gen: number): void {
    if (gen !== this.connectGen) {
      socket.destroy();
      return;
    }
    this.socket = socket;
    const decoder = new FrameDecoder();
    socket.on("data", (chunk: Buffer) => {
      try {
        for (const frame of decoder.push(chunk)) this.onFrame(socket, frame.op, frame.payload as Record<string, unknown>);
      } catch (error) {
        this.fail(error instanceof Error ? error.message : "bad frame");
      }
    });
    socket.on("close", () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.ready = false;
      if (this.handshakeTimer) {
        clearTimeout(this.handshakeTimer);
        this.handshakeTimer = null;
      }
      if (this.enabled) {
        this.status = { state: "connecting" };
        this.scheduleRetry();
      }
    });
    socket.on("error", () => undefined);
    this.handshakeTimer = setTimeout(() => {
      if (this.socket === socket) this.fail("handshake timeout");
    }, 10_000);
    socket.write(encodeFrame(OP.handshake, { v: 1, client_id: this.deps.applicationId }));
  }

  private onFrame(socket: net.Socket, op: number, payload: Record<string, unknown>): void {
    if (op === OP.ping) {
      socket.write(encodeFrame(OP.pong, payload));
      return;
    }
    if (op === OP.close) return this.fail(String(payload.message ?? "closed"));
    if (payload.evt === "READY") {
      if (this.handshakeTimer) {
        clearTimeout(this.handshakeTimer);
        this.handshakeTimer = null;
      }
      this.ready = true;
      this.status = { state: "connected" };
      this.loggedNoClient = false;
      this.lastSentKey = null;
      this.lastSentAt = -Infinity;
      if (this.latest) this.send();
      return;
    }
    if (payload.evt === "ERROR") this.status = { state: "error", message: String((payload.data as { message?: string })?.message ?? "error") };
  }

  private fail(message: string): void {
    this.status = { state: "error", message };
    const socket = this.socket;
    this.socket = null;
    this.ready = false;
    socket?.destroy();
    this.scheduleRetry();
  }

  private scheduleRetry(): void {
    if (this.retry || !this.enabled) return;
    this.retry = setTimeout(() => {
      this.retry = null;
      void this.connect();
    }, RETRY_MS);
  }

  /** Disable or quit: a close frame, the socket closes, no timer remains. */
  stop(): void {
    this.enabled = false;
    if (this.retry) clearTimeout(this.retry);
    if (this.pending) clearTimeout(this.pending);
    if (this.handshakeTimer) clearTimeout(this.handshakeTimer);
    this.retry = null;
    this.pending = null;
    this.handshakeTimer = null;
    const socket = this.socket;
    this.socket = null;
    this.ready = false;
    if (socket) {
      socket.end(encodeFrame(OP.close, {}));
    }
    this.status = { state: "off" };
  }

  get hasTimers(): boolean {
    return this.retry !== null || this.pending !== null;
  }
}
