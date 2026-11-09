import crypto from "node:crypto";
import { default as fs } from "node:fs";
import { default as path } from "node:path";

export type FontFormat = "ttf" | "otf" | "woff2";
export interface FontFileEntry {
  id: string;
  family: string;
  format: FontFormat;
  bytes: number;
  addedAt: number;
}
export type FontImportError = "too_large" | "empty" | "format" | "woff1" | "collection" | "damaged" | "limit" | "write";
export type FontImport = { ok: true; file: FontFileEntry } | { ok: false; error: FontImportError };

export const MAX_FONT_FILE_BYTES = 8 * 1024 * 1024;
/** At most `max` + 1 bytes are read, whatever the file does after a stat; a larger result means "too large". */
export function readCapped(file: string, max: number): Buffer {
  const fd = fs.openSync(file, "r");
  try {
    const buffer = Buffer.alloc(max + 1);
    return buffer.subarray(0, fs.readSync(fd, buffer, 0, max + 1, 0));
  } finally {
    fs.closeSync(fd);
  }
}

export const MAX_FONT_FILES = 20;
export const MAX_FONT_TOTAL_BYTES = 64 * 1024 * 1024;
export const FC_LIST_MAX_BYTES = 4 * 1024 * 1024;
const STORED = /^([0-9a-f]{64})\.(ttf|otf|woff2)$/;
const CONTENT_TYPE: Record<FontFormat, string> = { ttf: "font/ttf", otf: "font/otf", woff2: "font/woff2" };

/** fontconfig family names as the renderer may see them: printable, no CSS or markup syntax, at most 100 characters. */
export function cleanFamily(raw: string): string | null {
  const name = raw.trim();
  if (name.length === 0 || [...name].length > 100) return null;
  // eslint-disable-next-line no-control-regex
  return /[\u0000-\u001f\u007f-\u009f;{}<>"'\\]/.test(name) ? null : name;
}

export const FC_LIST_MAX_FAMILIES = 5000;
export function parseFcList(stdout: string): string[] {
  const names = new Set<string>();
  // execFile's maxBuffer is the first cap; this keeps the parser safe when called with anything else
  for (const line of stdout.slice(0, FC_LIST_MAX_BYTES).split("\n")) {
    if (names.size >= FC_LIST_MAX_FAMILIES) break;
    const family = cleanFamily(line.split(",")[0] ?? "");
    if (family) names.add(family);
  }
  return [...names].sort(new Intl.Collator(undefined, { sensitivity: "base" }).compare);
}

/** Table count 1..64 and every table inside the file: a truncated font fails here instead of in Chromium. */
function sfntTablesFit(buf: Buffer): boolean {
  if (buf.length < 12) return false;
  const count = buf.readUInt16BE(4);
  if (count < 1 || count > 64 || buf.length < 12 + count * 16) return false;
  for (let i = 0; i < count; i += 1) {
    const entry = 12 + i * 16;
    if (buf.readUInt32BE(entry + 8) + buf.readUInt32BE(entry + 12) > buf.length) return false;
  }
  return true;
}

/** The format from magic bytes, never from the extension. */
export function sniffFont(buf: Buffer): { ok: true; format: FontFormat } | { ok: false; error: FontImportError } {
  if (buf.length === 0) return { ok: false, error: "empty" };
  const magic = buf.subarray(0, 4).toString("latin1");
  if (magic === "wOFF") return { ok: false, error: "woff1" };
  if (magic === "ttcf") return { ok: false, error: "collection" };
  if (magic === "wOF2") {
    const fits = buf.length >= 48 && buf.readUInt32BE(8) === buf.length && buf.readUInt16BE(12) >= 1 && buf.readUInt16BE(12) <= 64;
    return fits ? { ok: true, format: "woff2" } : { ok: false, error: "damaged" };
  }
  const format = magic === "OTTO" ? "otf" : magic === "\u0000\u0001\u0000\u0000" || magic === "true" ? "ttf" : null;
  if (!format) return { ok: false, error: "format" };
  return sfntTablesFit(buf) ? { ok: true, format } : { ok: false, error: "damaged" };
}

export function familyFromNameTable(buf: Buffer): string | null {
  try {
    return readFamily(buf);
  } catch {
    return null;
  }
}

function readFamily(buf: Buffer): string | null {
  const count = buf.readUInt16BE(4);
  for (let i = 0; i < count; i += 1) {
    const entry = 12 + i * 16;
    if (buf.toString("latin1", entry, entry + 4) !== "name") continue;
    const table = buf.readUInt32BE(entry + 8);
    const records = buf.readUInt16BE(table + 2);
    const strings = table + buf.readUInt16BE(table + 4);
    for (const wanted of [16, 1]) {
      for (let r = 0; r < records; r += 1) {
        const rec = table + 6 + r * 12;
        if (rec + 12 > buf.length || buf.readUInt16BE(rec + 6) !== wanted) continue;
        const platform = buf.readUInt16BE(rec);
        const start = strings + buf.readUInt16BE(rec + 10);
        const length = buf.readUInt16BE(rec + 8);
        const bytes = buf.subarray(start, start + length);
        if (bytes.length !== length || (length % 2 === 1 && platform !== 1)) continue;
        const name = platform === 1 ? bytes.toString("latin1") : Buffer.from(bytes).swap16().toString("utf16le");
        const family = cleanFamily(name);
        if (family) return family;
      }
    }
  }
  return null;
}

/** `<userData>/fonts/<sha256>.<format>`: names come from the hash, so a user file name never reaches the disk. */
export class FontStore {
  constructor(
    private readonly dir: string,
    private readonly now: () => number = Date.now,
  ) {}

  private stored(): Array<{ id: string; format: FontFormat; bytes: number }> {
    let names: string[];
    try {
      names = fs.readdirSync(this.dir);
    } catch {
      return [];
    }
    return names.flatMap((name) => {
      const file = path.join(this.dir, name);
      // leftovers of an interrupted import are removed here so they cannot add up past the cap
      if (name.endsWith(".tmp")) {
        fs.rmSync(file, { force: true });
        return [];
      }
      const match = STORED.exec(name);
      if (!match) return [];
      try {
        const stat = fs.lstatSync(file);
        return stat.isFile() ? [{ id: match[1], format: match[2] as FontFormat, bytes: stat.size }] : [];
      } catch {
        return [];
      }
    });
  }

  /** `fileName` is only the display fallback for WOFF2, whose name table is compressed. */
  import(buf: Buffer, fileName: string): FontImport {
    if (buf.length > MAX_FONT_FILE_BYTES) return { ok: false, error: "too_large" };
    const sniffed = sniffFont(buf);
    if (!sniffed.ok) return sniffed;
    const id = crypto.createHash("sha256").update(buf).digest("hex");
    // shortcut: WOFF2 shows its file name; reading its name table needs the Brotli stream and the table transforms
    const family = (sniffed.format === "woff2" ? null : familyFromNameTable(buf)) ?? cleanFamily(path.parse(fileName).name) ?? "Font";
    const entry: FontFileEntry = { id, family, format: sniffed.format, bytes: buf.length, addedAt: this.now() };
    const existing = this.stored();
    if (existing.some((f) => f.id === id)) return { ok: true, file: entry };
    if (existing.length + 1 > MAX_FONT_FILES || existing.reduce((sum, f) => sum + f.bytes, 0) + buf.length > MAX_FONT_TOTAL_BYTES) {
      return { ok: false, error: "limit" };
    }
    const target = path.join(this.dir, `${id}.${sniffed.format}`);
    const temporary = `${target}.${process.pid}.tmp`;
    try {
      fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 });
      fs.writeFileSync(temporary, buf, { mode: 0o600 });
      fs.renameSync(temporary, target);
    } catch {
      try {
        fs.rmSync(temporary, { force: true });
      } catch {}
      return { ok: false, error: "write" };
    }
    return { ok: true, file: entry };
  }

  remove(id: string): boolean {
    const file = this.find(id);
    if (!file) return false;
    fs.rmSync(path.join(this.dir, `${file.id}.${file.format}`), { force: true });
    return true;
  }

  find(id: string): { id: string; format: FontFormat } | null {
    if (!/^[0-9a-f]{64}$/.test(id)) return null;
    return this.stored().find((f) => f.id === id) ?? null;
  }

  read(id: string): { body: Buffer; format: FontFormat } | null {
    const file = this.find(id);
    return file ? { body: fs.readFileSync(path.join(this.dir, `${file.id}.${file.format}`)), format: file.format } : null;
  }
}

