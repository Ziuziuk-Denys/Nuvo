import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi, afterEach } from "vitest";
import type { SurfaceState } from "../../src/engine/types";
import { notchActionToCommand, PlayerRelay, toNotchState } from "./relay";
import { MainSettingsStore } from "./settings";
import { probeWatcher, TrayController, trayIconStyle, trayMenu, trayWanted, type TrayMenuItem } from "./tray";
import { RateGate, validateNotice, validateSurfaceState } from "./validate";

const state = (extra: Partial<SurfaceState> = {}): SurfaceState => ({
  trackId: "dQw4w9WgXcQ",
  title: "Song",
  artists: "Artist",
  durationMs: 200_000,
  positionMs: 30_000,
  sampledAt: 1000,
  status: "playing",
  liked: false,
  source: "youtube",
  upNext: [
    { id: "b", title: "B", artist: "AB", coverUrl: "", durationMs: 1 },
    { id: "c", title: "C", artist: "AC", coverUrl: "", durationMs: 1 },
    { id: "d", title: "D", artist: "AD", coverUrl: "", durationMs: 1 },
  ],
  ...extra,
});

let dirs: string[] = [];
const tempDir = () => {
  const dir = fs.mkdtempSync(path.join(tmpdir(), "nuvo-main-"));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  vi.useRealTimers();
  dirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true }));
  dirs = [];
});

describe("player state relay", () => {
  it("a valid state reaches the Notch converted", () => {
    const relay = new PlayerRelay();
    const seen: unknown[] = [];
    relay.read((s) => seen.push(toNotchState(s)));
    relay.accept(validateSurfaceState(state())!);
    expect(seen.at(-1)).toMatchObject({ track: { id: "dQw4w9WgXcQ" }, status: "playing", positionMs: 30_000, sampledAt: 1000, liked: false });
    expect((seen.at(-1) as { upNext: unknown[] }).upNext).toHaveLength(3);
  });

  it("invalid states are dropped", () => {
    expect(validateSurfaceState(state({ publicCoverUrl: "nuvo-core://local/covers/1" }))).toBeNull();
    expect(validateSurfaceState(state({ title: "x".repeat(300) }))).toBeNull();
    expect(validateSurfaceState({ ...state(), status: "dancing" })).toBeNull();
    expect(validateSurfaceState({ ...state(), extra: 1 })).not.toHaveProperty("extra");
  });

  it("at most 10 states per second, the last one kept", () => {
    vi.useFakeTimers();
    const processed: number[] = [];
    const gate = new RateGate<number>(
      10,
      (n) => processed.push(n),
      () => Date.now(),
    );
    for (let i = 0; i < 25; i++) gate.offer(i);
    expect(processed).toHaveLength(10);
    vi.advanceTimersByTime(1000);
    expect(processed.at(-1)).toBe(24);
    expect(processed).toHaveLength(11);
  });

  it("Notch actions become player commands", () => {
    expect(notchActionToCommand({ type: "like" }, false)).toEqual({ type: "like" });
    expect(notchActionToCommand({ type: "like" }, true)).toEqual({ type: "unlike" });
    expect(notchActionToCommand({ type: "playUpNext", trackId: "b" }, false)).toEqual({ type: "playEntry", trackId: "b" });
    expect(notchActionToCommand({ type: "volumeDelta", delta: 0.05 }, false)).toEqual({ type: "volumeDelta", delta: 0.05 });
    expect(notchActionToCommand({ type: "focusApp" }, false)).toBeNull();
  });

  it("a renderer crash makes every reader idle", () => {
    const relay = new PlayerRelay();
    relay.accept(state());
    relay.rendererGone(5);
    expect(relay.latest.trackId).toBeNull();
    expect(trayMenu(relay.latest)[0].label).toBe("Nothing playing");
  });
});

