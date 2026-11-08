import { describe, expect, it } from "vitest";
import { baseTitle } from "./baseTitle";

describe("baseTitle", () => {
  it("drops featuring clauses, a trailing dash qualifier and folds to the comparison form", () => {
    expect(baseTitle("Ёжик (feat. Кто-то) - Live at Moscow")).toBe("ежик");
    expect(baseTitle("Song - Remastered 2011")).toBe("song");
    expect(baseTitle("Song feat. Someone")).toBe("song");
    expect(baseTitle("Song ft. A & B - Radio Edit")).toBe("song");
    expect(baseTitle("Song [with Guest]")).toBe("song");
  });

  it("34 an unbracketed with is part of the title", () => {
    expect(baseTitle("Stay With Me")).toBe("stay with me");
    expect(baseTitle("Dancing with Myself")).toBe("dancing with myself");
  });

  it("removes version marker words, Russian forms and phrases included", () => {
    expect(baseTitle("Song (Skrillex Remix)")).toBe("song skrillex");
    expect(baseTitle("Песня (ремикс)")).toBe("песня");
    expect(baseTitle("After Dark (Slowed + Reverb)")).toBe("after dark");
    expect(baseTitle("Song (Sped Up + Nightcore)")).toBe("song");
    expect(baseTitle("Song (Bass Boosted)")).toBe("song");
  });

  it("removes audio file extensions", () => {
    expect(baseTitle("Track.mp3")).toBe("track");
  });
});
