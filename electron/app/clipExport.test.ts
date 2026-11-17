// @vitest-environment node
import { default as fs } from "node:fs";
import { default as os } from "node:os";
import { default as path } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createClipExport, saveFolder } from "./clipExport";
import type { CoreAnswer } from "./coreCall";

const answer = (status: number, body: unknown): CoreAnswer => ({ status, body: Buffer.from(JSON.stringify(body)), contentType: "application/json" });

function setup(over: { save?: string | null; call?: (method: string, route: string, body?: unknown) => Promise<CoreAnswer> } = {}) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "nuvo-clip-test-"));
  const call = vi.fn(over.call ?? (async (_m: string, _r: string, body?: unknown) => answer(200, { path: (body as { out: string }).out })));
  const pickSavePath = vi.fn(async () => (over.save === undefined ? "/home/u/Videos/Song.mp4" : over.save));
  const refuse = vi.fn();
  const clips = createClipExport({ call, pickSavePath, videosDir: () => "/home/u/Videos", tempDir: () => temp, refuse });
  return { clips, call, pickSavePath, refuse, temp };
}

const finish = (id: string) => ({ id, trackId: "t1", startMs: 1000, lenMs: 15000, fps: 60, fadeMs: 800 });

describe("clip export", () => {
  it("asks where to save, collects the video and hands both paths to the daemon", async () => {
    const { clips, call, pickSavePath, temp } = setup();
    const begun = await clips.begin({ name: "Glass Radio / Velvet" });
    expect(pickSavePath).toHaveBeenCalledWith("Save clip", "/home/u/Videos/Glass Radio _ Velvet.mp4");
    if (!begun || "error" in begun) throw new Error("not begun");
    expect(await clips.write({ id: begun.id, bytes: new Uint8Array([0, 0, 1]) })).toBe(true);
    expect(await clips.write({ id: begun.id, bytes: new Uint8Array([9]) })).toBe(true);

    const result = await clips.finish(finish(begun.id));

    expect(result).toEqual({ path: "/home/u/Videos/Song.mp4" });
    const [method, route, body] = call.mock.calls[0]!;
    expect([method, route]).toEqual(["POST", "/v1/fs/clips"]);
    expect(body).toMatchObject({ trackId: "t1", out: "/home/u/Videos/Song.mp4", startMs: 1000, lenMs: 15000, fps: 60, fadeMs: 800 });
    expect(path.dirname((body as { video: string }).video)).toBe(temp);
    expect(fs.readdirSync(temp)).toEqual([]);
  });

  it("hands the daemon the finished sound when the page rendered one, and removes it after", async () => {
    const { clips, call, temp } = setup();
    const begun = await clips.begin({ name: "x" });
    if (!begun || "error" in begun) throw new Error("not begun");
    expect(await clips.audio({ id: begun.id, bytes: new Uint8Array([82, 73, 70, 70]) })).toBe(true);
    await clips.finish(finish(begun.id));
    const body = call.mock.calls[0]![2] as { audio: string };
    expect(path.dirname(body.audio)).toBe(temp);
    expect(body.audio.endsWith(".wav")).toBe(true);
    expect(fs.readdirSync(temp)).toEqual([]);
    expect(await clips.audio({ id: "nope", bytes: new Uint8Array([1]) })).toBe(false);
  });

  it("adds .mp4 when the dialog leaves it off", async () => {
    const { clips, call } = setup({ save: "/home/u/Videos/mine" });
    const begun = await clips.begin({ name: "x" });
    if (!begun || "error" in begun) throw new Error("not begun");
    await clips.finish(finish(begun.id));
    expect((call.mock.calls[0]![2] as { out: string }).out).toBe("/home/u/Videos/mine.mp4");
  });

  it("does nothing when the dialog is closed", async () => {
    const { clips, call, temp } = setup({ save: null });
    expect(await clips.begin({ name: "x" })).toBeNull();
    expect(call).not.toHaveBeenCalled();
    expect(fs.readdirSync(temp)).toEqual([]);
  });

  it("refuses unknown ids and odd payloads", async () => {
    const { clips, refuse, call } = setup();
    expect(await clips.write({ id: "nope", bytes: new Uint8Array([1]) })).toBe(false);
    expect(await clips.write({ id: "nope", bytes: "text" })).toBe(false);
    expect(await clips.finish({ ...finish("nope") })).toEqual({ error: "the clip was not started" });
    expect(await clips.begin(null)).toBeNull();
    const begun = await clips.begin({ name: "x" });
    if (!begun || "error" in begun) throw new Error("not begun");
    expect(await clips.finish({ ...finish(begun.id), fps: "60" })).toBeNull();
    expect(refuse).toHaveBeenCalled();
    expect(call).not.toHaveBeenCalled();
  });

  it("removes the rendered video when cancelled or when the daemon refuses", async () => {
    const { clips, temp } = setup({ call: async () => answer(409, { message: "ffmpeg is not installed" }) });
    const first = await clips.begin({ name: "x" });
    if (!first || "error" in first) throw new Error("not begun");
    await clips.write({ id: first.id, bytes: new Uint8Array([1]) });
    expect(await clips.finish(finish(first.id))).toEqual({ error: "ffmpeg is not installed" });
    const second = await clips.begin({ name: "x" });
    if (!second || "error" in second) throw new Error("not begun");
    await clips.write({ id: second.id, bytes: new Uint8Array([1]) });
    await clips.cancel({ id: second.id });
    expect(fs.readdirSync(temp)).toEqual([]);
    expect(await clips.write({ id: second.id, bytes: new Uint8Array([1]) })).toBe(false);
  });

  it("opens the save dialog in Videos, or in Home when Videos does not exist", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "nuvo-home-"));
    const videos = path.join(home, "Videos");
    expect(saveFolder(videos, home)).toBe(home);
    fs.mkdirSync(videos);
    expect(saveFolder(videos, home)).toBe(videos);
    fs.rmSync(home, { recursive: true });
  });
});