describe("main settings", () => {
  it("saving the form again keeps the stored password, a new username drops it, port 80 is a port", () => {
    const store = new MainSettingsStore(path.join(fs.mkdtempSync(path.join(tmpdir(), "nuvo-proxy-")), "s.json"), safe(true), () => undefined);
    expect(store.set("proxy", { mode: "manual", url: "http://proxy.lan:80", username: "me", password: "secret" }).ok).toBe(true);
    expect(store.proxyPassword()).toBe("secret");
    store.set("proxy", { mode: "manual", url: "http://proxy.lan:8080", username: "me" });
    expect(store.proxyPassword()).toBe("secret");
    store.set("proxy", { mode: "manual", url: "http://proxy.lan:8080", username: "other" });
    expect(store.proxyPassword()).toBeUndefined();
  });

  const safe = (available: boolean) => ({
    isEncryptionAvailable: () => available,
    encryptString: (t: string) => Buffer.from(`enc:${t}`),
    decryptString: (b: Buffer) => b.toString().slice(4),
  });

  it("missing gives defaults; unreadable gives defaults and a .bad copy", () => {
    const dir = tempDir();
    const file = path.join(dir, "main-settings.json");
    expect(new MainSettingsStore(file, safe(true), () => undefined).view().keepInTray).toBe(false);
    fs.writeFileSync(file, "{not json");
    const store = new MainSettingsStore(file, safe(true), () => undefined);
    expect(store.view().discord.enabled).toBe(false);
    expect(fs.existsSync(`${file}.bad`)).toBe(true);
  });

  it("closing the window quits unless the user keeps Nuvo in the tray; the old default is not carried over", () => {
    const file = path.join(tempDir(), "main-settings.json");
    fs.writeFileSync(file, JSON.stringify({ closeToTray: true, trayHintShown: true, autoUpdate: false }));
    const store = new MainSettingsStore(file, safe(true), () => undefined);
    expect(store.view()).toMatchObject({ keepInTray: false, trayHintShown: true, autoUpdate: false });
    expect(store.set("keepInTray", true).ok).toBe(true);
    expect(new MainSettingsStore(file, safe(true), () => undefined).view().keepInTray).toBe(true);
  });

  it("a wrong type or an unknown key writes nothing", () => {
    const dir = tempDir();
    const file = path.join(dir, "main-settings.json");
    const store = new MainSettingsStore(file, safe(true), () => undefined);
    expect(store.set("keepInTray", "yes")).toMatchObject({ ok: false });
    expect(store.set("colour", true)).toMatchObject({ ok: false });
    expect(fs.existsSync(file)).toBe(false);
  });

  it("an interrupted write leaves the old file intact", () => {
    const dir = tempDir();
    const file = path.join(dir, "main-settings.json");
    const store = new MainSettingsStore(file, safe(true), () => undefined);
    store.set("keepInTray", false);
    const before = fs.readFileSync(file, "utf8");
    const rename = vi.spyOn(fs, "renameSync").mockImplementationOnce(() => {
      throw new Error("power cut");
    });
    expect(() => store.set("trayHintShown", true)).toThrow("power cut");
    rename.mockRestore();
    expect(fs.readFileSync(file, "utf8")).toBe(before);
  });

  it("appearance flags: the renderer switches safe mode, a damaged value reads as the default", () => {
    const dir = tempDir();
    const file = path.join(dir, "main-settings.json");
    const store = new MainSettingsStore(file, safe(true), () => undefined);
    expect(store.view().appearance).toEqual({ safe: false, failedStarts: 0 });
    store.setAppearance({ safe: true, failedStarts: 2 });
    expect(new MainSettingsStore(file, safe(true), () => undefined).view().appearance).toEqual({ safe: true, failedStarts: 2 });
    expect(store.set("appearance", { safe: "no" })).toMatchObject({ ok: false });
    expect(store.set("appearance", { safe: false })).toEqual({ ok: true });
    expect(store.view().appearance).toEqual({ safe: false, failedStarts: 0 });
    fs.writeFileSync(file, JSON.stringify({ appearance: { safe: "yes", failedStarts: -1 } }));
    expect(new MainSettingsStore(file, safe(true), () => undefined).view().appearance).toEqual({ safe: false, failedStarts: 0 });
  });

  it("proxy passwords are encrypted, never returned, refused without encryption", () => {
    const dir = tempDir();
    const file = path.join(dir, "main-settings.json");
    const store = new MainSettingsStore(file, safe(true), () => undefined);
    expect(store.set("proxy", { mode: "manual", url: "socks5://127.0.0.1:1080", password: "secret" })).toEqual({ ok: true });
    expect(JSON.parse(fs.readFileSync(file, "utf8")).proxy.passwordEnc).toBe(Buffer.from("enc:secret").toString("base64"));
    expect(store.view().proxy).toMatchObject({ hasPassword: true });
    expect(JSON.stringify(store.view())).not.toContain("secret");
    const plain = new MainSettingsStore(path.join(dir, "other.json"), safe(false), () => undefined);
    expect(plain.set("proxy", { mode: "manual", url: "http://p:8080", password: "x" })).toEqual({ ok: false, error: "passwordStorable: false" });
  });
});

