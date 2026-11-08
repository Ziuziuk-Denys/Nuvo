import fs from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi, afterEach } from "vitest";
import type { SurfaceState } from "../../src/engine/types";
import { buildActivity, DiscordPresence, encodeFrame, FrameDecoder, OP, socketCandidates } from "./discord";

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
  upNext: [],
  ...extra,
});

let dirs: string[] = [];
const tempDir = () => {
  const dir = fs.mkdtempSync(path.join(tmpdir(), "nuvo-discord-"));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  vi.useRealTimers();
  dirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true }));
  dirs = [];
});

/** A fake Discord client socket server. */
async function fakeDiscord(dir: string, name = "discord-ipc-0") {
  const socketPath = path.join(dir, name);
  const frames: Array<{ op: number; payload: Record<string, unknown> }> = [];
  const sockets: net.Socket[] = [];
  const server = net.createServer((socket) => {
    sockets.push(socket);
    const decoder = new FrameDecoder();
    socket.on("data", (chunk) => {
      for (const frame of decoder.push(chunk)) {
        frames.push(frame as { op: number; payload: Record<string, unknown> });
        if (frame.op === OP.handshake) socket.write(encodeFrame(OP.frame, { evt: "READY", data: {} }));
      }
    });
    socket.on("error", () => undefined);
  });
  await new Promise<void>((resolve) => server.listen(socketPath, resolve));
  return {
    frames,
    sockets,
    socketPath,
    close: () =>
      new Promise<void>((resolve) => {
        sockets.forEach((s) => s.destroy());
        server.close(() => resolve());
      }),
  };
}

const settle = (ms = 50) => new Promise((resolve) => setTimeout(resolve, ms));

function presence(dir: string, applicationId = "123", log = vi.fn()) {
  return new DiscordPresence({
    applicationId,
    candidates: () => [path.join(dir, "discord-ipc-0")],
    connect: (p) => net.createConnection(p),
    now: () => Date.now(),
    pid: 4242,
    log,
  });
}

