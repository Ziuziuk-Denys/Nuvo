/** Payloads of the save and export channels: ids and choices only; every path comes from a dialog in main. */
import { default as fs } from "node:fs";
import { default as path } from "node:path";
import type { SaveDocumentRequest, SaveFilesRequest } from "../../src/shell/nuvoShell";

export const LOCAL_ID = /^local:[0-9a-f]{32}$/;
const TRACK_ID = /^[A-Za-z0-9_:.-]{1,64}$/;
const ENTITY_ID = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_TRACKS = 5000;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const label = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 256;

export function validateSaveFiles(raw: unknown): SaveFilesRequest | null {
  if (!isObject(raw) || !label(raw.label) || (raw.format !== "original" && raw.format !== "mp3") || typeof raw.playlistFile !== "boolean") return null;
  const base = { label: raw.label, format: raw.format, playlistFile: raw.playlistFile } as const;
  if (Array.isArray(raw.trackIds)) {
    const ids = raw.trackIds;
    if (ids.length === 0 || ids.length > MAX_TRACKS || !ids.every((id) => typeof id === "string" && TRACK_ID.test(id) && !id.includes(".."))) return null;
    return { trackIds: ids as string[], ...base };
  }
  if (typeof raw.playlistId === "string" && ENTITY_ID.test(raw.playlistId)) return { playlistId: raw.playlistId, ...base };
  if (raw.liked === true) return { liked: true, ...base };
  return null;
}

const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function validateSaveDocument(raw: unknown): SaveDocumentRequest | null {
  if (!isObject(raw)) return null;
  if (raw.kind === "library" && (raw.format === "json" || raw.format === "csv")) return { kind: "library", format: raw.format };
  if (raw.kind === "stats" && (raw.format === "json" || raw.format === "csv")) {
    if (raw.from === undefined && raw.to === undefined) return { kind: "stats", format: raw.format };
    if (typeof raw.from === "string" && typeof raw.to === "string" && LOCAL_DATE.test(raw.from) && LOCAL_DATE.test(raw.to)) {
      return { kind: "stats", format: raw.format, from: raw.from, to: raw.to };
    }
    return null;
  }
  if (
    raw.kind === "playlist" &&
    typeof raw.id === "string" &&
    ENTITY_ID.test(raw.id) &&
    label(raw.title) &&
    (raw.format === "m3u8" || raw.format === "csv" || raw.format === "json")
  ) {
    return { kind: "playlist", id: raw.id, title: raw.title, format: raw.format };
  }
  return null;
}

/** The save dialog's suggested name. */
export function documentName(title: string, format: "m3u8" | "csv" | "json"): string {
  // eslint-disable-next-line no-control-regex
  const clean = title
    .replace(/[\u0000-\u001f/\\:*?"<>|]/g, "_")
    .replace(/^[.\s]+|[.\s]+$/g, "")
    .slice(0, 120);
  return `${clean || "Nuvo"}.${format}`;
}

/** Temporary file next to the target (exclusive, never through a link), fsync, rename: a failed save never leaves half a file. */
export async function writeBufferAtomic(target: string, body: Buffer): Promise<void> {
  const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.tmp`);
  try {
    const handle = await fs.promises.open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(body);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.promises.rename(temporary, target);
  } catch (error) {
    await fs.promises.rm(temporary, { force: true });
    throw error;
  }
}