/** `nuvo-core://local/fonts/<id>`: one stored font or 404; no listing, no other path. Origin rule as forwardToCore's. */
export function fontResponse(request: Request, store: FontStore, allowedOrigins: string[]): Response {
  const origin = request.headers.get("origin");
  if (origin !== null && !allowedOrigins.includes(origin)) return new Response(null, { status: 403 });
  const match = /^\/fonts\/([^/]+)$/.exec(new URL(request.url).pathname);
  const font = match && request.method === "GET" ? store.read(match[1]) : null;
  if (!font) return new Response(null, { status: 404, headers: origin ? { "access-control-allow-origin": origin } : {} });
  return new Response(new Uint8Array(font.body), {
    status: 200,
    headers: {
      "content-type": CONTENT_TYPE[font.format],
      "x-content-type-options": "nosniff",
      "cache-control": "private, max-age=31536000, immutable",
      ...(origin ? { "access-control-allow-origin": origin, vary: "Origin" } : {}),
    },
  });
}

const RESCAN_MS = 30_000;

export class SystemFonts {
  private pending: Promise<{ ok: true; families: string[] } | { ok: false }> | null = null;
  private failed = false;
  private scannedAt = 0;

  constructor(
    private readonly scan: () => Promise<{ ok: true; families: string[] } | { ok: false }>,
    private readonly now: () => number = Date.now,
  ) {}

  get(rescan: boolean): Promise<{ ok: true; families: string[] } | { ok: false }> {
    const due = this.now() - this.scannedAt >= RESCAN_MS;
    if (!this.pending || (due && (rescan || this.failed))) {
      this.scannedAt = this.now();
      this.pending = this.scan().then((result) => {
        this.failed = !result.ok;
        return result;
      });
    }
    return this.pending;
  }
}
