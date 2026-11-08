/** Search requests and ranking. Word lists are Nuvo's own. */
import { SEARCH_PARAMS } from "../constants";
import type { Innertube } from "../http";
import type { SearchFilter, SearchItem, SearchKind, YtTrack } from "../types";
import { dedupe, mapSearchResponse } from "./rows";

/** Short words that carry no identity, in English and Russian, plus words people add to song searches. */
const STOP_WORDS = new Set([
  "a",
  "an",
  "the",
  "of",
  "in",
  "on",
  "at",
  "to",
  "and",
  "or",
  "by",
  "for",
  "with",
  "feat",
  "ft",
  "featuring",
  "official",
  "audio",
  "video",
  "music",
  "lyrics",
  "lyric",
  "hd",
  "mv",
  "и",
  "в",
  "во",
  "на",
  "с",
  "со",
  "по",
  "к",
  "от",
  "из",
  "за",
  "для",
  "клип",
  "трек",
  "песня",
  "текст",
]);

/** Phrases that mark a video as something other than the recording. */
const JUNK_PHRASES = [
  "reaction",
  "reacts",
  "reacting",
  "реакция",
  "реакт",
  "tutorial",
  "lesson",
  "how to play",
  "урок",
  "разбор",
  "как играть",
  "sheet music",
  "tabs",
  "chords",
  "ноты",
  "табы",
  "аккорды",
  "piano cover",
  "guitar cover",
  "drum cover",
  "bass cover",
  "violin cover",
  "ukulele cover",
  "на гитаре",
  "на пианино",
  "на барабанах",
  "dance cover",
  "choreography",
  "dance practice",
  "танец",
  "хореография",
  "unboxing",
  "распаковка",
  "review",
  "обзор",
  "podcast",
  "interview",
  "подкаст",
  "интервью",
  "10 hours",
  "1 hour",
  "one hour",
  "hour loop",
  "10 часов",
  "1 час",
  "top 10",
  "top 20",
  "top 50",
  "top 100",
  "топ 10",
  "топ 20",
  "топ 50",
  "топ 100",
  "full album",
  "полный альбом",
  "discography",
  "дискография",
  "playlist",
  "плейлист",
  "compilation",
  "сборник",
];

/** Words for audio changed after release. */
const MODIFIED_AUDIO = ["nightcore", "slowed", "reverb", "sped up", "speed up", "bass boosted", "8d", "найткор", "замедлен", "ускорен", "басс буст"];

export function normalise(value: string): string {
  return value
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/!/g, "i")
    .replace(/\$/g, "s")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function queryTokens(query: string): string[] {
  return normalise(query)
    .split(" ")
    .filter((word) => word && !STOP_WORDS.has(word));
}

const haystack = (track: YtTrack) => normalise(`${track.title} ${track.artists.map((artist) => artist.name).join(" ")}`);

export function matchesWell(track: YtTrack, tokens: string[]): boolean {
  if (tokens.length === 0) return true;
  const text = haystack(track);
  const hits = tokens.filter((token) => text.includes(token)).length;
  return tokens.length <= 2 ? hits === tokens.length : hits >= Math.ceil(tokens.length * 0.75);
}

/** Phrase at a word start, so "reaction" also finds "reactions" and "замедлен" finds "замедленная". */
const containsPhrase = (text: string, phrase: string) => ` ${text}`.includes(` ${phrase}`);

export function isJunk(track: YtTrack, query: string): boolean {
  const title = normalise(track.title);
  const q = normalise(query);
  if (JUNK_PHRASES.some((phrase) => containsPhrase(title, phrase) && !containsPhrase(q, phrase))) return true;
  return MODIFIED_AUDIO.some((word) => containsPhrase(title, word)) && !MODIFIED_AUDIO.some((word) => containsPhrase(q, word));
}

export async function searchFiltered(yt: Innertube, query: string, filter: SearchFilter | undefined, signal: AbortSignal): Promise<SearchItem[]> {
  const trimmed = query.trim().slice(0, 200);
  if (!trimmed) return [];
  const response = await yt.call("search", { query: trimmed, ...(filter ? { params: SEARCH_PARAMS[filter] } : {}) }, { signal });
  return mapSearchResponse(response);
}

type Settled = PromiseSettledResult<SearchItem[]>;
const ok = (result: Settled) => (result.status === "fulfilled" ? result.value : []);
const tracksOf = (items: SearchItem[]) => items.filter((item): item is Extract<SearchItem, { kind: "track" }> => item.kind === "track");

/** Rejects with the first failure only when every request failed. */
function firstFailureIfAllFailed(results: Settled[]): void {
  if (results.every((result) => result.status === "rejected")) throw (results[0] as PromiseRejectedResult).reason;
}

export async function search(yt: Innertube, query: string, kind: SearchKind, signal: AbortSignal): Promise<SearchItem[]> {
  if (kind === "artist" || kind === "album" || kind === "playlist") {
    const results = await Promise.allSettled([searchFiltered(yt, query, undefined, signal), searchFiltered(yt, query, kind, signal)]);
    firstFailureIfAllFailed(results);
    const top = ok(results[0])[0];
    return dedupe([...(top?.kind === kind ? [top] : []), ...ok(results[1]).filter((item) => item.kind === kind)]);
  }

  const tokens = queryTokens(query);
  const [mixedResult, songsResult] = await Promise.allSettled([searchFiltered(yt, query, undefined, signal), searchFiltered(yt, query, "track", signal)]);
  const mixed = ok(mixedResult);
  const songs = tracksOf(ok(songsResult));
  const goodSongs = songs.filter((song) => matchesWell(song, tokens));
  // Videos only when the songs answer poorly.
  const results: Settled[] = [mixedResult, songsResult];
  if (goodSongs.length < 3) results.push(...(await Promise.allSettled([searchFiltered(yt, query, "video", signal)])));
  firstFailureIfAllFailed(results);
  const videos = tracksOf(results[2] ? ok(results[2]) : []);
  const goodVideos = videos.filter((video) => matchesWell(video, tokens) && !isJunk(video, query));
  const weakSongs = songs.filter((song) => !matchesWell(song, tokens));
  const top = mixed[0];

  const ordered: SearchItem[] = [];
  if (kind === "all") {
    if (top && top.kind !== "track") ordered.push(top);
    ordered.push(...goodSongs, ...mixed, ...goodVideos, ...weakSongs);
  } else {
    ordered.push(...goodSongs);
    if (top?.kind === "track" && matchesWell(top, tokens) && !isJunk(top, query)) ordered.push(top);
    ordered.push(...goodVideos, ...weakSongs);
  }
  const richer = new Map<string, SearchItem>();
  for (const track of [...songs, ...videos]) if (track.durationMs > 0 && !richer.has(track.id)) richer.set(track.id, track);
  return dedupe(ordered).map((item) => (item.kind === "track" && item.durationMs === 0 ? (richer.get(item.id) ?? item) : item));
}
