import type { NotchAction } from "../../src/notch/contracts";
import type { SurfaceState } from "../../src/engine/types";
import { MAX_ACCELERATOR, MAX_BINDINGS, type Binding } from "./shortcuts";

const STATUSES = ["idle", "loading", "playing", "paused"] as const;
const PAUSE_REASONS = ["user", "device_lost", "autoplay_blocked", "sign_in", "network", "sleep"] as const;
const SOURCES = ["youtube", "soundcloud", "cache", "local"] as const;
const COVER_HOSTS = ["i.ytimg.com", "lh3.googleusercontent.com", "yt3.googleusercontent.com", "yt3.ggpht.com"];
const MAX_MS = 86_400_000;
const MAX_TEXT = 256;
export const ICON_MAX_BYTES = 2 * 1024 * 1024;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown, max = MAX_TEXT): v is string => typeof v === "string" && v.length <= max;
const ms = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= MAX_MS;
const oneOf = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === "string" && (list as readonly string[]).includes(v);

export function validSourcePage(url: unknown): url is string {
  if (typeof url !== "string") return false;
  return /^https:\/\/(music|www)\.youtube\.com\/watch\?v=[A-Za-z0-9_-]{11}$/.test(url) || /^https:\/\/soundcloud\.com\/\S{1,512}$/.test(url);
}

export function validPublicCover(url: unknown): url is string {
  if (typeof url !== "string" || url.length > 2048) return false;
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === "https:" && !parsed.username && !parsed.password && (COVER_HOSTS.includes(parsed.hostname) || parsed.hostname.endsWith(".sndcdn.com"))
    );
  } catch {
    return false;
  }
}

export function validateSurfaceState(raw: unknown): SurfaceState | null {
  if (!isObject(raw)) return null;
  const r = raw;
  if (!(r.trackId === null || text(r.trackId))) return null;
  if (!text(r.title) || !text(r.artists) || (r.album !== undefined && !text(r.album))) return null;
  if (!ms(r.durationMs) || !ms(r.positionMs) || typeof r.sampledAt !== "number" || !Number.isFinite(r.sampledAt)) return null;
  if (!oneOf(STATUSES, r.status) || (r.pauseReason !== undefined && !oneOf(PAUSE_REASONS, r.pauseReason))) return null;
  if (typeof r.liked !== "boolean" || !oneOf(SOURCES, r.source)) return null;
  if (r.sourcePageUrl !== undefined && !validSourcePage(r.sourcePageUrl)) return null;
  if (r.publicCoverUrl !== undefined && !validPublicCover(r.publicCoverUrl)) return null;
  let stream: SurfaceState["stream"];
  if (r.stream !== undefined) {
    const s = r.stream;
    if (!isObject(s) || !text(s.codec, 16) || typeof s.bitrateKbps !== "number" || !Number.isFinite(s.bitrateKbps) || s.bitrateKbps < 1 || s.bitrateKbps > 2000)
      return null;
    stream = { codec: s.codec, bitrateKbps: s.bitrateKbps };
  }
  if (!Array.isArray(r.upNext) || r.upNext.length > 3) return null;
  const upNext: SurfaceState["upNext"] = [];
  for (const item of r.upNext) {
    if (!isObject(item) || !text(item.id) || !text(item.title) || !text(item.artist) || typeof item.coverUrl !== "string" || !ms(item.durationMs)) return null;
    upNext.push({
      id: item.id,
      title: item.title,
      artist: item.artist,
      coverUrl: validPublicCover(item.coverUrl) ? item.coverUrl : "",
      durationMs: item.durationMs,
    });
  }
  return {
    trackId: r.trackId as string | null,
    title: r.title,
    artists: r.artists,
    ...(r.album !== undefined ? { album: r.album as string } : {}),
    durationMs: r.durationMs,
    positionMs: r.positionMs,
    sampledAt: r.sampledAt,
    status: r.status,
    ...(r.pauseReason !== undefined ? { pauseReason: r.pauseReason as SurfaceState["pauseReason"] } : {}),
    liked: r.liked,
    source: r.source,
    ...(r.sourcePageUrl !== undefined ? { sourcePageUrl: r.sourcePageUrl as string } : {}),
    ...(r.publicCoverUrl !== undefined ? { publicCoverUrl: r.publicCoverUrl as string } : {}),
    ...(stream ? { stream } : {}),
    upNext,
  };
}

