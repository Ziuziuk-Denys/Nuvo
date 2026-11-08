import { describe, expect, it } from "vitest";
import { statusLine } from "./connection";

const calm = { core: "ready", locked: false, reachable: true, offlineSeen: false, startingLong: false } as const;

describe("statusLine", () => {
  it("says nothing when all is well or the daemon is still starting", () => {
    expect(statusLine(calm)).toBeNull();
    expect(statusLine({ ...calm, core: "starting" })).toBeNull();
  });

  it("tells a slow start only once it has taken a while", () => {
    expect(statusLine({ ...calm, core: "starting", startingLong: true })).toEqual({ kind: "daemon-starting" });
    expect(statusLine({ ...calm, core: "ready", startingLong: true })).toBeNull();
  });

  it("reports a restarting or stopped daemon", () => {
    expect(statusLine({ ...calm, core: "restarting" })).toEqual({ kind: "daemon-retrying" });
    expect(statusLine({ ...calm, core: "failed" })).toEqual({ kind: "daemon-failed" });
  });

  it("lets daemon trouble win over offline", () => {
    expect(statusLine({ ...calm, core: "restarting", reachable: false })).toEqual({ kind: "daemon-retrying" });
    expect(statusLine({ ...calm, core: "failed", reachable: false })).toEqual({ kind: "daemon-failed" });
  });

  it("reports offline only until it has been seen once", () => {
    expect(statusLine({ ...calm, reachable: false })).toEqual({ kind: "offline" });
    expect(statusLine({ ...calm, reachable: false, offlineSeen: true })).toBeNull();
  });

  it("leaves offline to the lock screen while the library is locked", () => {
    expect(statusLine({ ...calm, reachable: false, locked: true })).toBeNull();
  });
});
