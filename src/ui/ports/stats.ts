/** The Statistics page's data: everything is computed by the daemon on this device and never leaves it. */
import { useCallback, useEffect, useState } from "react";
import { CORE_BASE_URL } from "@/engine/boot";
import { fromSnapshot } from "@/engine/snapshot";
import { exportDocument } from "./exports";
import type { Track } from "./player";

export interface StatsTotals {
  listenedMs: number;
  plays: number;
  tracks: number;
  artists: number;
  albums: number;
  activeDays: number;
  sessions: number;
  skipRate: number;
  completedRate: number;
}

export interface StatsRow {
  id: string;
  title: string;
  subtitle?: string;
  coverUrl?: string;
  plays: number;
  listenedMs: number;
  rank: number;
  rankDelta: number | null;
  isNew: boolean;
  track?: unknown;
  openId?: string;
  skips?: number;
  replays?: number;
  firstPlayedAt?: string;
  lastPlayedAt?: string;
}

export interface StatsDay {
  day: string;
  listenedMs: number;
  plays: number;
}

export interface StatsShare {
  kind: string;
  plays: number;
  listenedMs: number;
}

export interface StatsOverview {
  range: { from: string | null; to: string; days: number; previousFrom: string | null; previousTo: string | null };
  totals: StatsTotals;
  previous: StatsTotals | null;
  newTracks: number;
  newArtists: number;
  currentStreak: number;
  longestStreak: { days: number; from: string | null; to: string | null };
  firstPlayedAt: string | null;
  days: StatsDay[];
  calendar: StatsDay[];
  byHour: number[];
  byWeekday: number[];
  sources: StatsShare[];
  origins: StatsShare[];
  sessions: { count: number; averageMs: number; longestMs: number; longestStartedAt: string | null; longestTracks: number };
  top: { tracks: StatsRow[]; artists: StatsRow[]; albums: StatsRow[]; playlists: StatsRow[]; genres: StatsRow[] };
  mostSkipped: StatsRow[];
  mostReplayed: StatsRow[];
  onRepeat: StatsRow[];
  discoveries: StatsRow[];
  forgotten: StatsRow[];
}

export interface StatsDetail {
  title: string;
  subtitle: string | null;
  coverUrl: string | null;
  track: unknown;
  openId: string | null;
  firstPlayedAt: string | null;
  lastPlayedAt: string | null;
  plays: number;
  listenedMs: number;
  skips: number;
  completed: number;
  activeDays: number;
  byMonth: { month: string; plays: number; listenedMs: number }[];
  byHour: number[];
  byWeekday: number[];
  sources: StatsShare[];
  topTracks: StatsRow[];
}

/** Both days or neither; neither is all time. */
export interface StatsDays {
  from?: string;
  to?: string;
}

/** The engine's track as the player types have it. */
export function rowTrack(snapshot: unknown): Track | null {
  const track = fromSnapshot(snapshot);
  return track ? ({ ...track, playCount: track.playCount ?? 0 } as Track) : null;
}

