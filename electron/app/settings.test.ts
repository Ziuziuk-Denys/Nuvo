import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MainSettingsStore } from "./settings";

let dir: string;
const safeStorage = { isEncryptionAvailable: () => false, encryptString: () => Buffer.alloc(0), decryptString: () => "" };
const open = () => new MainSettingsStore(path.join(dir, "main-settings.json"), safeStorage, () => undefined);

beforeEach(() => void (dir = mkdtempSync(path.join(tmpdir(), "nuvo-settings-"))));
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("autoUpdate setting", () => {
  it("is on by default", () => {
    expect(open().view().autoUpdate).toBe(true);
  });

  it("accepts only a boolean and keeps the choice across restarts", () => {
    const store = open();
    expect(store.set("autoUpdate", "yes").ok).toBe(false);
    expect(store.set("autoUpdate", 1).ok).toBe(false);
    expect(store.set("autoUpdate", false)).toEqual({ ok: true });
    expect(open().value.autoUpdate).toBe(false);
  });
});

describe("discord setting", () => {
  it("is on by default", () => {
    expect(open().view().discord).toEqual({ enabled: true });
  });

  it("turns on for a file that stored the old default, and keeps a switch the user flipped", () => {
    const file = path.join(dir, "main-settings.json");
    writeFileSync(file, JSON.stringify({ keepInTray: true, discord: { enabled: false } }));
    expect(open().value.discord.enabled).toBe(true);
    const store = open();
    store.set("discord", { enabled: false });
    expect(open().value.discord).toEqual({ enabled: false, chosen: true });
    expect(open().value.keepInTray).toBe(true);
  });

  it("accepts only an object with a boolean and keeps the choice across restarts", () => {
    const store = open();
    expect(store.set("discord", true).ok).toBe(false);
    expect(store.set("discord", null).ok).toBe(false);
    expect(store.set("discord", { enabled: "yes" }).ok).toBe(false);
    expect(store.value.discord.enabled).toBe(true);
    expect(store.set("discord", { enabled: false })).toEqual({ ok: true });
    expect(open().value.discord.enabled).toBe(false);
  });
});

describe("zoom level", () => {
  it("starts at 0, keeps a set level across restarts and refuses one the renderer sends", () => {
    const store = open();
    expect(store.value.zoomLevel).toBe(0);
    store.setZoom(1.5);
    expect(open().value.zoomLevel).toBe(1.5);
    expect(store.set("zoomLevel", 2).ok).toBe(false);
  });
});
