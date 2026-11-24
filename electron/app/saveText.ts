import { default as fs } from "node:fs";
import { default as path } from "node:path";

/** About 20,000 report rows with long titles fit well below this. */
export const MAX_SAVE_TEXT_CHARS = 32 * 1024 * 1024;
const MAX_NAME_CHARS = 120;

const FILTERS: Record<string, string> = { csv: "CSV", txt: "Text", lrc: "LRC", ttml: "TTML" };

export interface SaveText {
  name: string;
  text: string;
}

export function saveFilter(name: string): { name: string; extensions: string[] } {
  const extension = path.extname(name).slice(1).toLowerCase();
  return { name: FILTERS[extension] ?? "Text", extensions: [extension] };
}

/** A `.csv`, `.txt`, `.lrc` or `.ttml` base name (no folders, no hidden files) and text under the cap; null otherwise. */
export function validateSaveText(payload: unknown): SaveText | null {
  const { name, text } = (payload ?? {}) as { name?: unknown; text?: unknown };
  if (typeof name !== "string" || typeof text !== "string" || text.length > MAX_SAVE_TEXT_CHARS) return null;
  const base = name.replace(/[\\/]/g, " ").trim();
  if (!base || base.length > MAX_NAME_CHARS || base.startsWith(".") || !/\.(csv|txt|lrc|ttml)$/i.test(base)) return null;
  return { name: base, text };
}

/** Temporary file next to the target, fsync, rename: a failed save never leaves half a file or loses the old one. */
export async function writeTextAtomic(target: string, text: string): Promise<void> {
  const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.tmp`);
  try {
    const handle = await fs.promises.open(temporary, "w", 0o600);
    try {
      await handle.writeFile(text, "utf8");
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
