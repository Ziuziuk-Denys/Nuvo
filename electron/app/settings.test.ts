import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MainSettingsStore } from "./settings";

let dir: string;
const safeStorage = {
  isAsyncEncryptionAvailable: async () => false,
  encryptStringAsync: async () => Buffer.alloc(0),
  decryptStringAsync: async () => ({ shouldReEncrypt: false, result: "" }),
};
const open = () => new MainSettingsStore(path.join(dir, "main-settings.json"), safeStorage, () => undefined);

beforeEach(() => void (dir = mkdtempSync(path.join(tmpdir(), "nuvo-settings-"))));
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("autoUpdate setting", () => {
  it("is on by default", async () => {
    expect((await open().view()).autoUpdate).toBe(true);
  });

  it("accepts only a boolean and keeps the choice across restarts", async () => {
    const store = open();
    expect((await store.set("autoUpdate", "yes")).ok).toBe(false);
    expect((await store.set("autoUpdate", 1)).ok).toBe(false);
    expect(await store.set("autoUpdate", false)).toEqual({ ok: true });
    expect(open().value.autoUpdate).toBe(false);
  });
});

describe("discord setting", () => {
  it("is on by default", async () => {
    expect((await open().view()).discord).toEqual({ enabled: true });
  });

  it("turns on for a file that stored the old default, and keeps a switch the user flipped", async () => {
    const file = path.join(dir, "main-settings.json");
    writeFileSync(file, JSON.stringify({ keepInTray: true, discord: { enabled: false } }));
    expect(open().value.discord.enabled).toBe(true);
    const store = open();
    await store.set("discord", { enabled: false });
    expect(open().value.discord).toEqual({ enabled: false, chosen: true });
    expect(open().value.keepInTray).toBe(true);
  });

  it("accepts only an object with a boolean and keeps the choice across restarts", async () => {
    const store = open();
    expect((await store.set("discord", true)).ok).toBe(false);
    expect((await store.set("discord", null)).ok).toBe(false);
    expect((await store.set("discord", { enabled: "yes" })).ok).toBe(false);
    expect(store.value.discord.enabled).toBe(true);
    expect(await store.set("discord", { enabled: false })).toEqual({ ok: true });
    expect(open().value.discord.enabled).toBe(false);
  });
});

describe("zoom level", () => {
  it("starts at 0, keeps a set level across restarts and refuses one the renderer sends", async () => {
    const store = open();
    expect(store.value.zoomLevel).toBe(0);
    store.setZoom(1.5);
    expect(open().value.zoomLevel).toBe(1.5);
    expect((await store.set("zoomLevel", 2)).ok).toBe(false);
  });
});
