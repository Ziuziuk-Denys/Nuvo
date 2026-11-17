import { describe, expect, it } from "vitest";
import type { Line } from "@/lyrics";
import { easeOutExpo, isStressed, phraseAt, shutterTimes } from "./kit";

function line(text: string, fromMs: number, toMs: number): Line {
  return { text, fromMs, toMs, companion: false, instrumental: false };
}

describe("shutter", () => {
  it("spreads samples evenly over the open shutter ending at now", () => {
    expect(shutterTimes(1000, 20, 5)).toEqual([980, 985, 990, 995, 1000]);
  });

  it("collapses to one sample when the shutter is closed", () => {
    expect(shutterTimes(1000, 0, 8)).toEqual([1000]);
  });
});

describe("phrase", () => {
  const lines = [line("you know me i must admit", 1000, 4000), line("girl", 4200, 5000)];

  it("reports the words sung so far and whether the line is complete", () => {
    const early = phraseAt(lines, 1100)!;
    expect(early.shown.map((w) => w.text.trim())).toEqual(["you"]);
    expect(early.complete).toBe(false);
    const late = phraseAt(lines, 3900)!;
    expect(late.complete).toBe(true);
  });

  it("measures how long the phrase has been over", () => {
    expect(phraseAt([line("girl", 1000, 2000)], 2600)!.endedMs).toBe(600);
    expect(phraseAt(lines, 1100)!.endedMs).toBe(0);
  });

  it("ends a phrase when the next one starts", () => {
    expect(phraseAt(lines, 4300)!.line.text).toBe("girl");
  });
});

describe("stress", () => {
  it("stresses the last word and long words but not short connectives", () => {
    const words = ["you", "know", "me", "i", "must", "admit,"];
    expect(words.map((w, i) => isStressed(w, i === words.length - 1))).toEqual([false, false, false, false, false, true]);
    expect(isStressed("looking", false)).toBe(true);
    expect(isStressed("the", true)).toBe(true);
  });
});

describe("easing", () => {
  it("starts at zero, ends at one and front-loads the motion", () => {
    expect(easeOutExpo(0)).toBe(0);
    expect(easeOutExpo(1)).toBe(1);
    expect(easeOutExpo(0.25)).toBeGreaterThan(0.75);
    expect(easeOutExpo(2)).toBe(1);
  });
});
