/** Seeded shuffle with artist spacing and wrap-around avoidance (transport 4.3). Pure. */

export type Random = () => number;

/** mulberry32: a small, well-known 32-bit generator; good enough for shuffles and reproducible in tests. */
export function seededRandom(seed: number): Random {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** No artist twice within this many consecutive entries, where the list allows it. */
export const ARTIST_WINDOW = 3;
/** Share of a pass that must not reappear at the start of the next pass. */
export const WRAP_SHARE = 0.2;
/** Search steps per item before giving up on spacing (lists dominated by one artist). */
const STEP_BUDGET_PER_ITEM = 20;

export interface ShuffleOptions {
  /** Artists of the entries just before the shuffled part, oldest first; spacing continues across the seam. */
  recentArtists?: string[];
  /** Items that must not land in the first WRAP_SHARE of the result (the end of the previous pass). */
  avoidEarly?: ReadonlySet<unknown>;
}

interface Group<T> {
  artist: string;
  items: T[];
}

/** Uniform pick from an array, removing it. */
function take<T>(list: T[], random: Random, accept: (item: T) => boolean = () => true): T | undefined {
  const allowed = list.filter(accept);
  if (allowed.length === 0) return undefined;
  const pick = allowed[Math.floor(random() * allowed.length)];
  list.splice(list.indexOf(pick), 1);
  return pick;
}

/** Weighted pick (weight = items left) from the groups not tried yet at this slot, so every item is equally likely. */
function pickGroup<T>(pool: Group<T>[], random: Random): Group<T> | undefined {
  const total = pool.reduce((sum, group) => sum + group.items.length, 0);
  if (total === 0) return undefined;
  let r = random() * total;
  let index = 0;
  while (index < pool.length - 1 && r >= pool[index].items.length) {
    r -= pool[index].items.length;
    index++;
  }
  return pool.splice(index, 1)[0];
}

/**
 * Depth-first over artists: each slot tries the allowed artists in weighted random order and backtracks
 * when the rest cannot be spaced. A list that cannot be spaced (or exhausts the budget) falls back to a
 * greedy pass that drops spacing only for the slots that need it.
 */
export function spacedShuffle<T>(items: readonly T[], artistOf: (item: T) => string, random: Random, options: ShuffleOptions = {}): T[] {
  const byArtist = new Map<string, Group<T>>();
  for (const item of items) {
    const artist = artistOf(item);
    const group = byArtist.get(artist) ?? { artist, items: [] };
    group.items.push(item);
    byArtist.set(artist, group);
  }
  const groups = [...byArtist.values()];
  const seed = (options.recentArtists ?? []).slice(-(ARTIST_WINDOW - 1));
  const earlySlots = options.avoidEarly ? Math.ceil(items.length * WRAP_SHARE) : 0;
  const avoid = options.avoidEarly;
  const okEarly = (depth: number) => (item: T) => depth >= earlySlots || !avoid?.has(item);

  const placed: Array<{ group: Group<T>; item: T }> = [];
  const tries: Group<T>[][] = [];
  let steps = items.length * STEP_BUDGET_PER_ITEM;

  const recentAt = (): string[] => {
    const tail = placed.slice(-(ARTIST_WINDOW - 1)).map((p) => p.group.artist);
    return [...seed, ...tail].slice(-(ARTIST_WINDOW - 1));
  };
  // Only artists holding about a third of the remaining slots can break spacing, so most steps skip the scan.
  const feasible = (slotsLeft: number, recent: string[]): boolean => {
    const threshold = (slotsLeft - ARTIST_WINDOW) / ARTIST_WINDOW;
    return groups.every((group) => {
      const count = group.items.length;
      if (count === 0 || count < threshold) return true;
      const lastAt = recent.lastIndexOf(group.artist);
      const wait = lastAt < 0 ? 0 : ARTIST_WINDOW - (recent.length - lastAt);
      return (count - 1) * ARTIST_WINDOW + 1 + wait <= slotsLeft;
    });
  };
  const largest = () => groups.reduce((max, group) => Math.max(max, group.items.length), 0);
  let maxCount = largest();

  while (placed.length < items.length && steps-- > 0) {
    const depth = placed.length;
    if (tries.length === depth) {
      const recent = recentAt();
      tries.push(groups.filter((g) => g.items.length > 0 && !recent.includes(g.artist) && (depth >= earlySlots || g.items.some(okEarly(depth)))));
    }
    const next = pickGroup(tries[depth], random);
    if (!next) {
      tries.pop();
      const undo = placed.pop();
      if (!undo) break;
      undo.group.items.push(undo.item);
      maxCount = Math.max(maxCount, undo.group.items.length);
      continue;
    }
    const item = take(next.items, random, okEarly(depth))!;
    placed.push({ group: next, item });
    const slotsLeft = items.length - placed.length;
    if (maxCount * ARTIST_WINDOW + ARTIST_WINDOW > slotsLeft) {
      maxCount = largest();
      if (!feasible(slotsLeft, recentAt())) {
        placed.pop();
        next.items.push(item);
      }
    }
  }
  if (placed.length === items.length) return placed.map((p) => p.item);
  return greedyShuffle(items, artistOf, random, seed, earlySlots, avoid);
}

function greedyShuffle<T>(
  items: readonly T[],
  artistOf: (item: T) => string,
  random: Random,
  seed: string[],
  earlySlots: number,
  avoid: ReadonlySet<unknown> | undefined,
): T[] {
  const left = [...items];
  const out: T[] = [];
  const recent = [...seed];
  while (left.length > 0) {
    const early = (item: T) => out.length >= earlySlots || !avoid?.has(item);
    const spaced = (item: T) => !recent.includes(artistOf(item));
    const pick = take(left, random, (item) => spaced(item) && early(item)) ?? take(left, random, spaced) ?? take(left, random, early) ?? take(left, random)!;
    out.push(pick);
    recent.push(artistOf(pick));
    if (recent.length > ARTIST_WINDOW - 1) recent.shift();
  }
  return out;
}

/** Display string of the first artist, the spacing key. */
export function firstArtist(artists: string): string {
  return (artists.split(",")[0] ?? "").trim().toLowerCase();
}
