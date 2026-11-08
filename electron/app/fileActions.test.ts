// @vitest-environment node
import { default as fs } from "node:fs";
import { default as os } from "node:os";
import { default as path } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { CoreAnswer } from "./coreCall";
import { createFileActions } from "./fileActions";
import { writeBufferAtomic } from "./files";

const answer = (status: number, body: unknown): CoreAnswer => ({
  status,
  body: Buffer.from(typeof body === "string" ? body : JSON.stringify(body)),
  contentType: "application/json",
});
const LOCAL = `local:${"b".repeat(32)}`;

function setup(over: { call?: (method: string, route: string, body?: unknown) => Promise<CoreAnswer>; folder?: string | null; save?: string | null } = {}) {
  let last: string | null = null;
  const call = vi.fn(over.call ?? (async () => answer(202, { id: "job1" })));
  const pickFolder = vi.fn(async () => (over.folder === undefined ? "/home/u/Music/out" : over.folder));
  const pickSavePath = vi.fn(async () => (over.save === undefined ? "/tmp/x/Mix.m3u8" : over.save));
  const showInFolder = vi.fn();
  const refuse = vi.fn();
  const writeFile = vi.fn(async () => undefined);
  const actions = createFileActions({
    call,
    pickFolder,
    pickSavePath,
    musicDir: () => "/home/u/Music",
    documentsDir: () => "/home/u/Documents",
    lastDir: { get: () => last, set: (dir) => (last = dir) },
    showInFolder,
    writeFile,
    refuse,
  });
  return { actions, call, pickFolder, pickSavePath, showInFolder, refuse, writeFile };
}

const files = { trackIds: ["dQw4w9WgXcQ"], label: "Mix", format: "original", playlistFile: true };

describe("recognize a file", () => {
  it("hands the page the daemon's id for the path", async () => {
    const s = setup({ call: async () => answer(200, { id: "grant1" }) });
    expect(await s.actions.grantRecognizeFile({ path: "/home/u/clip.mp3" })).toEqual({ id: "grant1" });
    expect(s.call).toHaveBeenCalledWith("POST", "/v1/fs/recognize/file", { path: "/home/u/clip.mp3" });
  });

  it("refuses anything but an absolute path, and survives a daemon that is down", async () => {
    const s = setup();
    for (const payload of [null, {}, { path: 1 }, { path: "clip.mp3" }]) expect(await s.actions.grantRecognizeFile(payload)).toBeNull();
    expect(s.call).not.toHaveBeenCalled();
    expect(s.refuse).toHaveBeenCalledTimes(4);
    const down = setup({ call: () => Promise.reject(new Error("gone")) });
    expect(await down.actions.grantRecognizeFile({ path: "/a.mp3" })).toBeNull();
  });
});

describe("save as files", () => {
  it("sends the folder from the dialog, never one the page named", async () => {
    const s = setup();
    const result = await s.actions.saveFiles({ ...files, dir: "/etc", path: "/root" });
    expect(result).toEqual({ jobId: "job1" });
    expect(s.call).toHaveBeenCalledWith("POST", "/v1/fs/downloads", { ...files, dir: "/home/u/Music/out" });
  });

  it("does nothing when the dialog is closed, and opens no dialog for a bad payload", async () => {
    const closed = setup({ folder: null });
    expect(await closed.actions.saveFiles(files)).toBeNull();
    expect(closed.call).not.toHaveBeenCalled();
    const bad = setup();
    expect(await bad.actions.saveFiles({ ...files, trackIds: ["/etc/passwd"] })).toBeNull();
    expect(bad.pickFolder).not.toHaveBeenCalled();
    expect(bad.refuse).toHaveBeenCalledWith("export:save-files", "shape");
  });

  it("reports the daemon's refusal and an unreachable daemon", async () => {
    expect(await setup({ call: async () => answer(400, { message: "the folder is gone" }) }).actions.saveFiles(files)).toEqual({ error: "the folder is gone" });
    const down = await setup({ call: async () => Promise.reject(new Error("ENOENT")) }).actions.saveFiles(files);
    expect(down).toEqual({ error: "nuvo-core is not running" });
  });
});

describe("the remembered folder", () => {
  it("is set only after the daemon accepted the save", async () => {
    const refused = setup({ call: async () => answer(400, { message: "no" }) });
    await refused.actions.saveFiles(files);
    await refused.actions.saveFiles(files);
    expect(refused.pickFolder).toHaveBeenLastCalledWith("Save as files", "/home/u/Music");
    const accepted = setup();
    await accepted.actions.saveFiles(files);
    await accepted.actions.saveFiles(files);
    expect(accepted.pickFolder).toHaveBeenLastCalledWith("Save as files", "/home/u/Music/out");
  });
});

