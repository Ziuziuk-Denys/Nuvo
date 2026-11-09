import { describe, expect, it } from "vitest";
import { seededRandom, spacedShuffle } from "./shuffle";

interface Item {
  id: string;
  artist: string;
}

const library: Item[] = Array.from({ length: 40 }, (_, i) => ({ id: `t${i}`, artist: `artist${i % 8}` }));

describe("spaced shuffle", () => {
  // 10 000 seeds of a 40 item shuffle take about 6 s on a shared CI runner, over the 5 s default
  it("keeps artists 3 apart and leaves the first slot uniform", { timeout: 60_000 }, () => {
    const firsts = new Map<string, number>();
    for (let seed = 1; seed <= 10_000; seed++) {
      const order = spacedShuffle(library, (item) => item.artist, seededRandom(seed));
      expect(new Set(order.map((item) => item.id)).size).toBe(40);
      for (let i = 2; i < order.length; i++) {
        const window = new Set([order[i - 2].artist, order[i - 1].artist, order[i].artist]);
        expect(window.size).toBe(3);
      }
      firsts.set(order[0].id, (firsts.get(order[0].id) ?? 0) + 1);
    }
    for (const item of library) {
      const count = firsts.get(item.id) ?? 0;
      expect(count).toBeGreaterThanOrEqual(150);
      expect(count).toBeLessThanOrEqual(350);
    }
  });

  it("drops spacing only where the list cannot allow it", () => {
    const lopsided: Item[] = [...Array.from({ length: 6 }, (_, i) => ({ id: `a${i}`, artist: "a" })), { id: "b0", artist: "b" }];
    const order = spacedShuffle(lopsided, (item) => item.artist, seededRandom(7));
    expect(order).toHaveLength(7);
  });

  it("keeps the end of the previous pass out of the first 20 %", () => {
    const items = library.slice(0, 20);
    const avoid = new Set(items.slice(16));
    for (let seed = 1; seed <= 200; seed++) {
      const order = spacedShuffle(items, (item) => item.artist, seededRandom(seed), { avoidEarly: avoid });
      for (const item of order.slice(0, 4)) expect(avoid.has(item)).toBe(false);
    }
  });
});
