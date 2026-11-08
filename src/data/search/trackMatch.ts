/** Local filtering for in-page search and offline search: every word must appear in the title, artists or album. */

export interface SearchableTrack {
  title: string;
  artists: string;
  album?: { title: string } | null;
}

export interface TrackMatch<T> {
  track: T;
  /** The track's place in the full list. */
  index: number;
}

/** Letters with no accent to strip fold by table. */
const LATIN_FOLDS: Record<string, string> = {
  ł: "l",
  ø: "o",
  ß: "ss",
  æ: "ae",
  œ: "oe",
  đ: "d",
  ð: "d",
  ħ: "h",
  ı: "i",
  þ: "th",
  ŧ: "t",
};
const LATIN_FOLD_PATTERN = new RegExp(`[${Object.keys(LATIN_FOLDS).join("")}]`, "g");

/** Latin letters lose their accents (é is e, ł is l, ß is ss); Cyrillic keeps its letters except ё, which is е, so й stays й. Decomposed input is composed first. */
export function normalizeForSearch(text: string): string {
  return text
    .normalize("NFC")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(LATIN_FOLD_PATTERN, (letter) => LATIN_FOLDS[letter])
    .replace(/[À-ɏḀ-ỿ]/g, (letter) => letter.normalize("NFKD").replace(/[̀-ͯ]/g, ""))
    .replace(/\s+/g, " ")
    .trim();
}

/** Folded texts per track, so a keystroke does not fold 20k titles again. Tracks with an id are kept by id and checked against their fields. */
const MAX_CACHED = 100_000;
interface Folded {
  title: string;
  artists: string;
  album: string;
  text: string;
}
const byId = new Map<string, Folded>();
const byObject = new WeakMap<object, Folded>();

function foldedText(track: SearchableTrack & { id?: string }): string {
  const album = track.album?.title ?? "";
  const cache = track.id === undefined ? byObject : byId;
  const key = (track.id ?? track) as string & object;
  const known = cache.get(key);
  if (known && known.title === track.title && known.artists === track.artists && known.album === album) return known.text;
  const text = normalizeForSearch(`${track.title} ${track.artists} ${album}`);
  if (cache === byId && byId.size >= MAX_CACHED) byId.clear();
  cache.set(key, { title: track.title, artists: track.artists, album, text });
  return text;
}

export function filterTracks<T extends SearchableTrack & { id?: string }>(tracks: readonly T[], query: string): TrackMatch<T>[] {
  const words = normalizeForSearch(query).split(" ").filter(Boolean);
  const matches: TrackMatch<T>[] = [];
  for (let index = 0; index < tracks.length; index++) {
    const track = tracks[index];
    const text = foldedText(track);
    if (words.every((word) => text.includes(word))) matches.push({ track, index });
  }
  return matches;
}
