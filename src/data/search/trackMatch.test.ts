import { describe, expect, it } from "vitest";
import { filterTracks, normalizeForSearch } from "./trackMatch";

const TRACKS = [
  { title: "ДИНАСТИЯ", artists: "VILLIAN, madk1d" },
  { title: "Дві весни", artists: "Jerry Heil" },
  { title: "8 миля", artists: "madk1d, VILLIAN" },
  { title: "Ёлка", artists: "Звери" },
  { title: "Bohemian Rhapsody", artists: "Queen", album: { title: "A Night at the Opera" } },
  { title: "Halo", artists: "Beyoncé" },
  { title: "Йога", artists: "Zero" },
];

const indices = (query: string) => filterTracks(TRACKS, query).map((match) => match.index);

describe("filterTracks", () => {
  it("keeps every track where each word appears, with its place in the full list", () => {
    expect(indices("madk1d")).toEqual([0, 2]);
    expect(indices("весни")).toEqual([1]);
    expect(indices("queen opera")).toEqual([4]);
    expect(filterTracks(TRACKS, "halo")[0].track).toBe(TRACKS[5]);
  });

  it("folds ё into е and Latin accents, keeps й apart from и", () => {
    expect(indices("елка")).toEqual([3]);
    expect(indices("beyonce")).toEqual([5]);
    expect(indices("иога")).toEqual([]);
    expect(indices("йога")).toEqual([6]);
  });

  it("returns every track for a blank query", () => {
    expect(indices("   ")).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });
});

describe("normalizeForSearch with decomposed input", () => {
  it("composes decomposed ё, й and é before folding", () => {
    expect(normalizeForSearch("Е\u0308лка")).toBe("елка");
    expect(normalizeForSearch("и\u0306ога")).toBe("йога");
    expect(normalizeForSearch("И\u0306ога")).toBe("йога");
    expect(normalizeForSearch("Beyonce\u0301")).toBe("beyonce");
    expect(indices("е\u0308лка")).toEqual([3]);
    expect(indices("и\u0306ога")).toEqual([6]);
    expect(indices("иога")).toEqual([]);
  });

  it("folds Latin letters that have no accent to strip", () => {
    expect(normalizeForSearch("Łódź")).toBe("lodz");
    expect(normalizeForSearch("Bjørk")).toBe("bjork");
    expect(normalizeForSearch("Straße")).toBe("strasse");
    expect(normalizeForSearch("Æon Œuvre")).toBe("aeon oeuvre");
    expect(normalizeForSearch("Đorđe Ðan Ħal ı")).toBe("dorde dan hal i");
  });
});

describe("filterTracks speed", () => {
  it("answers a query over 20k tracks in under 15 ms once the texts are cached", () => {
    const many = Array.from({ length: 20_000 }, (_, index) => ({
      id: `t${index}`,
      title: `Ёлка номер ${index} Café`,
      artists: `Artist ${index % 500}, Łukasz ${index % 37}`,
      album: { title: `Album ${index % 1000}` },
    }));
    filterTracks(many, "lukasz");
    const best = Math.min(
      ...Array.from({ length: 5 }, () => {
        const start = performance.now();
        const found = filterTracks(many, "елка lukasz 19");
        const took = performance.now() - start;
        expect(found.length).toBeGreaterThan(0);
        return took;
      }),
    );
    expect(best).toBeLessThan(15);
  });

  it("sees an edited track under the same id", () => {
    const track = { id: "same", title: "Old", artists: "A" };
    expect(filterTracks([track], "new")).toHaveLength(0);
    expect(filterTracks([{ ...track, title: "New" }], "new")).toHaveLength(1);
  });
});

describe("normalizeForSearch", () => {
  it("lowercases, folds and collapses spaces", () => {
    expect(normalizeForSearch("  Зелёный   ВЕЧЕР ")).toBe("зеленый вечер");
    expect(normalizeForSearch("Café Ñu")).toBe("cafe nu");
  });
});
