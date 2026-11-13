import { normalizeForSearch, type SearchResult } from "../../ports/search";

type Source = "youtube" | "soundcloud" | "local";

const CYRILLIC_LATIN: Record<string, string> = {
  а: "a",
  б: "b",
  в: "v",
  г: "g",
  д: "d",
  е: "e",
  ж: "zh",
  з: "z",
  и: "i",
  й: "y",
  к: "k",
  л: "l",
  м: "m",
  н: "n",
  о: "o",
  п: "p",
  р: "r",
  с: "s",
  т: "t",
  у: "u",
  ф: "f",
  х: "h",
  ц: "ts",
  ч: "ch",
  ш: "sh",
  щ: "sch",
  ъ: "",
  ы: "y",
  ь: "",
  э: "e",
  ю: "yu",
  я: "ya",
  і: "i",
  ї: "yi",
  є: "ye",
};

const LATIN_KEYS = "qwertyuiop[]asdfghjkl;'zxcvbnm,.`";
const CYRILLIC_KEYS = "йцукенгшщзхъфывапролджэячсмитьбюё";

const VARIANTS = [
  "remix",
  "rmx",
  "ремикс",
  "slowed",
  "замедлен",
  "reverb",
  "sped up",
  "speed up",
  "ускорен",
  "nightcore",
  "найткор",
  "bass boosted",
  "bassboosted",
  "8d",
  "cover",
  "кавер",
  "karaoke",
  "караоке",
  "in the style of",
  "originally performed",
  "tribute",
  "instrumental",
  "минус",
  "backing track",
  "play along",
  "live",
  "концерт",
  "acoustic",
  "bootleg",
  "flip",
  "mashup",
  "remake",
  "lullaby",
  "колыбельная",
  "speed song",
  "женская версия",
  "мужская версия",
  "piano version",
  "fan made",
  "soundfont",
  "sega",
  "8 bit",
  "footage",
  "translated",
  "traducida",
  "sub espanol",
  "reaction",
  "реакция",
  "tutorial",
  "урок",
];
const LYRIC_VIDEO = ["lyrics", "lyric video", "letra", "текст"];

function fold(text: string): string {
  return normalizeForSearch(text)
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function latin(text: string): string {
  return [...text]
    .map((letter) => CYRILLIC_LATIN[letter] ?? letter)
    .join("")
    .replace(/kh/g, "h")
    .replace(/[yj]/g, "i");
}

function swapLayout(text: string): string {
  return [...text.toLowerCase()]
    .map((letter) => {
      const fromLatin = LATIN_KEYS.indexOf(letter);
      if (fromLatin >= 0) return CYRILLIC_KEYS[fromLatin];
      const fromCyrillic = CYRILLIC_KEYS.indexOf(letter);
      return fromCyrillic >= 0 ? LATIN_KEYS[fromCyrillic] : letter;
    })
    .join("");
}

const words = (text: string) => text.split(" ").filter(Boolean);

function coverage(query: string[], text: string[]): number {
  if (query.length === 0) return 0;
  return query.filter((token) => text.some((word) => word.startsWith(token))).length / query.length;
}

function hasPhrase(text: string, phrases: string[]): boolean {
  return phrases.some((phrase) => ` ${text} `.includes(` ${phrase} `));
}

function sourceOf(result: SearchResult): Source {
  if (result.id.startsWith("sc:")) return "soundcloud";
  if (result.id.startsWith("local:")) return "local";
  return "youtube";
}

function artistNames(credits: string): string[] {
  return credits
    .split(/,|&|\s(?:x|feat\.?|ft\.?|и)\s/i)
    .map((name) => latin(fold(name)))
    .filter(Boolean);
}

interface Parts {
  title: string;
  artist: string;
}

// "Artist - Title" uploads name the performer in the title; the uploader is often someone else
function partsOf(result: SearchResult): Parts {
  const uploader = artistNames(result.subtitle)[0] ?? "";
  const dash = result.title.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  const bare = (title: string) => fold(title.replace(/[([{][^)\]}]*[)\]}]/g, " ").replace(/#\S+/g, " "));
  if (dash) {
    const [left, right] = [artistNames(dash[1])[0] ?? "", artistNames(dash[2])[0] ?? ""];
    if (left !== uploader && right === uploader) return { title: bare(dash[1]), artist: right };
    return { title: bare(dash[2]), artist: left };
  }
  return { title: bare(result.title), artist: uploader };
}

interface Scored {
  result: SearchResult;
  score: number;
  order: number;
  key: string;
}

function score(result: SearchResult, query: string, rank: number): number {
  const source = sourceOf(result);
  const credits = fold(result.subtitle);
  const title = fold(result.title);
  const asked = fold(query);
  const queries = [asked, fold(swapLayout(query))];
  const text = `${title} ${credits}`;
  const match = Math.max(...queries.flatMap((q) => [coverage(words(q), words(text)), coverage(words(latin(q)), words(latin(text)))]));
  const parts = partsOf(result);
  const titleWords = words(latin(parts.title));
  const askedWords = new Set(queries.flatMap((q) => words(latin(q))));
  const extra = titleWords.filter((word) => ![...askedWords].some((token) => word.startsWith(token))).length;
  const names = artistNames(result.subtitle);
  const credited = queries.some((q) => names.some((name) => latin(q).includes(name)));
  const named = !credited && queries.some((q) => parts.artist && latin(q).includes(parts.artist));

  let total = match * 60;
  if (match < 0.5) total -= 40;
  total -= Math.min(20, extra * 5);
  if (credited) total += 15;
  else if (named) total += 6;
  if (hasPhrase(text, VARIANTS) && !hasPhrase(asked, VARIANTS)) total -= 25;
  else if (hasPhrase(title, LYRIC_VIDEO) && !hasPhrase(asked, LYRIC_VIDEO)) total -= 6;
  const seconds = (result.durationMs ?? 0) / 1000;
  if (result.preview) total -= 40;
  else if (seconds === 0) total -= 3;
  else if (seconds < 60) total -= 20;
  else if (seconds > 15 * 60) total -= 25;
  if (source === "youtube") total += (result.track?.album ? 10 : 0) + Math.max(0, 10 - rank);
  if (source === "soundcloud") total += (result.verified ? 8 : 0) + Math.min(10, Math.log10((result.plays ?? 0) + 1) * 1.5);
  if (source === "local") total += 12;
  return Math.round(total);
}

function songKey(result: SearchResult): string {
  const parts = partsOf(result);
  return `${latin(parts.title)}|${parts.artist}`;
}

function sameSong(a: Scored, b: Scored): boolean {
  if (a.key !== b.key) return false;
  const [x, y] = [a.result.durationMs ?? 0, b.result.durationMs ?? 0];
  return x === 0 || y === 0 || Math.abs(x - y) <= 4_000;
}

/** One list from every source, best match first; the same song from two sources keeps the better copy. */
export function rankSongs(query: string, songs: readonly SearchResult[]): SearchResult[] {
  const seen: Record<Source, number> = { youtube: 0, soundcloud: 0, local: 0 };
  const scored: Scored[] = songs.map((result, order) => {
    const source = sourceOf(result);
    const rank = seen[source]++;
    return { result, score: score(result, query, rank), order, key: songKey(result) };
  });
  scored.sort((a, b) => b.score - a.score || a.order - b.order);
  const kept: Scored[] = [];
  for (const candidate of scored) if (!kept.some((better) => sameSong(better, candidate))) kept.push(candidate);
  return kept.map((entry) => entry.result);
}
