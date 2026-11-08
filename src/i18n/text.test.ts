import { describe, expect, it } from "vitest";
import { flattenTexts, interpolate, lookUp, type Vars } from "./text";

const RU_SONGS = flattenTexts({ songs_one: "{count} песня", songs_few: "{count} песни", songs_many: "{count} песен", songs_other: "{count} песни" });
const EN = flattenTexts({
  app: { title: "Nuvo" },
  menu: { open: "Open" },
  songs_one: "{count} song",
  songs_other: "{count} songs",
  albums_one: "{count} album",
  albums_other: "{count} albums",
  legacy: { songs_plural: "{count} songs", songs: "Songs" },
});

/** What the runtime does: look up, fall back to the key, then fill placeholders. */
function say(active: ReadonlyMap<string, string> | undefined, locale: string, key: string, vars?: Vars): string {
  const text = lookUp(active, locale, EN, key, vars) ?? key;
  return vars ? interpolate(text, vars, locale) : text;
}

describe("lookup and fallback", () => {
  it("1: finds a nested key in English", () => {
    expect(say(EN, "en", "app.title")).toBe("Nuvo");
  });

  it("2: falls back to English when Russian lacks the key", () => {
    expect(say(flattenTexts({}), "ru", "menu.open")).toBe("Open");
  });

  it("3: gives undefined when no table has the key", () => {
    expect(lookUp(flattenTexts({}), "ru", EN, "menu.missing")).toBeUndefined();
  });

  it("4: keeps only string leaves as keys", () => {
    expect([...flattenTexts({ a: { b: "x", count: 3, list: ["y"], flag: true, none: null } }).keys()]).toEqual(["a.b"]);
  });

  it("5: an empty Russian text is a real value", () => {
    expect(say(flattenTexts({ menu: { open: "" } }), "ru", "menu.open")).toBe("");
  });

  it("uses the active table when the locale is not loaded yet as English", () => {
    expect(say(undefined, "ru", "app.title")).toBe("Nuvo");
  });
});

describe("plurals", () => {
  it("6: picks the Russian form for every count class", () => {
    const counts = [1, 2, 5, 11, 21, 22, 0];
    expect(counts.map((count) => say(RU_SONGS, "ru", "songs", { count }))).toEqual([
      "1 песня",
      "2 песни",
      "5 песен",
      "11 песен",
      "21 песня",
      "22 песни",
      "0 песен",
    ]);
  });

  it("7: a fraction takes the other form and a Russian decimal comma", () => {
    expect(say(RU_SONGS, "ru", "songs", { count: 1.5 })).toBe("1,5 песни");
  });

  it("8: English one and other", () => {
    expect([1, 2].map((count) => say(EN, "en", "songs", { count }))).toEqual(["1 song", "2 songs"]);
  });

  it("9: the chain for one goes to _plural, then the plain key", () => {
    expect(say(EN, "en", "legacy.songs", { count: 3 })).toBe("3 songs");
    expect(say(EN, "en", "legacy.songs", { count: 1 })).toBe("1 songs");
  });

  it("10: English fallback uses the English category for the same count", () => {
    expect(say(flattenTexts({}), "ru", "albums", { count: 3 })).toBe("3 albums");
  });

  it("11: a count given as a string, NaN or Infinity picks no form", () => {
    expect(say(EN, "en", "legacy.songs", { count: "5" })).toBe("Songs");
    expect(say(EN, "en", "legacy.songs", { count: Number.NaN })).toBe("Songs");
    expect(say(EN, "en", "legacy.songs", { count: Number.POSITIVE_INFINITY })).toBe("Songs");
  });

  it("12: _zero wins for exactly 0, the normal form otherwise", () => {
    const withZero = flattenTexts({ songs_zero: "Пока нет песен", songs_many: "{count} песен" });
    expect(say(withZero, "ru", "songs", { count: 0 })).toBe("Пока нет песен");
    expect(say(RU_SONGS, "ru", "songs", { count: 0 })).toBe("0 песен");
  });

  it("falls back to the plain key when no form exists", () => {
    expect(say(EN, "en", "app.title", { count: 2 })).toBe("Nuvo");
  });
});

describe("interpolation", () => {
  it("13: replaces every occurrence", () => {
    expect(interpolate("Hi {name}, again {name}", { name: "Ann" }, "en")).toBe("Hi Ann, again Ann");
  });

  it("14: leaves an unknown placeholder visible", () => {
    expect(interpolate("Hi {name}", { other: "x" }, "en")).toBe("Hi {name}");
  });

  it("15: makes one pass only", () => {
    expect(interpolate("{a}{b}", { a: "{b}", b: "B" }, "en")).toBe("{b}B");
  });

  it("16: formats numbers for the locale", () => {
    expect(interpolate("Importing {done} of {total}", { done: 340, total: 3700 }, "en")).toBe("Importing 340 of 3,700");
    expect(interpolate("Importing {done} of {total}", { done: 340, total: 3700 }, "ru")).toMatch(/^Importing 340 of 3[  ]700$/);
  });

  it("17: inserts strings as given", () => {
    expect(interpolate("Version {v}", { v: "2026.10" }, "ru")).toBe("Version 2026.10");
  });

  it("does not treat a placeholder named like an Object member as present", () => {
    expect(interpolate("{toString}", {}, "en")).toBe("{toString}");
  });
});
