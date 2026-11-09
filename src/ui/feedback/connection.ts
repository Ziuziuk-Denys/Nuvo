import type { CoreStatus } from "../ports/core";

export type StatusLine = { kind: "daemon-starting" | "daemon-retrying" | "daemon-failed" | "offline" };

export function statusLine(input: { core: CoreStatus; locked: boolean; reachable: boolean; offlineSeen: boolean; startingLong: boolean }): StatusLine | null {
  if (input.core === "starting" && input.startingLong) return { kind: "daemon-starting" };
  if (input.core === "restarting") return { kind: "daemon-retrying" };
  if (input.core === "failed") return { kind: "daemon-failed" };
  if (!input.reachable && !input.offlineSeen && !input.locked) return { kind: "offline" };
  return null;
}
