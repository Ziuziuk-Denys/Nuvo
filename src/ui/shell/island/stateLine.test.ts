import { describe, expect, it } from "vitest";
import { formatClock, stateLine, type StateLineInput } from "./stateLine";

const base: StateLineInput = {
  offline: false,
  sleepRemainingMs: null,
  playbackContext: "Late night drive",
  queueTitles: ["One", "Two", "Three", "Four"],
  currentIndex: 1,
  autoplayFrom: null,
};

describe("stateLine", () => {
  it("is empty when nothing is worth saying", () => {
    expect(stateLine(base)).toBeNull();
  });

  it("puts offline first, then sleep", () => {
    expect(stateLine({ ...base, offline: true, sleepRemainingMs: 60_000 })).toEqual({ kind: "offline" });
    expect(stateLine({ ...base, sleepRemainingMs: 750_000 })).toEqual({ kind: "sleep", clock: "12:30" });
    expect(stateLine({ ...base, sleepRemainingMs: 0 })).toBeNull();
  });

  it("shows save progress after sleep and before a radio reason", () => {
    expect(stateLine({ ...base, downloads: { done: 12, total: 40 } })).toEqual({ kind: "downloads", done: 12, total: 40 });
    expect(stateLine({ ...base, sleepRemainingMs: 60_000, downloads: { done: 1, total: 2 } })?.kind).toBe("sleep");
    expect(stateLine({ ...base, reason: "Because you like X", downloads: { done: 1, total: 2 } })?.kind).toBe("downloads");
  });

  it("names the seed of a radio station", () => {
    expect(stateLine({ ...base, playbackContext: "radio:abc" })).toEqual({ kind: "radio-seed", seed: "One" });
    expect(stateLine({ ...base, playbackContext: "radio:abc", queueTitles: [] })).toEqual({ kind: "radio-queue" });
  });

  it("says radio continues once playback passes the end of the queue", () => {
    expect(stateLine({ ...base, autoplayFrom: 3, currentIndex: 2 })).toBeNull();
    expect(stateLine({ ...base, autoplayFrom: 3, currentIndex: 3 })).toEqual({ kind: "radio-queue" });
  });

  it("puts the Not interested notice before everything else", () => {
    expect(stateLine({ ...base, offline: true, reason: "r", notice: "Gone" })).toEqual({ kind: "notice", text: "Gone" });
  });

  it("prefers the pick's reason to the radio line, but not to offline or sleep", () => {
    const reason = "Because you finished Roygbiv";
    expect(stateLine({ ...base, playbackContext: "radio:abc", reason })).toEqual({ kind: "reason", text: reason });
    expect(stateLine({ ...base, offline: true, reason })).toEqual({ kind: "offline" });
    expect(stateLine({ ...base, sleepRemainingMs: 60_000, reason })).toEqual({ kind: "sleep", clock: "1:00" });
    expect(stateLine({ ...base, reason: null })).toBeNull();
  });

  it("names the single track a search result radio grew from", () => {
    expect(stateLine({ ...base, autoplayFrom: 1, currentIndex: 1 })).toEqual({ kind: "radio-seed", seed: "One" });
  });
});

describe("formatClock", () => {
  it("rounds up to whole seconds and adds hours when needed", () => {
    expect(formatClock(59_001)).toBe("1:00");
    expect(formatClock(5_000)).toBe("0:05");
    expect(formatClock(3_725_000)).toBe("1:02:05");
    expect(formatClock(-10)).toBe("0:00");
  });
});
