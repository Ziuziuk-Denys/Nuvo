// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { notesFor, takeWhatsNew } from "./releaseNotes";

const CHANGELOG = "# Changelog\n\n## 0.3.0\n\nFaster start.\n\n- Sort the library.\n- Zoom keys.\n\n## 0.2.10\n\n- First release.\n";

describe("release notes", () => {
  beforeEach(() => localStorage.clear());

  it("reads one version's section, and nothing for a version without one", () => {
    expect(notesFor("0.3.0", "en", CHANGELOG)).toEqual(["Faster start.", "", "- Sort the library.", "- Zoom keys."]);
    expect(notesFor("0.2.10", "en", CHANGELOG)).toEqual(["- First release."]);
    expect(notesFor("0.2.1", "en", CHANGELOG)).toEqual([]);
  });

  it("shows the human part or the reader's language, never the full list", () => {
    const text = "## 0.4.0\n\nScene.\n\n- **Beat.** Drawn.\n\n### По-русски\n\nСцена.\n\n### All changes\n\n#### New\n\n- Scene\n\n## 0.3.0\n\n- Old.\n";
    expect(notesFor("0.4.0", "en", text)).toEqual(["Scene.", "", "- **Beat.** Drawn."]);
    expect(notesFor("0.4.0", "ru", text)).toEqual(["Сцена."]);
    expect(notesFor("0.3.0", "ru", text)).toEqual(["- Old."]);
  });

  it("the bundled changelog has a section for the version in package.json", async () => {
    const { APP_VERSION } = await import("./version");
    expect(notesFor(APP_VERSION).length).toBeGreaterThan(0);
  });

  it("opens once after an update with notes, never on a first start", () => {
    expect(takeWhatsNew("0.2.10", true)).toBe(false);
    expect(takeWhatsNew("0.2.10", true)).toBe(false);
    expect(takeWhatsNew("0.3.0", true)).toBe(true);
    expect(takeWhatsNew("0.3.0", true)).toBe(false);
    expect(takeWhatsNew("0.3.1", false)).toBe(false);
  });
});
