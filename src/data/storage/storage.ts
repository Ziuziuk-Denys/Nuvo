import { CORE_BASE_URL, coreRequest } from "@/data/core/request";
import { CoreError } from "@/imports/core";

export type StorageCategoryId = "audio" | "covers" | "web";

export interface StorageCategory {
  id: StorageCategoryId;
  bytes: number;
  color: string;
  labelKey: string;
}

export interface StorageAnalytics {
  categories: StorageCategory[];
  totalBytes: number;
  limitBytes: number;
}

interface CacheStatus {
  usedBytes: number;
  limitBytes: number;
  covers: { bytes: number };
}

export const STORAGE_REFRESH_MS = 5_000;
const ORDER: StorageCategoryId[] = ["audio", "covers", "web"];
const COLORS: Record<StorageCategoryId, string> = { audio: "#0071e3", covers: "#34c759", web: "#ff9f0a" };
const LABELS: Record<StorageCategoryId, string> = {
  audio: "ui.settings.storage_audio",
  covers: "ui.settings.storage_covers",
  web: "ui.settings.storage_web",
};

let cached: StorageAnalytics | null = null;
let limitBytes = 0;
let timer: ReturnType<typeof setInterval> | null = null;

export function getCachedStorageAnalytics(): StorageAnalytics | null {
  return cached;
}

export function getAudioCacheLimitBytes(): number {
  return limitBytes;
}

async function readDaemon(): Promise<CacheStatus | null> {
  try {
    return await coreRequest<CacheStatus>("GET", "/v1/cache/status");
  } catch {
    return null;
  }
}

async function readWeb(): Promise<number> {
  try {
    const usage = await window.nuvoShell?.chromiumUsage();
    return usage ? usage.httpCacheBytes + usage.codeCacheBytes + usage.serviceWorkerBytes + usage.blobBytes : 0;
  } catch {
    return 0;
  }
}

export async function refreshStorageAnalytics(): Promise<StorageAnalytics> {
  const [status, web] = await Promise.all([readDaemon(), readWeb()]);
  if (status) limitBytes = status.limitBytes;
  const bytes: Record<StorageCategoryId, number> = { audio: status?.usedBytes ?? 0, covers: status?.covers.bytes ?? 0, web };
  const categories = ORDER.map((id) => ({ id, bytes: bytes[id], color: COLORS[id], labelKey: LABELS[id] }));
  cached = { categories, totalBytes: categories.reduce((sum, category) => sum + category.bytes, 0), limitBytes };
  return cached;
}

export function setStorageTabOpen(open: boolean): void {
  if (open && !timer) timer = setInterval(() => void refreshStorageAnalytics(), STORAGE_REFRESH_MS);
  if (!open && timer) {
    clearInterval(timer);
    timer = null;
  }
}

const CLEAR: Record<StorageCategoryId, () => Promise<void>> = {
  audio: () => coreRequest<void>("DELETE", "/v1/cache/audio"),
  covers: () => coreRequest<void>("DELETE", "/v1/cache/covers"),
  web: async () => {
    if ((await window.nuvoShell?.clearChromiumCache()) === false) throw new Error("web cache not cleared");
  },
};

export async function clearStorageCategories(ids: readonly StorageCategoryId[]): Promise<void> {
  for (const id of ORDER) if (ids.includes(id)) await CLEAR[id]();
}

export async function openCacheFolder(): Promise<void> {
  const usage = await window.nuvoShell?.chromiumUsage();
  if (usage?.path) await window.nuvoShell?.reveal(usage.path);
}

const UNITS = ["B", "KB", "MB", "GB", "TB"];

export function formatStorageBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  if (unit === 0) return `${Math.round(value)} B`;
  const shown = value < 10 ? value.toFixed(1).replace(/\.0$/, "") : String(Math.round(value));
  return `${shown} ${UNITS[unit]}`;
}

export async function setAudioCacheLimitBytes(bytes: number): Promise<void> {
  const status = await coreRequest<CacheStatus>("PATCH", "/v1/cache/settings", { limitBytes: bytes });
  limitBytes = status.limitBytes;
}

const audioPath = (id: string) => `/v1/cache/audio/${encodeURIComponent(id)}`;

export async function hasCachedAudio(id: string): Promise<boolean> {
  // a local file never sits in the cache, and asking only logs a 404
  if (id.startsWith("local:")) return false;
  try {
    const response = await fetch(`${CORE_BASE_URL}${audioPath(id)}`, { headers: { range: "bytes=0-0" } });
    return response.status === 200 || response.status === 206;
  } catch {
    return false;
  }
}

export async function deleteCachedAudio(id: string): Promise<void> {
  try {
    await coreRequest<void>("DELETE", audioPath(id));
  } catch (error) {
    if (!(error instanceof CoreError && error.status === 404)) throw error;
  }
}
