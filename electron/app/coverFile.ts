/** A playlist cover picked in main's dialog: read with a cap and sniffed by signature; the renderer gets bytes, never a path. */
import fs from "node:fs";

/** The source image before the renderer shrinks it to 600 x 600. */
export const MAX_COVER_SOURCE_BYTES = 20 * 1024 * 1024;
export type CoverRead =
  { ok: true; bytes: Uint8Array; mime: "image/png" | "image/jpeg" | "image/webp" } | { ok: false; error: "cancelled" | "too_large" | "format" | "damaged" };

function sniff(b: Buffer): "image/png" | "image/jpeg" | "image/webp" | null {
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 12 && b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WEBP") return "image/webp";
  return null;
}

export function readCoverFile(file: string): CoverRead {
  let bytes: Buffer;
  try {
    // O_NOFOLLOW refuses a symlink and O_NONBLOCK keeps a FIFO from stalling the open; only a regular file is read
    const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    try {
      const stat = fs.fstatSync(fd);
      if (!stat.isFile()) return { ok: false, error: "damaged" };
      if (stat.size > MAX_COVER_SOURCE_BYTES) return { ok: false, error: "too_large" };
      // at most cap + 1 bytes are read, whatever the file does after the stat
      const buffer = Buffer.alloc(Math.min(stat.size, MAX_COVER_SOURCE_BYTES) + 1);
      bytes = buffer.subarray(0, fs.readSync(fd, buffer, 0, buffer.length, 0));
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return { ok: false, error: "damaged" };
  }
  if (bytes.length > MAX_COVER_SOURCE_BYTES) return { ok: false, error: "too_large" };
  const mime = sniff(bytes);
  return mime ? { ok: true, bytes: new Uint8Array(bytes), mime } : { ok: false, error: "format" };
}
