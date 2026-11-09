import type { TFunction } from "../../ports/i18n";
import { filterTracks, type SearchableTrack, type TrackMatch } from "../../ports/search";

export type { TrackMatch };

export function formatTotal(ms: number, t: TFunction): string {
  const seconds = Math.floor(Math.max(0, ms) / 1000);
  const minutes = Math.floor(seconds / 60);
  if (minutes > 60) return `${Math.floor(minutes / 60)} ${t("playlist.hr")} ${minutes % 60} ${t("playlist.min")}`;
  return `${minutes} ${t("playlist.min")} ${seconds % 60} ${t("playlist.sec")}`;
}

export function totalMs(tracks: readonly { durationMs: number }[]): number {
  return tracks.reduce((sum, track) => sum + (track.durationMs || 0), 0);
}

export function matchTracks<T extends SearchableTrack>(tracks: readonly T[], query: string): TrackMatch<T>[] | null {
  const needle = query.trim();
  return needle ? filterTracks(tracks, needle) : null;
}

export type TrackOrder = "default" | "title" | "duration" | "popularity";

type Orderable = { playCount?: number; durationMs: number; title: string };
type Comparator = (left: Orderable, right: Orderable) => number;

const lengthOf = (track: Orderable) => track.durationMs || 0;
const playsOf = (track: Orderable) => track.playCount || 0;

const comparators: Record<Exclude<TrackOrder, "default">, Comparator> = {
  title: (left, right) => left.title.localeCompare(right.title, undefined, { numeric: true, sensitivity: "base" }),
  duration: (left, right) => lengthOf(left) - lengthOf(right),
  popularity: (left, right) => playsOf(right) - playsOf(left),
};

export function orderTracks<T extends Orderable>(tracks: T[], order: TrackOrder): T[] {
  return order === "default" ? tracks : [...tracks].sort(comparators[order]);
}

export function moveTarget<T>(items: readonly T[], from: number, to: number): { next: T[]; before: T | null } {
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return { next, before: next[to + 1] ?? null };
}

const DAY_MS = 86_400_000;

export function formatUpdated(iso: string | undefined, locale: string, now = Date.now()): string | undefined {
  const at = iso ? Date.parse(iso) : NaN;
  if (Number.isNaN(at)) return undefined;
  const startOf = (ms: number) => new Date(ms).setHours(0, 0, 0, 0);
  const days = Math.round((startOf(now) - startOf(at)) / DAY_MS);
  if (days < 0 || days > 30) return new Date(at).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" });
  return new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(-days, "day");
}

export function formatDuration(ms: number): string | undefined {
  if (!ms || ms < 0) return undefined;
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
