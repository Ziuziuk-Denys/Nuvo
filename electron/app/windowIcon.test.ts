import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FRAME_SIZES } from "@/data/look/presetIcons";
import { ICON_FRAMES, icoBytes, writeIco } from "./windowIcon";

const dirs: string[] = [];
const tempDir = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nuvo-ico-"));
  dirs.push(dir);
  return dir;
};
const frames = (seed: number) => ICON_FRAMES.map((size, at) => Buffer.alloc(size, seed + at));

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("window icon", () => {
  it("has the sizes the page draws", () => {
    expect(ICON_FRAMES).toEqual([...FRAME_SIZES]);
  });

  it("points every entry at its own frame", () => {
    const sent = frames(1);
    const ico = icoBytes(sent);
    expect(ico.readUInt16LE(2)).toBe(1);
    expect(ico.readUInt16LE(4)).toBe(ICON_FRAMES.length);
    sent.forEach((png, at) => {
      const entry = 6 + 16 * at;
      expect(ico.readUInt8(entry) || 256).toBe(ICON_FRAMES[at]);
      const offset = ico.readUInt32LE(entry + 12);
      expect(ico.subarray(offset, offset + ico.readUInt32LE(entry + 8)).equals(png)).toBe(true);
    });
  });

  it("keeps one file, under a new name for a new icon", () => {
    const dir = tempDir();
    fs.writeFileSync(path.join(dir, "mine.ico"), "x");
    const first = writeIco(dir, frames(1));
    const second = writeIco(dir, frames(2));
    expect(second).not.toBe(first);
    expect(fs.readdirSync(dir).sort()).toEqual(["mine.ico", path.basename(second)].sort());
  });
});
