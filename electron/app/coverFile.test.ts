// @vitest-environment node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MAX_COVER_SOURCE_BYTES, readCoverFile } from "./coverFile";

const dirs: string[] = [];
const write = (bytes: Buffer) => {
  const dir = fs.mkdtempSync(path.join(tmpdir(), "nuvo-cover-"));
  dirs.push(dir);
  const file = path.join(dir, "pic");
  fs.writeFileSync(file, bytes);
  return file;
};
afterEach(() => dirs.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.from([0, 0, 0, 0]), Buffer.from("WEBP")]);

describe("readCoverFile", () => {
  it("reads png, jpeg and webp by their signature, not their name", () => {
    expect(readCoverFile(write(PNG))).toMatchObject({ ok: true, mime: "image/png" });
    expect(readCoverFile(write(JPEG))).toMatchObject({ ok: true, mime: "image/jpeg" });
    expect(readCoverFile(write(WEBP))).toMatchObject({ ok: true, mime: "image/webp" });
  });

  it("refuses other content, empty files and files over the cap", () => {
    expect(readCoverFile(write(Buffer.from("<svg onload=alert(1)>")))).toEqual({ ok: false, error: "format" });
    expect(readCoverFile(write(Buffer.alloc(0)))).toEqual({ ok: false, error: "format" });
    expect(readCoverFile(write(Buffer.concat([PNG, Buffer.alloc(MAX_COVER_SOURCE_BYTES)])))).toEqual({ ok: false, error: "too_large" });
  });

  it("reports a file that cannot be read", () => {
    expect(readCoverFile(path.join(tmpdir(), "nuvo-cover-missing", "x"))).toEqual({ ok: false, error: "damaged" });
  });

  it("refuses a symlink, even one that points at a real image", () => {
    const target = write(PNG);
    const link = path.join(path.dirname(target), "link");
    fs.symlinkSync(target, link);
    expect(readCoverFile(link)).toEqual({ ok: false, error: "damaged" });
  });

  it("refuses a directory and a FIFO without waiting on either", () => {
    const dir = fs.mkdtempSync(path.join(tmpdir(), "nuvo-cover-"));
    dirs.push(dir);
    expect(readCoverFile(dir)).toEqual({ ok: false, error: "damaged" });
    const fifo = path.join(dir, "pipe");
    execFileSync("mkfifo", [fifo]);
    expect(readCoverFile(fifo)).toEqual({ ok: false, error: "damaged" });
  });
});