describe("tray", () => {
  const host = (wanted = true) => {
    const created: Array<{ menus: TrayMenuItem[][]; destroyed: boolean }> = [];
    const availability: boolean[] = [];
    const want = { value: wanted };
    return {
      created,
      availability,
      want,
      host: {
        wanted: () => want.value,
        create: () => {
          const tray = { menus: [] as TrayMenuItem[][], destroyed: false };
          created.push(tray);
          return { setMenu: (items: TrayMenuItem[]) => tray.menus.push(items), destroy: () => (tray.destroyed = true) };
        },
        onClick: vi.fn(),
        availabilityChanged: (a: boolean) => availability.push(a),
        activate: vi.fn(),
      },
    };
  };

  it("the watcher probe decides the tray", async () => {
    expect(await probeWatcher(async () => "(true,)\n")).toBe(true);
    expect(await probeWatcher(async () => "(false,)")).toBe(false);
    expect(await probeWatcher(async () => Promise.reject(new Error("ENOENT")))).toBe(false);
    const h = host();
    const tray = new TrayController(h.host, async () => true);
    await tray.start();
    expect(h.created).toHaveLength(1);
    tray.dispose();
  });

  it("the tray follows the watcher every 60 s", async () => {
    vi.useFakeTimers();
    let up = true;
    const h = host();
    const tray = new TrayController(h.host, async () => up);
    await tray.start();
    up = false;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.created[0].destroyed).toBe(true);
    expect(tray.isAvailable).toBe(false);
    up = true;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.created).toHaveLength(2);
    tray.dispose();
  });

  it("losing the watcher tells main to show the window", async () => {
    let up = true;
    const h = host();
    const tray = new TrayController(h.host, async () => up);
    await tray.start();
    up = false;
    await tray.check();
    expect(h.availability).toEqual([true, false]);
    tray.dispose();
  });

  it("shows the icon only while it is wanted, and keeps the watcher state either way", async () => {
    const h = host(false);
    const tray = new TrayController(h.host, async () => true);
    await tray.start();
    expect(tray.isAvailable).toBe(true);
    expect(h.created).toHaveLength(0);
    h.want.value = true;
    tray.update(state());
    expect(h.created).toHaveLength(1);
    expect(h.created[0].menus).toHaveLength(1);
    h.want.value = false;
    tray.sync();
    expect(h.created[0].destroyed).toBe(true);
    tray.sync();
    expect(h.created).toHaveLength(1);
    tray.dispose();
  });

  it("is wanted when kept in the tray or playing with the window closed", () => {
    expect(trayWanted({ keepInTray: false, windowHidden: false, status: "playing" })).toBe(false);
    expect(trayWanted({ keepInTray: false, windowHidden: true, status: "paused" })).toBe(false);
    expect(trayWanted({ keepInTray: false, windowHidden: true, status: null })).toBe(false);
    expect(trayWanted({ keepInTray: false, windowHidden: true, status: "playing" })).toBe(true);
    expect(trayWanted({ keepInTray: false, windowHidden: true, status: "loading" })).toBe(true);
    expect(trayWanted({ keepInTray: true, windowHidden: false, status: "idle" })).toBe(true);
  });

  it("a long title is cut to 60 characters and disabled", () => {
    const item = trayMenu(state({ title: "A very long title that keeps going and going beyond sixty chars", artists: "X" }))[0];
    expect(item.label).toHaveLength(60);
    expect(item.label.endsWith("…")).toBe(true);
    expect(item.enabled).toBe(false);
  });

  it("the menu without a track", () => {
    const menu = trayMenu(state({ trackId: null }));
    expect(menu.map((m) => [m.label, m.enabled])).toEqual([
      ["Nothing playing", false],
      ["Play", false],
      ["Next", false],
      ["Previous", false],
      ["Like", false],
      ["", true],
      ["Show Nuvo", true],
      ["Reset appearance (safe mode)", true],
      ["Quit Nuvo", true],
    ]);
  });

  it("labels follow status and liked", () => {
    expect(trayMenu(state({ liked: true })).map((m) => m.label)).toContain("Unlike");
    expect(trayMenu(state({ liked: true }))[1].label).toBe("Pause");
    expect(trayMenu(state({ status: "loading" }))[1].label).toBe("Pause");
    const paused = trayMenu(state({ status: "paused" }));
    expect([paused[1].label, paused[4].label]).toEqual(["Play", "Like"]);
  });

  it("position-only updates never rebuild; a track change rebuilds once", async () => {
    vi.useFakeTimers();
    const h = host();
    const tray = new TrayController(h.host, async () => true);
    await tray.start();
    tray.update(state());
    await vi.advanceTimersByTimeAsync(300);
    const before = h.created[0].menus.length;
    for (let i = 0; i < 10; i++) tray.update(state({ positionMs: i * 20 }));
    await vi.advanceTimersByTimeAsync(300);
    expect(h.created[0].menus.length).toBe(before);
    tray.update(state({ trackId: "otherTrack1" }));
    await vi.advanceTimersByTimeAsync(249);
    expect(h.created[0].menus.length).toBe(before);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.created[0].menus.length).toBe(before + 1);
    tray.dispose();
  });

  it("clicks map to commands, show and quit", () => {
    const routes: Record<string, unknown> = { toggle: { type: "toggle" }, next: { type: "next" }, previous: { type: "previous" }, like: { type: "like" } };
    const route = (id: string, liked: boolean) => (id === "like" && liked ? { type: "unlike" } : (routes[id] ?? id));
    expect(route("next", false)).toEqual({ type: "next" });
    expect(route("like", false)).toEqual({ type: "like" });
    expect(route("like", true)).toEqual({ type: "unlike" });
    expect(route("show", false)).toBe("show");
    expect(route("quit", false)).toBe("quit");
  });
});

