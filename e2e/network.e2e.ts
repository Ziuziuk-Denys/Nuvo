import http from "node:http";
import { createRequire } from "node:module";
import type { AddressInfo, Socket } from "node:net";
import path from "node:path";
import { _electron, type ElectronApplication, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isolate, type Isolation } from "./isolation";
import { passFirstRun } from "./ui/harness";

const ROOT = path.resolve(import.meta.dirname, "..");
const ELECTRON = createRequire(import.meta.url)("electron") as unknown as string;
const VIDEO = "aaaaaaaaaaa";

interface View {
  status: string;
  pauseReason: string | null;
  notice: { kind: string; cause?: string; title?: string } | null;
  current: { track: { id: string } } | null;
}
interface PlayerHandle {
  engine: { playList(tracks: unknown[]): void; getView(): View; pause(): void };
}

class FixtureProxy {
  readonly tunnels: Array<{ host: string; auth?: string }> = [];
  mode: "refuse" | "hang" = "refuse";
  private readonly sockets = new Set<Socket>();
  private readonly server = http.createServer((_request, response) => response.writeHead(403).end());

  async start(): Promise<void> {
    this.server.on("connect", (request, socket) => {
      this.tunnels.push({ host: request.url ?? "", auth: request.headers["proxy-authorization"] });
      this.sockets.add(socket as Socket);
      socket.on("error", () => undefined);
      if (this.mode === "refuse") socket.end("HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n");
    });
    await new Promise<void>((resolve) => this.server.listen(0, "127.0.0.1", resolve));
  }

  get port(): number {
    return (this.server.address() as AddressInfo).port;
  }

  async stop(): Promise<void> {
    for (const socket of this.sockets) socket.destroy();
    await new Promise((resolve) => this.server.close(resolve));
  }
}

const tone = (id: string) => ({ id, title: `Tone ${id}`, artists: "Nuvo", coverUrl: "", durationMs: 2000 });

function toneWav(seconds: number): string {
  const rate = 8000;
  const data = Buffer.alloc(rate * seconds * 2);
  for (let i = 0; i < rate * seconds; i++) data.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 8000), i * 2);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]).toString("base64");
}

async function launch(isolation: Isolation, env: Record<string, string> = {}): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await _electron.launch({
    executablePath: ELECTRON,
    args: [ROOT, "--ozone-platform=x11", "--mute-audio", `--user-data-dir=${isolation.userData}`],
    cwd: ROOT,
    env: { ...isolation.env, ...env },
  });
  const page = await app.firstWindow();
  await page.waitForFunction(() => Boolean(window.nuvoShell));
  await page.evaluate(() => localStorage.setItem("nuvo.e2e", "1"));
  await page.reload();
  await page.waitForFunction(() => Boolean((window as unknown as { __nuvoPlayer?: unknown }).__nuvoPlayer));
  await page.waitForFunction(async () => (await window.nuvoShell!.getCoreStatus()) === "ready", undefined, { timeout: 60_000 });
  return { app, page };
}

const resolvedBy = (app: ElectronApplication, partition: string | null) =>
  app.evaluate(({ session }, name) => (name ? session.fromPartition(name) : session.defaultSession).resolveProxy("https://www.youtube.com/"), partition);

const setProxy = (page: Page, proxy: unknown) => page.evaluate((value) => window.nuvoShell!.setMainSetting("proxy", value), proxy);

const networkCheck = (page: Page) =>
  page.evaluate(
    async () =>
      (await fetch("nuvo-core://local/v1/system/network-check", { method: "POST" })).json() as Promise<{
        code?: string;
        service?: string;
        rows: Array<{ check: string; ok: boolean }>;
      }>,
  );

const view = (page: Page) => page.evaluate(() => (window as unknown as { __nuvoPlayer: PlayerHandle }).__nuvoPlayer.engine.getView());

const play = (page: Page, tracks: unknown[]) =>
  page.evaluate((list) => (window as unknown as { __nuvoPlayer: PlayerHandle }).__nuvoPlayer.engine.playList(list), tracks);

