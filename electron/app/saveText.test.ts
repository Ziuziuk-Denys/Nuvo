// @vitest-environment node
import { default as fs } from "node:fs";
import { default as os } from "node:os";
import { default as path } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MAX_SAVE_TEXT_CHARS, saveFilter, validateSaveText, writeTextAtomic } from "./saveText";

describe("validateSaveText", () => {
  it("accepts a csv name and its text", () => {
    expect(validateSaveText({ name: "Late drive report.csv", text: "a,b\n" })).toEqual({ name: "Late drive report.csv", text: "a,b\n" });
  });

  it("accepts a txt name for the recovery phrase, with a text filter", () => {
    expect(validateSaveText({ name: "Nuvo recovery phrase.txt", text: "1. echo\n" })).toEqual({ name: "Nuvo recovery phrase.txt", text: "1. echo\n" });
    expect(saveFilter("Nuvo recovery phrase.txt")).toEqual({ name: "Text", extensions: ["txt"] });
    expect(saveFilter("report.csv")).toEqual({ name: "CSV", extensions: ["csv"] });
  });

  it("flattens folders out of the name", () => {
    expect(validateSaveText({ name: "Mixes/late\\drive.csv", text: "" })).toEqual({ name: "Mixes late drive.csv", text: "" });
  });

  it("refuses other types, hidden files, long names, huge text and odd payloads", () => {
    for (const payload of [
      { name: "report.sh", text: "" },
      { name: ".report.csv", text: "" },
      { name: "../../.bashrc/x.csv", text: "" },
      { name: `${"x".repeat(130)}.csv`, text: "" },
      { name: "report.csv", text: "x".repeat(MAX_SAVE_TEXT_CHARS + 1) },
      { name: "report.csv", text: 1 },
      { name: "   ", text: "" },
      null,
      "report.csv",
    ]) {
      expect(validateSaveText(payload)).toBeNull();
    }
  });
});

describe("writeTextAtomic", () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach((d) => fs.rmSync(d, { recursive: true, force: true })));
  const dir = () => {
    const created = fs.mkdtempSync(path.join(process.env.NUVO_TEST_DIR ?? os.tmpdir(), "save-"));
    dirs.push(created);
    return created;
  };

  it("writes the file and leaves no temporary file behind", async () => {
    const folder = dir();
    const target = path.join(folder, "r.csv");
    await writeTextAtomic(target, "a,b\n");
    expect(fs.readFileSync(target, "utf8")).toBe("a,b\n");
    expect(fs.readdirSync(folder)).toEqual(["r.csv"]);
  });

  it("keeps the old file when the write fails", async () => {
    const folder = dir();
    const target = path.join(folder, "r.csv");
    fs.writeFileSync(target, "old");
    const blocked = path.join(folder, "blocked.csv");
    fs.mkdirSync(blocked);
    await expect(writeTextAtomic(blocked, "new")).rejects.toThrow();
    expect(fs.readFileSync(target, "utf8")).toBe("old");
    expect(fs.readdirSync(folder).sort()).toEqual(["blocked.csv", "r.csv"]);
  });
});
