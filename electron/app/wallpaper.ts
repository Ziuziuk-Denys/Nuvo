import crypto from "node:crypto";
import { default as fs } from "node:fs";
import { default as path } from "node:path";
import { Readable } from "node:stream";

export type WallpaperFormat = "png" | "jpg" | "webp" | "avif" | "gif" | "mp4" | "webm";
export type WallpaperImportError = "too_large" | "empty" | "format" | "read" | "write";
export type WallpaperImport = { ok: true; name: string } | { ok: false; error: WallpaperImportError };

export const MAX_IMAGE_BYTES = 30 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 200 * 1024 * 1024;
const HEAD_BYTES = 64;
const STORED = /^[0-9a-f-]{36}\.(png|jpg|webp|avif|gif|mp4|webm)$/;
const CONTENT_TYPE: Record<WallpaperFormat, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
  avif: "image/avif",
  gif: "image/gif",
  mp4: "video/mp4",
  webm: "video/webm",
};

const isVideo = (format: WallpaperFormat) => format === "mp4" || format === "webm";

// QuickTime and Matroska are refused: Chromium plays neither reliably
export function sniffWallpaper(head: Buffer): WallpaperFormat | null {
  const text = head.toString("latin1");
  if (text.startsWith("\x89PNG\r\n\x1a\n")) return "png";
  if (text.startsWith("\xff\xd8\xff")) return "jpg";
  if (text.startsWith("GIF87a") || text.startsWith("GIF89a")) return "gif";
  if (text.startsWith("RIFF") && text.slice(8, 12) === "WEBP") return "webp";
  if (text.startsWith("\x1a\x45\xdf\xa3")) return text.includes("webm") ? "webm" : null;
  if (text.slice(4, 8) !== "ftyp") return null;
  const brand = text.slice(8, 12);
  if (brand === "avif" || brand === "avis") return "avif";
  return brand === "qt  " ? null : "mp4";
}

export function parseRange(header: string | null, size: number): { start: number; end: number } | null | "unsatisfiable" {
  const match = header ? /^bytes=(\d*)-(\d*)$/.exec(header.trim()) : null;
  if (!match || (match[1] === "" && match[2] === "")) return null;
  const start = match[1] === "" ? Math.max(0, size - Number(match[2])) : Number(match[1]);
  const end = match[1] === "" || match[2] === "" ? size - 1 : Math.min(Number(match[2]), size - 1);
  return start > end || start >= size ? "unsatisfiable" : { start, end };
}

export class WallpaperStore {
  constructor(private readonly dir: string) {}

  async import(source: string): Promise<WallpaperImport> {
    let head: Buffer;
    let size: number;
    try {
      const handle = await fs.promises.open(source, "r");
      try {
        const stat = await handle.stat();
        if (!stat.isFile()) return { ok: false, error: "format" };
        size = stat.size;
        const buffer = Buffer.alloc(HEAD_BYTES);
        head = buffer.subarray(0, (await handle.read(buffer, 0, HEAD_BYTES, 0)).bytesRead);
      } finally {
        await handle.close();
      }
    } catch {
      return { ok: false, error: "read" };
    }
    if (size === 0) return { ok: false, error: "empty" };
    const format = sniffWallpaper(head);
    if (!format) return { ok: false, error: "format" };
    const cap = isVideo(format) ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
    if (size > cap) return { ok: false, error: "too_large" };

    const name = `${crypto.randomUUID()}.${format}`;
    const target = path.join(this.dir, name);
    const temporary = `${target}.tmp`;
    try {
      await fs.promises.mkdir(this.dir, { recursive: true, mode: 0o700 });
      await fs.promises.copyFile(source, temporary);
      // the file may have grown after the first look
      if ((await fs.promises.stat(temporary)).size > cap) {
        await fs.promises.rm(temporary, { force: true });
        return { ok: false, error: "too_large" };
      }
      await fs.promises.rename(temporary, target);
    } catch {
      await fs.promises.rm(temporary, { force: true }).catch(() => undefined);
      return { ok: false, error: "write" };
    }
    await this.clear(name);
    return { ok: true, name };
  }

  async clear(keep?: string): Promise<void> {
    const names = await fs.promises.readdir(this.dir).catch(() => [] as string[]);
    await Promise.all(names.filter((name) => name !== keep).map((name) => fs.promises.rm(path.join(this.dir, name), { force: true }).catch(() => undefined)));
  }

  find(name: string): { file: string; format: WallpaperFormat } | null {
    if (!STORED.test(name)) return null;
    const file = path.join(this.dir, name);
    return fs.existsSync(file) ? { file, format: path.extname(name).slice(1) as WallpaperFormat } : null;
  }
}

// byte ranges let a video seek and loop
export async function wallpaperResponse(request: Request, store: WallpaperStore, allowedOrigins: string[]): Promise<Response> {
  const origin = request.headers.get("origin");
  if (origin !== null && !allowedOrigins.includes(origin)) return new Response(null, { status: 403 });
  const cors: Record<string, string> = origin ? { "access-control-allow-origin": origin, vary: "Origin" } : {};
  const match = /^\/wallpaper\/([^/]+)$/.exec(new URL(request.url).pathname);
  const found = match && request.method === "GET" ? store.find(match[1]) : null;
  const size = found
    ? await fs.promises.stat(found.file).then(
        (stat) => stat.size,
        () => null,
      )
    : null;
  if (!found || size === null) return new Response(null, { status: 404, headers: cors });
  const range = parseRange(request.headers.get("range"), size);
  if (range === "unsatisfiable") return new Response(null, { status: 416, headers: { ...cors, "content-range": `bytes */${size}` } });
  const { start, end } = range ?? { start: 0, end: size - 1 };
  const body = Readable.toWeb(fs.createReadStream(found.file, { start, end })) as ReadableStream<Uint8Array>;
  return new Response(body, {
    status: range ? 206 : 200,
    headers: {
      ...cors,
      "content-type": CONTENT_TYPE[found.format],
      "content-length": String(end - start + 1),
      "accept-ranges": "bytes",
      "x-content-type-options": "nosniff",
      "cache-control": "private, max-age=31536000, immutable",
      ...(range ? { "content-range": `bytes ${start}-${end}/${size}` } : {}),
    },
  });
}
