// @vitest-environment node
import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MAX_IMAGE_BYTES, parseRange, sniffWallpaper, WallpaperStore, wallpaperResponse } from "./wallpaper";

const PNG = Buffer.concat([Buffer.from("\x89PNG\r\n\x1a\n", "latin1"), Buffer.alloc(40, 7)]);
const WEBM = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0x82, 0x84]), Buffer.from("webm"), Buffer.alloc(30)]);
const mp4 = (brand: string) => Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from(`ftyp${brand}`, "latin1"), Buffer.alloc(40)]);

let root: string;
let store: WallpaperStore;
const dir = () => path.join(root, "wallpaper");
const write = (name: string, body: Buffer) => {
  const file = path.join(root, name);
  fs.writeFileSync(file, body);
  return file;
};

beforeEach(() => {
  root = fs.mkdtempSync(path.join(tmpdir(), "nuvo-wallpaper-"));
  store = new WallpaperStore(dir());
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe("sniffWallpaper", () => {
  it("reads the format from the bytes", () => {
    expect(sniffWallpaper(PNG)).toBe("png");
    expect(sniffWallpaper(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]))).toBe("jpg");
    expect(sniffWallpaper(Buffer.from("GIF89a\x01\x00", "latin1"))).toBe("gif");
    expect(sniffWallpaper(Buffer.from("RIFF\x00\x00\x00\x00WEBPVP8 ", "latin1"))).toBe("webp");
    expect(sniffWallpaper(mp4("avif"))).toBe("avif");
    expect(sniffWallpaper(mp4("isom"))).toBe("mp4");
    expect(sniffWallpaper(WEBM)).toBe("webm");
  });

  it("refuses QuickTime, Matroska and anything else", () => {
    expect(sniffWallpaper(mp4("qt  "))).toBeNull();
    expect(sniffWallpaper(Buffer.concat([WEBM.subarray(0, 12), Buffer.from("matroska")]))).toBeNull();
    expect(sniffWallpaper(Buffer.from("<svg xmlns="))).toBeNull();
    expect(sniffWallpaper(Buffer.alloc(0))).toBeNull();
  });
});

describe("parseRange", () => {
  it("reads one byte range and clamps its end", () => {
    expect(parseRange(null, 100)).toBeNull();
    expect(parseRange("bytes=0-", 100)).toEqual({ start: 0, end: 99 });
    expect(parseRange("bytes=10-19", 100)).toEqual({ start: 10, end: 19 });
    expect(parseRange("bytes=90-500", 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange("bytes=-10", 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange("bytes=100-", 100)).toBe("unsatisfiable");
    expect(parseRange("bytes=0-1,5-6", 100)).toBeNull();
  });
});

describe("WallpaperStore", () => {
  it("copies the picked file under a fresh name and keeps only the newest", async () => {
    const first = await store.import(write("a.png", PNG));
    const second = await store.import(write("b.webm", WEBM));
    if (!first.ok || !second.ok) throw new Error("import failed");
    expect(second.name).toMatch(/^[0-9a-f-]{36}\.webm$/);
    expect(fs.readdirSync(dir())).toEqual([second.name]);
    fs.rmSync(path.join(root, "b.webm"));
    expect(store.find(second.name)?.format).toBe("webm");
  });

  it("refuses wrong, empty, missing and oversized files without touching the stored one", async () => {
    const kept = await store.import(write("a.png", PNG));
    expect(await store.import(write("notes.png", Buffer.from("plain text, not a picture")))).toEqual({ ok: false, error: "format" });
    expect(await store.import(write("empty.png", Buffer.alloc(0)))).toEqual({ ok: false, error: "empty" });
    expect(await store.import(path.join(root, "gone.png"))).toEqual({ ok: false, error: "read" });
    expect(await store.import(root)).toEqual({ ok: false, error: "format" });
    const big = path.join(root, "big.png");
    fs.writeFileSync(big, PNG);
    fs.truncateSync(big, MAX_IMAGE_BYTES + 1);
    expect(await store.import(big)).toEqual({ ok: false, error: "too_large" });
    expect(fs.readdirSync(dir())).toEqual([kept.ok && kept.name]);
  });

  it("clears every copy and finds only its own names", async () => {
    const kept = await store.import(write("a.png", PNG));
    if (!kept.ok) throw new Error("import failed");
    fs.writeFileSync(path.join(dir(), "x.png.tmp"), "left over");
    expect(store.find("../a.png")).toBeNull();
    expect(store.find("x.png.tmp")).toBeNull();
    await store.clear();
    expect(fs.readdirSync(dir())).toEqual([]);
    expect(store.find(kept.name)).toBeNull();
  });
});

describe("wallpaperResponse", () => {
  const get = (p: string, headers: Record<string, string> = {}) =>
    wallpaperResponse(new Request(`nuvo-core://local${p}`, { headers }), store, ["file://", "null"]);

  it("serves the stored file whole or by range, and nothing else", async () => {
    const saved = await store.import(write("a.webm", WEBM));
    if (!saved.ok) throw new Error("import failed");
    const whole = await get(`/wallpaper/${saved.name}`, { origin: "null" });
    expect([whole.status, whole.headers.get("content-type"), whole.headers.get("accept-ranges"), whole.headers.get("access-control-allow-origin")]).toEqual([
      200,
      "video/webm",
      "bytes",
      "null",
    ]);
    expect(Buffer.from(await whole.arrayBuffer())).toEqual(WEBM);
    const part = await get(`/wallpaper/${saved.name}`, { range: "bytes=4-7" });
    expect([part.status, part.headers.get("content-range"), part.headers.get("content-length")]).toEqual([206, `bytes 4-7/${WEBM.length}`, "4"]);
    expect(Buffer.from(await part.arrayBuffer())).toEqual(WEBM.subarray(4, 8));
    expect((await get(`/wallpaper/${saved.name}`, { range: "bytes=999-" })).status).toBe(416);
    expect((await get(`/wallpaper/${saved.name}`, { origin: "https://evil.test" })).status).toBe(403);
    for (const p of ["/wallpaper/../main-settings.json", "/wallpaper/%2e%2e%2fmain-settings.json", "/wallpaper/", "/wallpaper/other.webm"]) {
      expect((await get(p)).status).toBe(404);
    }
  });
});