async function read<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${CORE_BASE_URL}${path}`, { signal });
  if (!response.ok) throw new Error(`nuvo-core ${response.status}`);
  return (await response.json()) as T;
}

async function send<T>(method: string, path: string, body: unknown): Promise<T> {
  const response = await fetch(`${CORE_BASE_URL}${path}`, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(`nuvo-core ${response.status}`);
  return (await response.json()) as T;
}

function overviewPath({ from, to }: StatsDays): string {
  const params = new URLSearchParams({ tzOffsetMin: String(new Date().getTimezoneOffset()) });
  if (from && to) {
    params.set("from", from);
    params.set("to", to);
  }
  return `/v1/stats/overview?${params}`;
}

/** The last answer per range: going back to a range draws at once, and the fresh answer replaces it. */
const seen = new Map<string, StatsOverview>();
const reloads = new Set<() => void>();

export function useStatsOverview(days: StatsDays): { data: StatsOverview | null; failed: boolean; reload(): void } {
  const key = `${days.from ?? ""}|${days.to ?? ""}`;
  const [answer, setAnswer] = useState<{ key: string; data: StatsOverview } | null>(null);
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((n) => n + 1), []);
  useEffect(() => {
    reloads.add(reload);
    return () => void reloads.delete(reload);
  }, [reload]);
  useEffect(() => {
    const controller = new AbortController();
    read<StatsOverview>(overviewPath({ from: days.from, to: days.to }), controller.signal).then(
      (data) => {
        seen.set(key, data);
        setAnswer({ key, data });
        setFailedKey(null);
      },
      () => !controller.signal.aborted && setFailedKey(key),
    );
    return () => controller.abort();
  }, [key, days.from, days.to, tick]);
  return { data: answer?.key === key ? answer.data : (seen.get(key) ?? null), failed: failedKey === key, reload };
}

export function useStatsDetail(kind: "tracks" | "artists", id: string): { data: StatsDetail | null; failed: boolean } {
  const [answer, setAnswer] = useState<{ id: string; data: StatsDetail } | null>(null);
  const [failedId, setFailedId] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    read<StatsDetail>(`/v1/stats/${kind}/${encodeURIComponent(id)}`, controller.signal).then(
      (data) => setAnswer({ id, data }),
      () => !controller.signal.aborted && setFailedId(id),
    );
    return () => controller.abort();
  }, [kind, id]);
  return { data: answer?.id === id ? answer.data : null, failed: failedId === id };
}

/** Plays started from each list, album or artist page, by playback context (`album:<id>`); empty when the daemon is down. */
export async function contextPlays(): Promise<Map<string, { plays: number; lastPlayedAt: string }>> {
  const rows = await read<{ kind: string; id: string; plays: number; lastPlayedAt: string }[]>("/v1/stats/contexts").catch(() => []);
  return new Map(rows.map((row) => [`${row.kind}:${row.id}`, { plays: row.plays, lastPlayedAt: row.lastPlayedAt }]));
}

/** Deletes the plays of a range, or all of them; the number deleted. */
export async function deleteStats(days: StatsDays): Promise<number> {
  const { events } = await send<{ events: number }>("POST", "/v1/stats/delete", days.from && days.to ? { from: days.from, to: days.to } : {});
  seen.clear();
  reloads.forEach((reload) => reload());
  return events;
}

export function exportStats(format: "json" | "csv", days: StatsDays): Promise<string | null> {
  return exportDocument({ kind: "stats", format, ...(days.from && days.to ? { from: days.from, to: days.to } : {}) });
}

const pausedListeners = new Set<(paused: boolean) => void>();

/** The Settings switch: while on, plays are not stored at all. */
export function useStatsPaused(): { paused: boolean | null; setPaused(next: boolean): void } {
  const [paused, setValue] = useState<boolean | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    pausedListeners.add(setValue);
    read<{ paused: boolean }>("/v1/stats/collection", controller.signal).then(
      (answer) => setValue(answer.paused),
      () => undefined,
    );
    return () => {
      controller.abort();
      pausedListeners.delete(setValue);
    };
  }, []);
  const setPaused = useCallback((next: boolean) => {
    void send<{ paused: boolean }>("PUT", "/v1/stats/collection", { paused: next }).then(
      (answer) => pausedListeners.forEach((listener) => listener(answer.paused)),
      () => undefined,
    );
  }, []);
  return { paused, setPaused };
}

export type HistoryFilter = "all" | "completed" | "skipped";

/** One play as History lists it: the song, when it started, and whether it was skipped. */
export interface HistoryEntry {
  id: string;
  track: Track;
  listenedAt: string;
  skipped: boolean;
}

/** A page of plays, newest first; plays under 3 s stay out. */
export async function listeningHistory(
  filter: HistoryFilter,
  cursor: string | null,
  signal?: AbortSignal,
): Promise<{ items: HistoryEntry[]; next: string | null }> {
  const query = `limit=50&filter=${filter}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
  const body = await read<{ items: Array<{ id: string; track: unknown; listenedAt: string; skipped: boolean }>; nextCursor: string | null }>(
    `/v1/me/history?${query}`,
    signal,
  );
  const items = body.items.flatMap((item) => {
    const track = rowTrack(item.track);
    return track ? [{ id: item.id, track, listenedAt: item.listenedAt, skipped: item.skipped }] : [];
  });
  return { items, next: body.nextCursor ?? null };
}