async function putTone(page: Page, id: string): Promise<void> {
  const status = await page.evaluate(
    async ({ id, wav }) => {
      const bytes = Uint8Array.from(atob(wav), (c) => c.charCodeAt(0));
      return (
        await fetch(`nuvo-core://local/v1/cache/audio/${id}`, { method: "PUT", headers: { "Content-Type": "audio/wav", "X-Nuvo-Codec": "pcm" }, body: bytes })
      ).status;
    },
    { id, wav: toneWav(2) },
  );
  expect(status).toBeLessThan(300);
}

describe("network", () => {
  const proxy = new FixtureProxy();
  let isolation: Isolation;
  let app: ElectronApplication;
  let page: Page;

  beforeAll(async () => {
    await proxy.start();
    isolation = isolate("nuvo-net-e2e");
    ({ app, page } = await launch(isolation));
    await setProxy(page, { mode: "manual", url: `http://127.0.0.1:${proxy.port}` });
    await putTone(page, "bbbbbbbbbbb");
    await putTone(page, "ccccccccccc");
  });

  afterAll(async () => {
    await app?.close().catch(() => undefined);
    await proxy.stop();
    isolation?.dispose();
  });

  it("a proxy set in Settings reaches the YouTube worker session and the daemon", async () => {
    expect(await resolvedBy(app, "persist:nuvo-yt")).toBe(`PROXY 127.0.0.1:${proxy.port}`);
    proxy.tunnels.length = 0;
    // A check from the app itself may be running; a second caller shares it, so ask until one ran whole.
    await expect
      .poll(async () => {
        await networkCheck(page);
        return proxy.tunnels.map((tunnel) => tunnel.host);
      })
      .toContain("music.youtube.com:443");
    const check = await networkCheck(page);
    expect(check.rows.some((row) => row.check === "proxy" && row.ok)).toBe(true);
    expect(check.code).toBe("proxy_failed");
  });

  it("socks5h reaches Chromium as socks5", async () => {
    await setProxy(page, { mode: "manual", url: "socks5h://127.0.0.1:1" });
    await expect.poll(() => resolvedBy(app, "persist:nuvo-yt")).toBe("SOCKS5 127.0.0.1:1");
    await setProxy(page, { mode: "manual", url: `http://127.0.0.1:${proxy.port}` });
    await expect.poll(() => resolvedBy(app, null)).toBe(`PROXY 127.0.0.1:${proxy.port}`);
  });

  it("a SOCKS proxy with a login reaches Chromium through the daemon's loopback bridge", async (context) => {
    const stored = await setProxy(page, { mode: "manual", url: "socks5h://127.0.0.1:1", username: "me", password: "p@ss" });
    if (!stored.ok) context.skip();
    await expect.poll(() => resolvedBy(app, "persist:nuvo-yt")).toMatch(/^PROXY 127\.0\.0\.1:\d+$/);
    expect(await resolvedBy(app, null)).toBe(await resolvedBy(app, "persist:nuvo-yt"));
    await setProxy(page, { mode: "manual", url: `http://127.0.0.1:${proxy.port}` });
    await expect.poll(() => resolvedBy(app, null)).toBe(`PROXY 127.0.0.1:${proxy.port}`);
  });

  it("the daemon logs in to the proxy with the stored password", async (context) => {
    const stored = await setProxy(page, { mode: "manual", url: `http://127.0.0.1:${proxy.port}`, username: "me", password: "p@ss" });
    if (!stored.ok) context.skip();
    proxy.tunnels.length = 0;
    await expect
      .poll(async () => {
        await networkCheck(page);
        return proxy.tunnels.map((tunnel) => tunnel.auth);
      })
      .toContain(`Basic ${Buffer.from("me:p@ss").toString("base64")}`);
    await setProxy(page, { mode: "manual", url: `http://127.0.0.1:${proxy.port}` });
  });

  it("a network that swallows every request: the budget ends the wait and the queue plays on", async () => {
    proxy.mode = "hang";
    const started = Date.now();
    await play(page, [tone("ddddddddddd"), tone("ccccccccccc")]);
    await expect.poll(async () => (await view(page)).current?.track.id, { timeout: 40_000 }).toBe("ccccccccccc");
    expect(Date.now() - started).toBeGreaterThan(5000);
    expect(Date.now() - started).toBeLessThan(30_000);
  });

  it("403 on every tunnel: the track is skipped with the reason and the queue plays on", async () => {
    proxy.mode = "refuse";
    await play(page, [tone(VIDEO), tone("bbbbbbbbbbb")]);
    await expect.poll(async () => (await view(page)).current?.track.id, { timeout: 40_000 }).toBe("bbbbbbbbbbb");
    expect((await view(page)).notice).toMatchObject({ kind: "skipped", title: `Tone ${VIDEO}` });
    await expect.poll(async () => (await view(page)).status).toMatch(/playing|idle/);
  });

  it("offline: the queue stops on the network and starts by itself when it returns", async () => {
    await page.context().setOffline(true);
    expect(await page.evaluate(() => navigator.onLine)).toBe(false);
    await play(page, [tone("eeeeeeeeeee"), tone("fffffffffff"), tone("ggggggggggg"), tone("bbbbbbbbbbb")]);
    await expect.poll(async () => (await view(page)).pauseReason, { timeout: 40_000 }).toBe("network");
    expect((await view(page)).current?.track.id).toBe("bbbbbbbbbbb");
    await page.context().setOffline(false);
    await expect.poll(async () => (await view(page)).status).toMatch(/playing|idle/);
    expect((await view(page)).pauseReason).not.toBe("network");
  });
});

