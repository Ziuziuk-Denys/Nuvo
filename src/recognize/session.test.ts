// @vitest-environment node
import { describe, expect, it } from "vitest";
import { advance, IDLE, listening, songFacts, timeAgo, type Session } from "./session";

const song = { title: "I Will Survive", artist: "Gloria Gaynor", via: "mix", input: { kind: "file", label: "a.mp3" } };
const peaks = Array.from({ length: 48 }, () => 0.5);

describe("a recognize session", () => {
  it("follows a file from reading to a result", () => {
    let session: Session = listening("file");
    session = advance(session, { type: "stage", name: "fetching", detail: "a.mp3" });
    expect(session).toMatchObject({ step: "capture", detail: "a.mp3" });
    session = advance(session, { type: "stage", name: "listening", attempt: 2, of: 6, via: "side", envelope: peaks });
    expect(session).toMatchObject({ step: "check", attempt: 2, of: 6, voiceRemoved: true, peaks });
    session = advance(session, { type: "stage", name: "waiting", seconds: 5 });
    expect(session).toMatchObject({ step: "wait", seconds: 5, peaks });
    session = advance(session, { type: "result", id: "r1", track: song as never });
    expect(session).toEqual({ phase: "found", id: "r1", song });
  });

  it("ends in no match or a failure, and keeps which input it was", () => {
    expect(advance(listening("file"), { type: "notFound", more: true })).toEqual({ phase: "not_found", input: "file", more: true });
    expect(advance(listening("microphone"), { type: "notFound" })).toEqual({ phase: "not_found", input: "microphone", more: false });
    expect(advance(listening("system"), { type: "error", code: "no_capture" })).toEqual({ phase: "failed", input: "system", code: "no_capture" });
  });

  it("ignores events after it ended and events it does not know", () => {
    expect(advance(IDLE, { type: "result", id: "x", track: song as never })).toBe(IDLE);
    const session = listening("system");
    expect(advance(session, { type: "hint", title: "t", artist: "a" })).toBe(session);
  });
});

describe("words for a song", () => {
  it("joins what is known", () => {
    expect(songFacts({ album: "Love Tracks", released: "1978", genre: "Pop" })).toBe("Love Tracks · 1978 · Pop");
    expect(songFacts({ genre: "Pop" })).toBe("Pop");
    expect(songFacts({})).toBe("");
  });

  it("says how long ago, in the app's language", () => {
    const now = Date.parse("2026-11-07T12:00:00Z");
    expect(timeAgo("2026-11-07T11:59:30Z", now, "en")).toBe("now");
    expect(timeAgo("2026-11-07T11:55:00Z", now, "en")).toBe("5 minutes ago");
    expect(timeAgo("2026-11-07T09:00:00Z", now, "en")).toBe("3 hours ago");
    expect(timeAgo("2026-11-06T12:00:00Z", now, "en")).toBe("yesterday");
    expect(timeAgo("2026-11-07T11:55:00Z", now, "ru")).toBe("5 минут назад");
  });
});