describe("add a music folder", () => {
  it("scans the picked folder and reports a refusal", async () => {
    const ok = setup({ call: async () => answer(202, { id: 3, path: "/home/u/Music/out" }) });
    expect(await ok.actions.addFolder()).toEqual({ root: { id: 3, path: "/home/u/Music/out" } });
    expect(ok.call).toHaveBeenCalledWith("POST", "/v1/fs/local/roots", { path: "/home/u/Music/out" });
    expect(await setup({ call: async () => answer(400, { message: "system folders cannot be music folders" }) }).actions.addFolder()).toEqual({
      error: "system folders cannot be music folders",
    });
    const closed = setup({ folder: null });
    expect(await closed.actions.addFolder()).toBeNull();
    expect(closed.call).not.toHaveBeenCalled();
  });
});

describe("reveal a local track", () => {
  it("accepts only local ids and shows the path the daemon names", async () => {
    const s = setup({ call: async () => answer(200, { path: "/home/u/Music/a.flac" }) });
    expect(await s.actions.reveal({ trackId: "../../etc" })).toBe(false);
    expect(await s.actions.reveal({ trackId: "dQw4w9WgXcQ" })).toBe(false);
    expect(s.call).not.toHaveBeenCalled();
    expect(await s.actions.reveal({ trackId: LOCAL })).toBe(true);
    expect(s.call).toHaveBeenCalledWith("GET", `/v1/fs/local/tracks/${encodeURIComponent(LOCAL)}/path`);
    expect(s.showInFolder).toHaveBeenCalledWith("/home/u/Music/a.flac");
    expect(await setup({ call: async () => answer(404, { message: "gone" }) }).actions.reveal({ trackId: LOCAL })).toBe(false);
  });
});

describe("save a document", () => {
  const request = { kind: "playlist", id: "p1", title: "Road / Trip", format: "m3u8" };

  it("writes what the daemon exports to the path from the dialog", async () => {
    const s = setup({ call: async () => answer(200, "#EXTM3U\n"), save: "/tmp/x/Mix.m3u8" });
    expect(await s.actions.saveDocument(request)).toEqual({ path: "/tmp/x/Mix.m3u8" });
    expect(s.call).toHaveBeenCalledWith("GET", "/v1/fs/export/playlists/p1?format=m3u8");
    expect(s.writeFile).toHaveBeenCalledWith("/tmp/x/Mix.m3u8", Buffer.from("#EXTM3U\n"));
    expect(s.pickSavePath).toHaveBeenCalledWith(expect.any(String), path.join("/home/u/Documents", "Road _ Trip.m3u8"));
  });

  it("exports the listening history of a range, or all of it", async () => {
    const s = setup({ call: async () => answer(200, "{}"), save: "/tmp/x/Nuvo listening.json" });
    await s.actions.saveDocument({ kind: "stats", format: "json", from: "2026-10-01", to: "2026-10-31" });
    expect(s.call).toHaveBeenCalledWith("GET", "/v1/fs/export/stats?format=json&from=2026-10-01&to=2026-10-31");
    await s.actions.saveDocument({ kind: "stats", format: "csv" });
    expect(s.call).toHaveBeenCalledWith("GET", "/v1/fs/export/stats?format=csv");
    expect(await s.actions.saveDocument({ kind: "stats", format: "csv", from: "yesterday", to: "2026-10-31" })).toBeNull();
    expect(await s.actions.saveDocument({ kind: "stats", format: "m3u8" })).toBeNull();
  });

  it("writes nothing when cancelled, refused or malformed", async () => {
    const cancelled = setup({ save: null });
    expect(await cancelled.actions.saveDocument(request)).toBeNull();
    expect(cancelled.call).not.toHaveBeenCalled();
    const refused = setup({ call: async () => answer(404, { message: "playlist not found" }) });
    expect(await refused.actions.saveDocument(request)).toEqual({ error: "playlist not found" });
    expect(refused.writeFile).not.toHaveBeenCalled();
    const bad = setup();
    expect(await bad.actions.saveDocument({ kind: "playlist", id: "../x", title: "t", format: "csv" })).toBeNull();
    expect(bad.pickSavePath).not.toHaveBeenCalled();
  });
});

describe("writeBufferAtomic", () => {
  it("replaces the target whole and leaves no temporary file", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nuvo-doc-"));
    try {
      const target = path.join(dir, "Mix.m3u8");
      fs.writeFileSync(target, "old");
      await writeBufferAtomic(target, Buffer.from("new"));
      expect(fs.readFileSync(target, "utf8")).toBe("new");
      expect(fs.readdirSync(dir)).toEqual(["Mix.m3u8"]);
      await expect(writeBufferAtomic(path.join(dir, "missing", "x"), Buffer.from("x"))).rejects.toThrow();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
