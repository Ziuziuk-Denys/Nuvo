/**
 * Seeded playlists for the codec and length tests. The mix is a realistic library: 70 % YouTube
 * ids, 10 % SoundCloud ids, 20 % text only, artists from a pool of 40 (half Cyrillic), titles of 1 to 4
 * words, durations of 2 to 6 minutes. `messy` adds the inputs real names carry: emoji, RTL text, tabs,
 * line breaks, empty artists and fields far over their caps.
 */
import type { Share, ShareTrack } from "./shareCodec";

export type Random = () => number;

/** mulberry32 */
export function seeded(seed: number): Random {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const LATIN_ARTISTS = [
  "Massive Attack",
  "Daft Punk",
  "Portishead",
  "Radiohead",
  "The Weeknd",
  "Burial",
  "Bonobo",
  "Air",
  "Moderat",
  "Caribou",
  "Four Tet",
  "Jamie xx",
  "Röyksopp",
  "Aphex Twin",
  "Björk",
  "Tycho",
  "Khruangbin",
  "Nujabes",
  "Little Dragon",
  "Thundercat",
];
const CYRILLIC_ARTISTS = [
  "Кино",
  "Сплин",
  "Земфира",
  "Мумий Тролль",
  "Нервы",
  "Звери",
  "Би-2",
  "Ленинград",
  "Ария",
  "Пикник",
  "Аквариум",
  "Наутилус Помпилиус",
  "Агата Кристи",
  "Браво",
  "ДДТ",
  "Мельница",
  "Порнофильмы",
  "Кис-кис",
  "Монеточка",
  "Буерак",
];
const WORDS = [
  "night",
  "city",
  "light",
  "dream",
  "river",
  "summer",
  "heart",
  "fire",
  "blue",
  "home",
  "ночь",
  "город",
  "свет",
  "мечта",
  "река",
  "лето",
  "сердце",
  "огонь",
  "небо",
  "дом",
];
const MESSY = ["😀 party", "שלום עולם", "مرحبا", "tab\there", "line\nbreak", "\u202ereversed", "a".repeat(450), "👨\u200d👩\u200d👧 family"];
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const LAST = "AEIMQUYcgkosw048";

function pick<T>(random: Random, items: readonly T[]): T {
  return items[Math.floor(random() * items.length)];
}

function youtubeId(random: Random): string {
  let id = "";
  for (let i = 0; i < 10; i++) id += pick(random, [...B64]);
  return id + pick(random, [...LAST]);
}

function title(random: Random, messy: boolean): string {
  if (messy && random() < 0.15) return pick(random, MESSY);
  const words = Array.from({ length: 1 + Math.floor(random() * 4) }, () => pick(random, WORDS));
  const head = words.join(" ").replace(/^./, (c) => c.toUpperCase());
  const roll = random();
  if (roll < 0.08) return `${head} (Remastered 2011)`;
  if (roll < 0.16) return `${head} (feat. ${pick(random, LATIN_ARTISTS)})`;
  return head;
}

export function randomShare(random: Random, count: number, playlistTitle: string, messy = false): Share {
  const artists = [...LATIN_ARTISTS, ...CYRILLIC_ARTISTS];
  const tracks: ShareTrack[] = [];
  for (let i = 0; i < count; i++) {
    const roll = random();
    const artist = messy && random() < 0.1 ? (random() < 0.5 ? "" : pick(random, MESSY)) : pick(random, artists);
    const names = { artist, title: title(random, messy) };
    const durationSec = 120 + Math.floor(random() * 240);
    if (roll < 0.7)
      tracks.push({
        source: "youtube",
        id: youtubeId(random),
        ...names,
        durationSec,
      });
    else if (roll < 0.8)
      tracks.push({
        source: "soundcloud",
        id: String(100_000_000 + Math.floor(random() * 1_900_000_000)),
        ...names,
        durationSec,
      });
    else tracks.push({ source: "text", ...names, durationSec });
  }
  return { title: playlistTitle, tracks };
}
