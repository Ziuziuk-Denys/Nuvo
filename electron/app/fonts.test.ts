// @vitest-environment node
import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  cleanFamily,
  familyFromNameTable,
  FC_LIST_MAX_BYTES,
  fontResponse,
  FontStore,
  MAX_FONT_FILES,
  MAX_FONT_TOTAL_BYTES,
  parseFcList,
  SystemFonts,
  sniffFont,
} from "./fonts";

function ttf(family = "Test Sans", magic = [0, 1, 0, 0], size = 0): Buffer {
  const text = Buffer.from(family, "utf16le").swap16();
  const name = Buffer.alloc(18 + text.length);
  name.writeUInt16BE(0, 0);
  name.writeUInt16BE(1, 2);
  name.writeUInt16BE(18, 4);
  [3, 1, 0x409, 1, text.length, 0].forEach((v, i) => name.writeUInt16BE(v, 6 + i * 2));
  text.copy(name, 18);
  const head = Buffer.alloc(28);
  Buffer.from(magic).copy(head, 0);
  head.writeUInt16BE(1, 4);
  head.write("name", 12, "latin1");
  head.writeUInt32BE(28, 20);
  head.writeUInt32BE(name.length, 24);
  const font = Buffer.concat([head, name]);
  return size > font.length ? Buffer.concat([font, Buffer.alloc(size - font.length)]) : font;
}

function woff2(): Buffer {
  const buf = Buffer.alloc(64);
  buf.write("wOF2", 0, "latin1");
  buf.writeUInt32BE(64, 8);
  buf.writeUInt16BE(3, 12);
  return buf;
}

const dirs: string[] = [];
function store(): FontStore {
  const dir = fs.mkdtempSync(path.join(tmpdir(), "nuvo-fonts-"));
  dirs.push(dir);
  return new FontStore(path.join(dir, "fonts"), () => 42);
}
afterEach(() => dirs.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));