describe("system proxy", () => {
  it("the environment reaches Chromium and the daemon with no setting at all", async () => {
    const proxy = new FixtureProxy();
    await proxy.start();
    const isolation = isolate("nuvo-net-env-e2e");
    const { app, page } = await launch(isolation, { HTTPS_PROXY: `http://127.0.0.1:${proxy.port}` });
    try {
      await expect.poll(() => resolvedBy(app, "persist:nuvo-yt")).toBe(`PROXY 127.0.0.1:${proxy.port}`);
      await networkCheck(page);
      expect(proxy.tunnels.map((tunnel) => tunnel.host)).toContain("music.youtube.com:443");
    } finally {
      await app.close().catch(() => undefined);
      await proxy.stop();
      isolation.dispose();
    }
  });
});

describe("connection check in Settings", () => {
  it("checks every service through the proxy and gives each one plain line with what to do", async () => {
    const proxy = new FixtureProxy();
    await proxy.start();
    const isolation = isolate("nuvo-net-check-e2e");
    const { app, page } = await launch(isolation);
    try {
      await passFirstRun(page);
      await setProxy(page, { mode: "manual", url: `http://127.0.0.1:${proxy.port}` });
      await page.evaluate(() => (location.hash = "#/settings?section=network"));
      await page.getByRole("button", { name: "Check connection" }).click();
      const lines = page.locator("li[data-state]");
      await expect.poll(() => lines.count(), { timeout: 30_000 }).toBe(7);
      expect(await lines.evaluateAll((items) => items.map((item) => item.getAttribute("data-state")))).toEqual(Array(7).fill("proxy_error"));
      expect(await lines.first().textContent()).toBe("YouTubeProxy error");
      expect(await lines.last().textContent()).toBe("UpdatesProxy errorThe proxy didn't let Nuvo through: check its address, username and password above.");
      const hosts = proxy.tunnels.map((tunnel) => tunnel.host);
      for (const host of [
        "music.youtube.com:443",
        "api-v2.soundcloud.com:443",
        "lrclib.net:443",
        "amp.shazam.com:443",
        "ws.audioscrobbler.com:443",
        "github.com:443",
      ]) {
        expect(hosts).toContain(host);
      }
    } finally {
      await app.close().catch(() => undefined);
      await proxy.stop();
      isolation.dispose();
    }
  });
});
