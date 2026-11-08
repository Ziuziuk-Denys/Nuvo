import { beforeEach, describe, expect, it } from "vitest";
import { LEGACY_SESSION_KEY, OFFSETS_PER_IMPORT, migrateLegacyLyrics } from "./migrate";

function keys(): string[] {
  const out: string[] = [];
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (key !== null) out.push(key);
  }
  return out.sort();
}

function seed(): void {
  localStorage.setItem(
    LEGACY_SESSION_KEY,
    JSON.stringify({ state: { currentLyricsTrackId: "a", trackOffsets: { a: 300, b: 0, c: "x", d: 50_000 } }, version: 1 }),
  );
  localStorage.setItem("nuvo_lyrics_v2_index", '["a"]');
  localStorage.setItem("nuvo_lyrics_v2_item_a", "{}");
  localStorage.setItem("nuvo_lyrics_lru_index", "[]");
  localStorage.setItem("nuvo_lyrics_item_a", "{}");
  localStorage.setItem("nuvo_other", "keep");
}

beforeEach(() => {
  localStorage.clear();
});

describe("migrateLegacyLyrics", () => {
  it("42 sends the cleaned offsets once and removes the legacy keys after the daemon confirms", async () => {
    seed();
    const sent: Array<Record<string, number>> = [];
    expect(await migrateLegacyLyrics(localStorage, async (offsets) => void sent.push(offsets))).toBe(true);
    expect(sent).toEqual([{ a: 300, d: 30_000 }]);
    expect(keys()).toEqual(["nuvo_other"]);
  });

  it("sends more offsets than one import takes in batches the daemon accepts", async () => {
    const total = OFFSETS_PER_IMPORT * 2 + 5;
    const trackOffsets = Object.fromEntries(Array.from({ length: total }, (_, index) => [`t${index}`, 100]));
    localStorage.setItem(LEGACY_SESSION_KEY, JSON.stringify({ state: { trackOffsets } }));
    const sent: Array<Record<string, number>> = [];
    expect(await migrateLegacyLyrics(localStorage, async (offsets) => void sent.push(offsets))).toBe(true);
    expect(sent.map((batch) => Object.keys(batch).length)).toEqual([OFFSETS_PER_IMPORT, OFFSETS_PER_IMPORT, 5]);
    expect(Object.assign({}, ...sent)).toEqual(trackOffsets);
    expect(keys()).toEqual([]);
  });

  it("42 keeps every legacy key when the daemon fails", async () => {
    seed();
    const before = keys();
    const result = await migrateLegacyLyrics(localStorage, async () => {
      throw new Error("daemon down");
    });
    expect(result).toBe(false);
    expect(keys()).toEqual(before);
  });

  it("sends nothing when no offset is set, and still clears the copies", async () => {
    localStorage.setItem(LEGACY_SESSION_KEY, JSON.stringify({ state: { trackOffsets: { a: 0 } } }));
    localStorage.setItem("nuvo_lyrics_item_a", "{}");
    let calls = 0;
    expect(await migrateLegacyLyrics(localStorage, async () => void (calls += 1))).toBe(true);
    expect(calls).toBe(0);
    expect(keys()).toEqual([]);
  });

  it("a corrupt session is dropped without a request", async () => {
    localStorage.setItem(LEGACY_SESSION_KEY, "{not json");
    let calls = 0;
    expect(await migrateLegacyLyrics(localStorage, async () => void (calls += 1))).toBe(true);
    expect(calls).toBe(0);
    expect(keys()).toEqual([]);
  });
});
