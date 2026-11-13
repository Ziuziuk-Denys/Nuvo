import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { default as path } from "node:path";
import { expect, it, describe } from "vitest";
import { loadKwinScript, unloadKwinScript } from "./kwin";

const base = ["call", "--session", "--dest", "org.kde.KWin"];

describe("loadKwinScript", () => {
  it("writes the script, reloads it and runs it through gdbus", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "nuvo-kwin-"));
    const calls: Array<[string, string[]]> = [];
    const run = async (cmd: string, args: string[]) => {
      calls.push([cmd, args]);
      return args.includes("org.kde.kwin.Scripting.loadScript") ? "(7,)\n" : "()\n";
    };
    expect(await loadKwinScript("// script", run, dir)).toBe(true);
    const file = path.join(dir, "notch-kwin.js");
    expect(readFileSync(file, "utf8")).toBe("// script");
    expect(calls).toEqual([
      ["gdbus", [...base, "--object-path", "/Scripting", "--method", "org.kde.kwin.Scripting.unloadScript", "nuvo-notch"]],
      ["gdbus", [...base, "--object-path", "/Scripting", "--method", "org.kde.kwin.Scripting.loadScript", file, "nuvo-notch"]],
      ["gdbus", [...base, "--object-path", "/Scripting", "--method", "org.kde.kwin.Scripting.start"]],
    ]);
  });

  it("accepts script id 0, the first id KWin hands out", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "nuvo-kwin-"));
    const run = async (_cmd: string, args: string[]) => (args.includes("org.kde.kwin.Scripting.loadScript") ? "(0,)\n" : "()\n");
    expect(await loadKwinScript("x", run, dir)).toBe(true);
  });

  it("returns false when KWin refuses the script", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "nuvo-kwin-"));
    const run = async (_cmd: string, args: string[]) => (args.includes("org.kde.kwin.Scripting.loadScript") ? "(-1,)\n" : "()\n");
    expect(await loadKwinScript("x", run, dir)).toBe(false);
  });

  it("ignores unload errors and returns false when loading fails", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "nuvo-kwin-"));
    const run = async (_cmd: string, args: string[]) => {
      if (args.includes("org.kde.kwin.Scripting.unloadScript")) throw new Error("not loaded");
      return "garbage";
    };
    expect(await loadKwinScript("x", run, dir)).toBe(false);
  });
});

describe("unloadKwinScript", () => {
  it("unloads the nuvo-notch plugin and ignores errors", async () => {
    const calls: Array<[string, string[]]> = [];
    await unloadKwinScript(async (cmd, args) => {
      calls.push([cmd, args]);
      throw new Error("KWin gone");
    });
    expect(calls).toEqual([["gdbus", [...base, "--object-path", "/Scripting", "--method", "org.kde.kwin.Scripting.unloadScript", "nuvo-notch"]]]);
  });
});
