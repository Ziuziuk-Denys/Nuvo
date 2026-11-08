// @vitest-environment node
import { describe, expect, it } from "vitest";
import { documentName, validateSaveDocument, validateSaveFiles } from "./files";

const L = `local:${"a".repeat(32)}`;

describe("export payloads", () => {
  it("accepts only ids, never paths", () => {
    expect(validateSaveFiles({ trackIds: [L, "dQw4w9WgXcQ"], label: "Mix", format: "original", playlistFile: true })).toEqual({
      trackIds: [L, "dQw4w9WgXcQ"],
      label: "Mix",
      format: "original",
      playlistFile: true,
    });
    expect(
      validateSaveFiles({ playlistId: "6f1c2c1e-1111-4222-8333-444455556666", label: "Mix", format: "mp3", playlistFile: false })?.playlistId,
    ).toBeDefined();
    expect(validateSaveFiles({ liked: true, label: "Liked", format: "original", playlistFile: false })?.liked).toBe(true);
    expect(validateSaveFiles({ trackIds: ["/etc/passwd"], label: "x", format: "original", playlistFile: false })).toBeNull();
    expect(validateSaveFiles({ trackIds: [], label: "x", format: "original", playlistFile: false })).toBeNull();
    expect(validateSaveFiles({ trackIds: ["a"], label: "x", format: "flac", playlistFile: false })).toBeNull();
    expect(validateSaveFiles({ trackIds: Array(5001).fill("dQw4w9WgXcQ"), label: "x", format: "original", playlistFile: false })).toBeNull();
    expect(validateSaveDocument({ kind: "playlist", id: "p1", title: "Mix", format: "m3u8" })).toEqual({
      kind: "playlist",
      id: "p1",
      title: "Mix",
      format: "m3u8",
    });
    expect(validateSaveDocument({ kind: "library", format: "m3u8" })).toBeNull();
    expect(validateSaveDocument({ kind: "playlist", id: "../x", title: "Mix", format: "csv" })).toBeNull();
  });

  it("names documents safely", () => {
    expect(documentName("Road / Trip: 2026", "m3u8")).toBe("Road _ Trip_ 2026.m3u8");
    expect(documentName("..", "json")).toBe("Nuvo.json");
  });
});