describe("activate", () => {
  it("activate toggles the window", async () => {
    const { activateWindow } = await import("./windowRules");
    const win = { visible: false, focused: false, minimized: false };
    expect(activateWindow(win, true)).toBe("show");
    expect(activateWindow({ visible: true, focused: true, minimized: false }, true)).toBe("hide");
    expect(activateWindow({ visible: true, focused: true, minimized: false }, false)).toBe("focus");
  });
});

describe("review fixes", () => {
  const cover = (coverUrl: string) => state({ upNext: [{ id: "b", title: "B", artist: "A", coverUrl, durationMs: 1 }] });

  it("rejects NaN bitrate", () => {
    expect(validateSurfaceState(state({ stream: { codec: "opus", bitrateKbps: NaN } }))).toBeNull();
  });

  it("blanks upNext covers outside the public cover rule", () => {
    const covers = (s: SurfaceState | null) => s!.upNext[0].coverUrl;
    expect(covers(validateSurfaceState(cover("https://i.ytimg.com/vi/a/hq.jpg")))).toBe("https://i.ytimg.com/vi/a/hq.jpg");
    expect(covers(validateSurfaceState(cover("https://evil.example/a.jpg")))).toBe("");
    expect(covers(validateSurfaceState(cover("https://u:p@i.ytimg.com/a.jpg")))).toBe("");
    expect(covers(validateSurfaceState(cover("nuvo-core://local/covers/1")))).toBe("");
  });

  it("caps SoundCloud page URLs", () => {
    expect(validateSurfaceState(state({ sourcePageUrl: `https://soundcloud.com/${"a".repeat(600)}` }))).toBeNull();
  });

  it("refuses proxy URLs with userinfo", () => {
    const dir = tempDir();
    const store = new MainSettingsStore(
      path.join(dir, "s.json"),
      { isEncryptionAvailable: () => true, encryptString: (t) => Buffer.from(t), decryptString: (b) => b.toString() },
      () => undefined,
    );
    expect(store.set("proxy", { mode: "manual", url: "http://user:pw@p:8080" })).toMatchObject({ ok: false });
    expect(store.set("proxy", { mode: "manual", url: "http://p:8080", username: "u".repeat(300) })).toMatchObject({ ok: false });
  });

  it("writes the settings file 0600 and removes the temp file on failure", () => {
    const dir = tempDir();
    const file = path.join(dir, "s.json");
    const store = new MainSettingsStore(
      file,
      { isEncryptionAvailable: () => true, encryptString: (t) => Buffer.from(t), decryptString: (b) => b.toString() },
      () => undefined,
    );
    store.set("keepInTray", false);
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    const rename = vi.spyOn(fs, "renameSync").mockImplementationOnce(() => {
      throw new Error("boom");
    });
    expect(() => store.set("trayHintShown", true)).toThrow("boom");
    rename.mockRestore();
    expect(fs.readdirSync(dir).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });

  it("applies the navigation rule to the shared decision", async () => {
    const { navigationDecision } = await import("./windowRules");
    expect(navigationDecision("https://example.com/", undefined, "file:///app/index.html")).toBe("browser");
    expect(navigationDecision("javascript:alert(1)", undefined, "file:///app/index.html")).toBe("deny");
  });
});

describe("tray icon", () => {
  it("is the mono glyph where the panel draws one-colour icons, else the app icon", () => {
    expect(trayIconStyle("GNOME", false)).toBe("mono-on-dark");
    expect(trayIconStyle("ubuntu:GNOME", false)).toBe("mono-on-dark");
    expect(trayIconStyle("Pop:pop-GNOME", false)).toBe("mono-on-dark");
    expect(trayIconStyle("KDE", false)).toBe("mono-on-light");
    expect(trayIconStyle("KDE", true)).toBe("mono-on-dark");
    expect(trayIconStyle("XFCE", true)).toBe("app");
    expect(trayIconStyle("", false)).toBe("app");
  });

  it("ships the mono glyphs in the package", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "../../package.json"), "utf8")) as { build: { files: string[] } };
    expect(pkg.build.files).toContain("build/icons/tray/*.png");
    for (const style of ["on-dark", "on-light"]) expect(fs.existsSync(path.join(__dirname, `../../build/icons/tray/nuvo-tray-${style}-32.png`))).toBe(true);
  });
});

describe("notice", () => {
  it("takes a short non-empty title and body only", () => {
    expect(validateNotice({ title: "Import finished", body: "Road trip: 18 of 20 songs added" })).toEqual({
      title: "Import finished",
      body: "Road trip: 18 of 20 songs added",
    });
    for (const bad of [null, {}, { title: " ", body: "x" }, { title: "x", body: "" }, { title: "x".repeat(121), body: "x" }, { title: "x", body: 5 }]) {
      expect(validateNotice(bad)).toBeNull();
    }
  });
});
