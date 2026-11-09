import fs from "node:fs";
import { sanitizeCss } from "../../src/data/look/appearance/cssSanitizer";

/** 16 KB of colours plus the 32 KB of CSS a shared theme may carry; the same cap as the renderer's parser. */
export const MAX_THEME_FILE_BYTES = 48 * 1024;
export type ThemeFileRead = { ok: true; text: string } | { ok: false; error: "cancelled" | "theme_size" | "theme_encoding" | "theme_css" };

export function themeFileName(name: string): string {
  // eslint-disable-next-line no-control-regex
  const base = name
    .replace(/[\u0000-\u001f\u007f/\\:*?"<>|]/g, "-")
    .replace(/^\.+/, "")
    .trim()
    .slice(0, 40);
  return `${base || "theme"}.nuvotheme.json`;
}

export function validateThemeExport(raw: unknown): { name: string; text: string } | null {
  const r = raw as { name?: unknown; text?: unknown } | null;
  if (typeof r?.name !== "string" || r.name.length > 40 || typeof r.text !== "string") return null;
  return Buffer.byteLength(r.text, "utf8") <= MAX_THEME_FILE_BYTES ? { name: r.name, text: r.text } : null;
}

/** At most `max` + 1 bytes are ever read, whatever the file does between a stat and the read. */
function readCapped(file: string, max: number): Buffer {
  const fd = fs.openSync(file, "r");
  try {
    const buffer = Buffer.alloc(max + 1);
    const read = fs.readSync(fd, buffer, 0, max + 1, 0);
    return buffer.subarray(0, read);
  } finally {
    fs.closeSync(fd);
  }
}

export function readThemeFile(file: string): ThemeFileRead {
  let bytes: Buffer;
  try {
    bytes = readCapped(file, MAX_THEME_FILE_BYTES);
  } catch {
    return { ok: false, error: "theme_encoding" };
  }
  if (bytes.length > MAX_THEME_FILE_BYTES) return { ok: false, error: "theme_size" };
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return { ok: false, error: "theme_encoding" };
  }
  // untrusted CSS is checked here and again by the renderer's parser; a bad sheet never reaches the editor
  try {
    const css = (JSON.parse(text) as { css?: unknown } | null)?.css;
    if (typeof css === "string" && css.length > 0 && !sanitizeCss(css).ok) return { ok: false, error: "theme_css" };
  } catch {}
  return { ok: true, text };
}

/** Temporary file in the same folder, then a rename: a failure never leaves half a theme or loses the old file. */
export function writeThemeFile(target: string, text: string): boolean {
  const temporary = `${target}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temporary, text, { mode: 0o600 });
    fs.renameSync(temporary, target);
    return true;
  } catch {
    try {
      fs.rmSync(temporary, { force: true });
    } catch {}
    return false;
  }
}