describe("discord presence", () => {
  it("off by default: no socket, no timer", () => {
    const connect = vi.fn();
    const p = new DiscordPresence({ applicationId: "123", candidates: () => ["/x"], connect, now: Date.now, pid: 1, log: vi.fn() });
    p.update(state());
    expect(connect).not.toHaveBeenCalled();
    expect(p.hasTimers).toBe(false);
  });

  it("an empty application id stays off with the message", () => {
    const connect = vi.fn();
    const p = new DiscordPresence({ applicationId: "", candidates: () => ["/x"], connect, now: Date.now, pid: 1, log: vi.fn() });
    p.setEnabled(true);
    expect(p.current).toEqual({ state: "off", message: "Discord presence is not configured in this build." });
    expect(connect).not.toHaveBeenCalled();
  });

  it("80 socket candidates in order", () => {
    const list = socketCandidates({ XDG_RUNTIME_DIR: "/run/user/1000" }, "linux");
    expect(list).toHaveLength(80);
    expect(list.slice(0, 2)).toEqual(["/run/user/1000/discord-ipc-0", "/run/user/1000/discord-ipc-1"]);
    expect(list[10]).toBe("/run/user/1000/app/com.discordapp.Discord/discord-ipc-0");
    expect(list.at(-1)).toBe("/tmp/.flatpak/dev.vencord.Vesktop/xdg-run/discord-ipc-9");
  });

  it("uses named pipes on Windows", () => {
    const list = socketCandidates({}, "win32");
    expect(list).toHaveLength(10);
    expect(list[0]).toBe("\\\\?\\pipe\\discord-ipc-0");
  });

  it("frames encode and reassemble", () => {
    const payload = { data: "x".repeat(300 - 11) };
    const frame = encodeFrame(1, payload);
    expect(frame.length).toBe(8 + Buffer.byteLength(JSON.stringify(payload)));
    expect(frame.readUInt32LE(0)).toBe(1);
    const two = Buffer.concat([encodeFrame(1, { a: 1 }), encodeFrame(3, { b: 2 })]);
    expect(new FrameDecoder().push(two)).toEqual([
      { op: 1, payload: { a: 1 } },
      { op: 3, payload: { b: 2 } },
    ]);
    const decoder = new FrameDecoder();
    const parts = [frame.subarray(0, 3), frame.subarray(3, 100), frame.subarray(100)];
    expect([...decoder.push(parts[0]), ...decoder.push(parts[1]), ...decoder.push(parts[2])]).toEqual([{ op: 1, payload }]);
  });

  it("the handshake carries v 1 and the application id", async () => {
    const dir = tempDir();
    const server = await fakeDiscord(dir);
    const p = presence(dir);
    p.setEnabled(true);
    await settle();
    expect(server.frames[0]).toEqual({ op: OP.handshake, payload: { v: 1, client_id: "123" } });
    expect(p.current.state).toBe("connected");
    p.stop();
    await server.close();
  });

  it("the activity draws progress from position and duration", () => {
    const activity = buildActivity(state(), 1_000_000)!;
    expect(activity).toMatchObject({ type: 2, details: "Song", state: "Artist", timestamps: { start: 970_000, end: 1_170_000 } });
  });

  it("text fields are cut to 128 and padded to 2", () => {
    const activity = buildActivity(state({ title: "t".repeat(200), artists: "X" }), 0)!;
    expect(activity.details).toHaveLength(128);
    expect(activity.state).toBe("X ");
  });

  it("fit handles surrogate pairs at the boundary", () => {
    const activity = buildActivity(state({ title: "a".repeat(127) + "😀" }), 0)!;
    expect(Array.from(activity.details).length).toBeLessThanOrEqual(128);
  });

  it("one button for a public page; the cover or the uploaded asset", () => {
    const yt = buildActivity(state({ sourcePageUrl: "https://music.youtube.com/watch?v=dQw4w9WgXcQ", publicCoverUrl: "https://i.ytimg.com/vi/x/hq.jpg" }), 0)!;
    expect(yt.buttons).toEqual([{ label: "Open track", url: "https://music.youtube.com/watch?v=dQw4w9WgXcQ" }]);
    expect(yt.assets.large_image).toBe("https://i.ytimg.com/vi/x/hq.jpg");
    const bare = buildActivity(state(), 0)!;
    expect(bare.buttons).toBeUndefined();
    expect(bare.assets.large_image).toBe("nuvo");
  });

  it("privacy: image only from approved hosts, page url https with no userinfo", () => {
    const badImage = buildActivity(state({ publicCoverUrl: "https://evil.com/img.jpg" }), 0)!;
    expect(badImage.assets.large_image).toBe("nuvo");
    const httpUrl = buildActivity(state({ sourcePageUrl: "http://music.youtube.com/watch?v=dQw4w9WgXcQ" }), 0)!;
    expect(httpUrl.buttons).toBeUndefined();
    const userinfo = buildActivity(state({ sourcePageUrl: "https://user:pass@music.youtube.com/watch" }), 0)!;
    expect(userinfo.buttons).toBeUndefined();
    const approvedImage = buildActivity(state({ publicCoverUrl: "https://i.ytimg.com/vi/x/hq.jpg" }), 0)!;
    expect(approvedImage.assets.large_image).toBe("https://i.ytimg.com/vi/x/hq.jpg");
  });

  it("button label is capped to 32 chars", () => {
    const activity = buildActivity(state({ sourcePageUrl: "https://music.youtube.com/watch?v=dQw4w9WgXcQ" }), 0)!;
    expect(Array.from(activity.buttons?.[0].label ?? "").length).toBeLessThanOrEqual(32);
  });

  it("button URL is capped to 512 chars", () => {
    const longPath = "q=".repeat(260);
    const activity = buildActivity(state({ sourcePageUrl: `https://music.youtube.com/watch?${longPath}` }), 0)!;
    expect(activity.buttons).toBeUndefined();
  });

  it("five track changes in 3 s send two activities", async () => {
    const dir = tempDir();
    const server = await fakeDiscord(dir);
    const p = presence(dir);
    p.setEnabled(true);
    await settle();
    const before = server.frames.length;
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    for (let i = 0; i < 5; i++) {
      p.update(state({ trackId: `track${i}abcd` }));
      vi.advanceTimersByTime(600);
    }
    vi.advanceTimersByTime(4000);
    vi.useRealTimers();
    await settle();
    const sent = server.frames.slice(before).filter((f) => f.payload.cmd === "SET_ACTIVITY");
    expect(sent).toHaveLength(2);
    expect((sent[1].payload.args as { activity: { details: string } }).activity.details).toBe("Song");
    p.stop();
    await server.close();
  });

  it("a pause clears the activity", async () => {
    const dir = tempDir();
    const server = await fakeDiscord(dir);
    const p = presence(dir);
    p.update(state());
    p.setEnabled(true);
    await settle();
    await new Promise((r) => setTimeout(r, 10));
    p.update(state({ status: "paused" }));
    await settle(4100);
    const last = server.frames.filter((f) => f.payload.cmd === "SET_ACTIVITY").at(-1)!;
    expect((last.payload.args as { activity: unknown }).activity).toBeNull();
    p.stop();
    await server.close();
  }, 10_000);

  it("no client: retries every 30 s, logs once", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const log = vi.fn();
    const connect = vi.fn(() => {
      const s = new net.Socket();
      queueMicrotask(() => s.emit("error", new Error("ENOENT")));
      return s;
    });
    const p = new DiscordPresence({ applicationId: "123", candidates: () => ["/nope"], connect, now: Date.now, pid: 1, log });
    p.setEnabled(true);
    await vi.advanceTimersByTimeAsync(10);
    expect(p.current.state).toBe("no_client");
    await vi.advanceTimersByTimeAsync(30_000);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(connect).toHaveBeenCalledTimes(3);
    expect(log).toHaveBeenCalledTimes(1);
    p.stop();
  });

  it("a restarted server is reconnected with the current activity", async () => {
    const dir = tempDir();
    let server = await fakeDiscord(dir);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const p = presence(dir);
    p.update(state());
    p.setEnabled(true);
    vi.useRealTimers();
    await settle();
    await server.close();
    await settle();
    expect(p.current.state).toBe("connecting");
    server = await fakeDiscord(dir);
    (p as unknown as { retry: ReturnType<typeof setTimeout> | null }).retry && clearTimeout((p as unknown as { retry: ReturnType<typeof setTimeout> }).retry);
    (p as unknown as { retry: null }).retry = null;
    await (p as unknown as { connect(): Promise<void> }).connect();
    await settle();
    expect(p.current.state).toBe("connected");
    expect(server.frames.some((f) => f.payload.cmd === "SET_ACTIVITY")).toBe(true);
    p.stop();
    await server.close();
  });

  it("disabling sends a close frame and leaves no timer", async () => {
    const dir = tempDir();
    const server = await fakeDiscord(dir);
    const p = presence(dir);
    p.setEnabled(true);
    await settle();
    p.setEnabled(false);
    await settle();
    expect(server.frames.at(-1)?.op).toBe(OP.close);
    expect(p.hasTimers).toBe(false);
    await server.close();
  });

  it("pings are answered with the same payload", async () => {
    const dir = tempDir();
    const server = await fakeDiscord(dir);
    const p = presence(dir);
    p.setEnabled(true);
    await settle();
    const received: Array<{ op: number; payload: unknown }> = [];
    const client = server.sockets[0];
    const decoder = new FrameDecoder();
    const spy = vi.spyOn(net.Socket.prototype, "write");
    client.write(encodeFrame(OP.ping, { n: 7 }));
    await settle();
    for (const call of spy.mock.calls) {
      const chunk = call[0];
      if (Buffer.isBuffer(chunk)) received.push(...decoder.push(chunk));
    }
    spy.mockRestore();
    expect(received).toContainEqual({ op: OP.pong, payload: { n: 7 } });
    p.stop();
    await server.close();
  });

  it("enable/disable/enable does not start two connect loops", async () => {
    const dir = tempDir();
    let server = await fakeDiscord(dir);
    const p = presence(dir);
    p.setEnabled(true);
    await settle(20);
    p.setEnabled(false);
    await settle(20);
    const socketsBefore = server.sockets.length;
    p.setEnabled(true);
    await settle(50);
    expect(server.sockets.length).toBeLessThanOrEqual(socketsBefore + 1);
    p.stop();
    await server.close();
  });
});
