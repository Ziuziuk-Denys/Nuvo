import type { Play } from "../../../ports/homeMoments";
import type { Track } from "../../../ports/recs";
import { firstArtist } from "../../../recs/notInterestedItems";

const DAY_MS = 86_400_000;
const NOW_MS = 30 * 60_000;
const MIN_SONGS = 3;
const MIN_DAY_SONGS = 3;
const MAX_DAY_SONGS = 12;
const DOMINANT = 0.6;

export interface Session {
  id: string;
  startedAt: number;
  endedAt: number;
  songs: Track[];
  listenedMs: number;
  lastCompleted: boolean;
  playlistId: string | null;
  source: { kind: "playlist" | "album" | "artist"; name: string } | { kind: "artists"; names: string[] };
}

function unique(tracks: Track[]): Track[] {
  const seen = new Set<string>();
  return tracks.filter((track) => !seen.has(track.id) && seen.add(track.id));
}

function dominant(values: Array<string | undefined>): string | null {
  const counts = new Map<string, number>();
  for (const value of values) if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
  const [top] = [...counts].sort((left, right) => right[1] - left[1]);
  return top && top[1] >= values.length * DOMINANT ? top[0] : null;
}

export function sessionsOf(plays: readonly Play[], playlists: ReadonlyMap<string, string>, now: number, limit: number): Session[] {
  const groups = new Map<string, Play[]>();
  for (const play of plays) groups.set(play.session, [...(groups.get(play.session) ?? []), play]);
  return [...groups]
    .map(([id, group]): Session => {
      const last = group[group.length - 1];
      const playlistId = dominant(group.map((play) => (play.context?.type === "playlist" ? play.context.id : undefined)));
      const album = dominant(group.map((play) => play.track.album?.title));
      const artist = dominant(group.map((play) => firstArtist(play.track)));
      const own = playlistId ? playlists.get(playlistId) : undefined;
      const names = [...new Set(group.map((play) => firstArtist(play.track)).filter(Boolean))];
      return {
        id,
        startedAt: group[0].at,
        endedAt: last.at + last.playedMs,
        songs: unique([...group].reverse().map((play) => play.track)).reverse(),
        listenedMs: group.reduce((sum, play) => sum + play.playedMs, 0),
        lastCompleted: last.completed,
        playlistId: own ? playlistId : null,
        source: own
          ? { kind: "playlist", name: own }
          : album && group.length > 1
            ? { kind: "album", name: album }
            : artist
              ? { kind: "artist", name: artist }
              : { kind: "artists", names: names.slice(0, 2) },
      };
    })
    .filter((session) => session.songs.length >= MIN_SONGS && session.endedAt < now - NOW_MS)
    .sort((left, right) => right.endedAt - left.endedAt)
    .slice(0, limit);
}

export type When = { key: string; day?: string };

const dayNumber = (at: number) => {
  const date = new Date(at);
  return Math.round(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY_MS);
};

export function whenOf(at: number, now: number, locale: string): When {
  const hour = new Date(at).getHours();
  const part = hour < 5 ? "night" : hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
  const days = dayNumber(now) - dayNumber(at);
  if ((days === 0 && part === "night") || (days === 1 && hour >= 22)) return { key: "last_night" };
  if (days === 0) return { key: `this_${part}` };
  if (days === 1) return { key: part === "night" ? "yesterday_night" : `yesterday_${part}` };
  if (days < 7) {
    const day = new Intl.DateTimeFormat(locale, { weekday: "long" }).format(at);
    return { key: `weekday_${part}`, day: day.charAt(0).toLocaleUpperCase(locale) + day.slice(1) };
  }
  return { key: "date", day: new Intl.DateTimeFormat(locale, { day: "numeric", month: "long" }).format(at) };
}

export interface DayBack {
  key: string;
  count?: number;
  from: number;
  to: number;
}

export function daysBack(now: number): DayBack[] {
  const today = new Date(now);
  const at = (years: number, months: number, days: number) => {
    const date = new Date(today.getFullYear() - years, today.getMonth() - months, 1);
    const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
    date.setDate(Math.min(today.getDate(), lastDay) - days);
    const end = new Date(date);
    end.setDate(end.getDate() + 1);
    return { from: date.getTime(), to: end.getTime() };
  };
  return [
    ...[3, 2, 1].map((years) => ({ key: "years", count: years, ...at(years, 0, 0) })),
    { key: "half_year", ...at(0, 6, 0) },
    { key: "season", ...at(0, 3, 0) },
    { key: "month", ...at(0, 1, 0) },
    { key: "week", ...at(0, 0, 7) },
  ];
}

export function dayOf(plays: readonly Play[]): Play[] | null {
  const seen = new Set<string>();
  const songs = plays.filter((play) => !seen.has(play.track.id) && seen.add(play.track.id));
  if (songs.length < MIN_DAY_SONGS) return null;
  if (songs.length <= MAX_DAY_SONGS) return songs;
  const longest = [...songs].sort((left, right) => right.playedMs - left.playedMs).slice(0, MAX_DAY_SONGS);
  return songs.filter((play) => longest.includes(play));
}

export function spreadOver(times: readonly number[], from: number, to: number, width: number, size: number, gap: number): number[] {
  const room = Math.max(0, width - size);
  const step = Math.min(size + gap, times.length > 1 ? room / (times.length - 1) : room);
  const places = times.map((time) => ((time - from) / Math.max(1, to - from)) * room);
  for (let index = 1; index < places.length; index += 1) places[index] = Math.max(places[index], places[index - 1] + step);
  for (let index = places.length - 1; index >= 0; index -= 1) {
    const limit = index === places.length - 1 ? room : places[index + 1] - step;
    places[index] = Math.max(0, Math.min(places[index], limit));
  }
  return places;
}
