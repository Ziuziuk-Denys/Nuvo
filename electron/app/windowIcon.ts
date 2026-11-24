import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const ICON_FRAMES = [16, 20, 24, 32, 40, 48, 64, 128, 256];

const HEADER = 6;
const ENTRY = 16;

export function icoBytes(frames: Buffer[]): Buffer {
  const head = Buffer.alloc(HEADER + ENTRY * frames.length);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(frames.length, 4);
  let offset = head.length;
  frames.forEach((png, at) => {
    const entry = HEADER + ENTRY * at;
    // 256 is written as 0, the byte holds no more
    head.writeUInt8(ICON_FRAMES[at] % 256, entry);
    head.writeUInt8(ICON_FRAMES[at] % 256, entry + 1);
    head.writeUInt16LE(1, entry + 4);
    head.writeUInt16LE(32, entry + 6);
    head.writeUInt32LE(png.length, entry + 8);
    head.writeUInt32LE(offset, entry + 12);
    offset += png.length;
  });
  return Buffer.concat([head, ...frames]);
}

export function writeIco(dir: string, frames: Buffer[]): string {
  const bytes = icoBytes(frames);
  const name = `window-${createHash("sha256").update(bytes).digest("hex").slice(0, 16)}.ico`;
  const file = path.join(dir, name);
  fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(file)) fs.writeFileSync(file, bytes);
  for (const other of fs.readdirSync(dir)) {
    if (other !== name && /^window-[0-9a-f]{16}\.ico$/.test(other)) fs.rmSync(path.join(dir, other), { force: true });
  }
  return file;
}