describe("fonts", () => {
  it("sniffs by magic bytes and refuses what v1 does not support", () => {
    expect(sniffFont(ttf())).toEqual({ ok: true, format: "ttf" });
    expect(sniffFont(ttf("X", [0x74, 0x72, 0x75, 0x65]))).toEqual({ ok: true, format: "ttf" });
    expect(sniffFont(ttf("X", [0x4f, 0x54, 0x54, 0x4f]))).toEqual({ ok: true, format: "otf" });
    expect(sniffFont(woff2())).toEqual({ ok: true, format: "woff2" });
    expect(sniffFont(Buffer.from("wOFF0000"))).toEqual({ ok: false, error: "woff1" });
    expect(sniffFont(Buffer.from("ttcf0000"))).toEqual({ ok: false, error: "collection" });
    expect(sniffFont(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toEqual({ ok: false, error: "format" });
    expect(sniffFont(Buffer.alloc(0))).toEqual({ ok: false, error: "empty" });
    expect(sniffFont(ttf().subarray(0, 40))).toEqual({ ok: false, error: "damaged" });
    expect(sniffFont(woff2().subarray(0, 60))).toEqual({ ok: false, error: "damaged" });
  });

  it("reads the family from the name table and cleans it", () => {
    expect(familyFromNameTable(ttf("Inter Display"))).toBe("Inter Display");
    expect(familyFromNameTable(ttf('Evil"; }'))).toBeNull();
  });

  it("fc-list parser drops unsafe names, merges duplicates and keeps the first alias", () => {
    const out = [
      "Noto Sans,Noto Sans Regular",
      "Noto Sans",
      'Evil"Quote',
      "Semi;colon",
      "Brace{",
      "x".repeat(101),
      "Ctrl\u0007",
      "back\\slash",
      "Ünïcode Grotesk",
      "",
    ].join("\n");
    expect(parseFcList(out)).toEqual(["Noto Sans", "Ünïcode Grotesk"]);
    expect(cleanFamily("x".repeat(100))).toBe("x".repeat(100));
  });

  it("stores under the hash with mode 0600; path-like ids never resolve", async () => {
    const fonts = store();
    const imported = fonts.import(ttf("Test Sans"), "../../evil name.ttf");
    expect(imported).toMatchObject({ ok: true, file: { family: "Test Sans", format: "ttf", addedAt: 42 } });
    const id = imported.ok ? imported.file.id : "";
    const dir = (fonts as unknown as { dir: string }).dir;
    expect(fs.readdirSync(dir)).toEqual([`${id}.ttf`]);
    expect(fs.statSync(path.join(dir, `${id}.ttf`)).mode & 0o777).toBe(0o600);

    const get = (p: string, origin?: string) =>
      fontResponse(new Request(`nuvo-core://local${p}`, { headers: origin ? { origin } : {} }), fonts, ["file://", "null"]);
    const ok = get(`/fonts/${id}`, "null");
    expect([ok.status, ok.headers.get("content-type"), ok.headers.get("x-content-type-options"), ok.headers.get("access-control-allow-origin")]).toEqual([
      200,
      "font/ttf",
      "nosniff",
      "null",
    ]);
    expect(Buffer.from(await ok.arrayBuffer())).toEqual(ttf("Test Sans"));
    for (const p of [
      "/fonts/../main-settings.json",
      `/fonts/..%2F${id}`,
      "/fonts/%2e%2e%2fmain-settings.json",
      `/fonts/${id}.ttf`,
      "/fonts/",
      `/fonts/${"0".repeat(64)}`,
    ]) {
      expect(get(p).status, p).toBe(404);
    }
    expect(get(`/fonts/${id}`, "https://example.org").status).toBe(403);
    expect(fonts.remove(id)).toBe(true);
    expect(get(`/fonts/${id}`).status).toBe(404);
  });

  it("WOFF2 shows its file name; the same file twice is stored once", () => {
    const fonts = store();
    expect(fonts.import(woff2(), "/home/me/My Font.woff2")).toMatchObject({ ok: true, file: { family: "My Font", format: "woff2" } });
    expect(fonts.import(woff2(), "copy.woff2").ok).toBe(true);
    expect(fs.readdirSync((fonts as unknown as { dir: string }).dir)).toHaveLength(1);
  });

  it("the 21st file and the 65th megabyte are refused", () => {
    const fonts = store();
    for (let i = 0; i < MAX_FONT_FILES; i += 1) expect(fonts.import(ttf(`Font ${i}`), "f.ttf").ok).toBe(true);
    expect(fonts.import(ttf("One more"), "f.ttf")).toEqual({ ok: false, error: "limit" });

    const big = store();
    for (let i = 0; i < 8; i += 1) expect(big.import(ttf(`Big ${i}`, [0, 1, 0, 0], 8 * 1024 * 1024 - 64), "f.ttf").ok).toBe(true);
    expect(big.import(ttf("Over", [0, 1, 0, 0], 1024), "f.ttf")).toEqual({ ok: false, error: "limit" });
    expect(big.import(ttf("Huge", [0, 1, 0, 0], 8 * 1024 * 1024 + 1), "f.ttf")).toEqual({ ok: false, error: "too_large" });
  });

  it("symlinks and dangling links are not fonts and do not throw", () => {
    const dir = fs.mkdtempSync(path.join(tmpdir(), "nuvo-fonts-"));
    dirs.push(dir);
    const fontsDir = path.join(dir, "fonts");
    fs.mkdirSync(fontsDir);
    const fonts = new FontStore(fontsDir, () => 42);
    const name = `${"a".repeat(64)}.ttf`;
    fs.symlinkSync("/nonexistent/target", path.join(fontsDir, name));
    expect(fonts.find("a".repeat(64))).toBeNull();
    expect(fonts.read("a".repeat(64))).toBeNull();
    expect(fonts.import(ttf("After"), "f.ttf").ok).toBe(true);
  });

  it("leftover temporary files count against the total cap and are cleaned", () => {
    const dir = fs.mkdtempSync(path.join(tmpdir(), "nuvo-fonts-"));
    dirs.push(dir);
    const fontsDir = path.join(dir, "fonts");
    fs.mkdirSync(fontsDir);
    fs.writeFileSync(path.join(fontsDir, `${"b".repeat(64)}.ttf.123.tmp`), Buffer.alloc(1024));
    const fonts = new FontStore(fontsDir, () => 42);
    expect(fonts.import(ttf("Fresh"), "f.ttf").ok).toBe(true);
    expect(fs.readdirSync(fontsDir).filter((n) => n.endsWith(".tmp"))).toEqual([]);
  });

  it("an odd-length name record is skipped, not thrown", () => {
    const font = ttf("Test Sans");
    font.writeUInt16BE(17, 28 + 6 + 8);
    expect(familyFromNameTable(font)).toBeNull();
  });

  it("the fc-list parser stops at the byte cap and caps the family count", () => {
    expect(parseFcList("A\n" + "x".repeat(FC_LIST_MAX_BYTES) + "\nB")).toEqual(["A"]);
    const many = Array.from({ length: 6000 }, (_, i) => `Family ${i}`).join("\n");
    expect(parseFcList(many).length).toBe(5000);
  });

  it("a write failure is its own error, not a damaged font", () => {
    const dir = fs.mkdtempSync(path.join(tmpdir(), "nuvo-fonts-"));
    dirs.push(dir);
    const blocked = path.join(dir, "fonts");
    fs.writeFileSync(blocked, "x");
    expect(new FontStore(blocked).import(ttf(), "a.ttf")).toEqual({ ok: false, error: "write" });
  });

  it("the system font list is scanned once, a rescan or a failure is retried at most every 30 s", async () => {
    let now = 0;
    let scans = 0;
    let fail = false;
    const list = new SystemFonts(
      async () => {
        scans += 1;
        return fail ? { ok: false as const } : { ok: true as const, families: ["A"] };
      },
      () => now,
    );
    await list.get(false);
    await list.get(false);
    await list.get(true);
    expect(scans).toBe(1);
    now = 31_000;
    await list.get(true);
    expect(scans).toBe(2);
    fail = true;
    now = 62_000;
    expect(await list.get(true)).toEqual({ ok: false });
    await list.get(false);
    expect(scans).toBe(3);
    now = 93_000;
    await list.get(false);
    expect(scans).toBe(4);
  });
});