export function validateIcon(raw: unknown): { pngDataUrl: string; stock: boolean } | null {
  if (!isObject(raw) || typeof raw.stock !== "boolean" || typeof raw.pngDataUrl !== "string") return null;
  const prefix = "data:image/png;base64,";
  if (!raw.pngDataUrl.startsWith(prefix)) return null;
  const base64 = raw.pngDataUrl.slice(prefix.length);
  if (Math.floor((base64.length * 3) / 4) > ICON_MAX_BYTES || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) return null;
  return { pngDataUrl: raw.pngDataUrl, stock: raw.stock };
}

export function validateBindings(raw: unknown): Binding[] | null {
  if (!Array.isArray(raw) || raw.length > MAX_BINDINGS) return null;
  const out: Binding[] = [];
  for (const item of raw) {
    if (!isObject(item) || typeof item.commandId !== "string" || !/^[a-z0-9.-]{1,64}$/.test(item.commandId)) return null;
    if (typeof item.accelerator !== "string" || item.accelerator.length > MAX_ACCELERATOR) return null;
    out.push({ commandId: item.commandId, accelerator: item.accelerator });
  }
  return out;
}

export function validateNotice(raw: unknown): { title: string; body: string } | null {
  if (!isObject(raw) || !text(raw.title, 120) || !text(raw.body, 400) || !raw.title.trim() || !raw.body.trim()) return null;
  return { title: raw.title, body: raw.body };
}

export class RateGate<T> {
  private windowStart = -Infinity;
  private count = 0;
  private held: T | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly perSecond: number,
    private readonly process: (value: T) => void,
    private readonly now: () => number,
  ) {}

  offer(value: T): void {
    const now = this.now();
    if (now - this.windowStart >= 1000) {
      this.windowStart = now;
      this.count = 0;
    }
    if (this.count < this.perSecond) {
      this.count += 1;
      this.process(value);
      return;
    }
    this.held = value;
    this.timer ??= setTimeout(
      () => {
        this.timer = null;
        const held = this.held;
        this.held = null;
        if (held !== null) this.offer(held);
      },
      this.windowStart + 1000 - now,
    );
  }
}

export class RefusalLog {
  private last = new Map<string, number>();
  constructor(
    private readonly log: (message: string) => void,
    private readonly now: () => number,
  ) {}
  refuse(channel: string, why: string): void {
    const at = this.last.get(channel) ?? -Infinity;
    if (this.now() - at < 60_000) return;
    this.last.set(channel, this.now());
    this.log(`[ipc] ${channel}: ${why}`);
  }
}

const TRACK_ID = /^[A-Za-z0-9_:.-]{1,64}$/;

/** Notch actions come from a window we do not fully trust: bounded numbers, patterned ids, unknown types refused. */
export function validateNotchAction(raw: unknown): NotchAction | null {
  if (!isObject(raw)) return null;
  switch (raw.type) {
    case "togglePlay":
    case "next":
    case "prev":
    case "like":
    case "focusApp":
      return { type: raw.type };
    case "seek":
      return ms(raw.positionMs) ? { type: "seek", positionMs: raw.positionMs } : null;
    case "volumeDelta":
      return typeof raw.delta === "number" && Number.isFinite(raw.delta) && raw.delta >= -1 && raw.delta <= 1
        ? { type: "volumeDelta", delta: raw.delta }
        : null;
    case "playUpNext":
      return typeof raw.trackId === "string" && TRACK_ID.test(raw.trackId) ? { type: "playUpNext", trackId: raw.trackId } : null;
    default:
      return null;
  }
}
