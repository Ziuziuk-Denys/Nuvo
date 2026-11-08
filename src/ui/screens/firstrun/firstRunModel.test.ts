import { describe, expect, it } from "vitest";
import { phraseText, shouldOnboard } from "./firstRunModel";

describe("shouldOnboard", () => {
  it.each([
    [{ phrasePending: false, fresh: false, done: false }, false],
    [{ phrasePending: true, fresh: false, done: false }, true],
    [{ phrasePending: false, fresh: true, done: false }, true],
    [{ phrasePending: true, fresh: true, done: false }, true],
    [{ phrasePending: true, fresh: true, done: true }, false],
    [{ phrasePending: false, fresh: true, done: true }, false],
    [{ phrasePending: true, fresh: false, done: true }, false],
  ])("%o -> %s", (input, expected) => {
    expect(shouldOnboard(input)).toBe(expected);
  });
});

describe("phraseText", () => {
  it("numbers one word per line under the heading", () => {
    expect(phraseText("Your recovery phrase", ["echo", "lamp"])).toBe("Your recovery phrase\n\n1. echo\n2. lamp\n");
  });
});
