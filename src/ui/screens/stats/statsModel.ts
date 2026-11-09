import type { TFunction } from "../../ports/i18n";
import type { StatsDay, StatsDays, StatsOverview } from "../../ports/stats";

export type RangeKey = "week" | "month" | "year" | "all" | "custom";

export const RANGE_KEYS: readonly RangeKey[] = ["week", "month", "year", "all", "custom"];
const ROLLING_DAYS: Partial<Record<RangeKey, number>> = { week: 7, month: 30, year: 365 };
const DAY_MS = 86_400_000;
const CALENDAR_WEEKS = 53;
export const MIN_CHART_DAYS = 3;
export const MIN_CHART_BUCKETS = 3;
export const MIN_CALENDAR_DAYS = 7;

export type DayPart = "night" | "morning" | "afternoon" | "evening";
export const DAY_PARTS: readonly { part: DayPart; from: number; to: number }[] = [
  { part: "night", from: 0, to: 6 },
  { part: "morning", from: 6, to: 12 },
  { part: "afternoon", from: 12, to: 18 },
  { part: "evening", from: 18, to: 24 },
];

const pad = (value: number) => String(value).padStart(2, "0");

export function isoDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Noon, so adding days never lands on the wrong side of a clock change. */
export function dateOf(iso: string): Date {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year, month - 1, day, 12);
}

export function addDays(iso: string, days: number): string {
  const date = dateOf(iso);
  date.setDate(date.getDate() + days);
  return isoDate(date);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((dateOf(to).getTime() - dateOf(from).getTime()) / DAY_MS);
}

export function rangeDays(key: RangeKey, today: string, custom: { from: string; to: string } | null): StatsDays {
  if (key === "custom") return custom ?? {};
  const days = ROLLING_DAYS[key];
  return days ? { from: addDays(today, 1 - days), to: today } : {};
}

export function parseRange(value: string | null): RangeKey {
  return RANGE_KEYS.includes(value as RangeKey) ? (value as RangeKey) : "month";
}

export function formatTime(ms: number, t: TFunction): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return t("ui.stats.seconds", { n: Math.round(ms / 1000) });
  if (minutes < 60) return t("ui.stats.minutes", { n: minutes });
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours >= 100 || rest === 0) return t("ui.stats.hours", { n: hours.toLocaleString() });
  return t("ui.stats.hours_minutes", { h: hours, m: rest });
}

export function formatDay(iso: string, locale: string, withYear = false): string {
  return dateOf(iso).toLocaleDateString(locale, { day: "numeric", month: "short", ...(withYear ? { year: "numeric" } : {}) });
}

export function formatInstant(iso: string, locale: string): string {
  return new Date(iso).toLocaleDateString(locale, { day: "numeric", month: "long", year: "numeric" });
}

export function change(now: number, before: number | undefined): number | null {
  if (before === undefined || before <= 0) return null;
  return Math.round(((now - before) / before) * 100);
}

export interface Bucket {
  key: string;
  label: string;
  title: string;
  listenedMs: number;
  plays: number;
}

export function buckets(days: readonly StatsDay[], from: string, to: string, locale: string): Bucket[] {
  const span = daysBetween(from, to) + 1;
  const byDay = new Map(days.map((day) => [day.day, day]));
  const out: Bucket[] = [];
  if (span <= 62) {
    for (let at = 0; at < span; at += 1) {
      const key = addDays(from, at);
      const day = byDay.get(key);
      const label = formatDay(key, locale);
      const weekday = dateOf(key).toLocaleDateString(locale, { weekday: "short" });
      out.push({ key, label, title: `${weekday}, ${label}`, listenedMs: day?.listenedMs ?? 0, plays: day?.plays ?? 0 });
    }
    return out;
  }
  if (span <= 400) {
    for (let at = 0; at < span; at += 7) {
      const key = addDays(from, at);
      const end = addDays(from, Math.min(at + 6, span - 1));
      const bucket: Bucket = { key, label: formatDay(key, locale), title: `${formatDay(key, locale)} – ${formatDay(end, locale)}`, listenedMs: 0, plays: 0 };
      for (let day = 0; day < 7 && at + day < span; day += 1) {
        const found = byDay.get(addDays(from, at + day));
        bucket.listenedMs += found?.listenedMs ?? 0;
        bucket.plays += found?.plays ?? 0;
      }
      out.push(bucket);
    }
    return out;
  }
  const months = new Map<string, Bucket>();
  const month = dateOf(from);
  month.setDate(1);
  while (isoDate(month).slice(0, 7) <= to.slice(0, 7)) {
    const key = isoDate(month).slice(0, 7);
    const label = month.toLocaleDateString(locale, { month: "short", year: "2-digit" });
    months.set(key, { key, label, title: month.toLocaleDateString(locale, { month: "long", year: "numeric" }), listenedMs: 0, plays: 0 });
    month.setMonth(month.getMonth() + 1);
  }
  for (const day of days) {
    const bucket = months.get(day.day.slice(0, 7));
    if (bucket) {
      bucket.listenedMs += day.listenedMs;
      bucket.plays += day.plays;
    }
  }
  return [...months.values()];
}

export function firstWeekday(locale: string): number {
  return locale === "ru" ? 1 : 0;
}

export interface CalendarCell {
  day: string;
  listenedMs: number;
  plays: number;
  level: number;
  inRange: boolean;
}

export function calendarWeeks(days: readonly StatsDay[], to: string, from: string | null, locale: string): CalendarCell[][] {
  const byDay = new Map(days.map((day) => [day.day, day]));
  const sorted = days
    .map((day) => day.listenedMs)
    .filter((ms) => ms > 0)
    .sort((a, b) => a - b);
  const edge = (share: number) => sorted[Math.floor((sorted.length - 1) * share)] ?? 0;
  const edges = [edge(0.25), edge(0.5), edge(0.75)];
  const shift = (dateOf(to).getDay() - firstWeekday(locale) + 7) % 7;
  const weekEnd = addDays(to, 6 - shift);
  const first = addDays(weekEnd, 1 - CALENDAR_WEEKS * 7);
  const weeks: CalendarCell[][] = [];
  for (let week = 0; week < CALENDAR_WEEKS; week += 1) {
    const cells: CalendarCell[] = [];
    for (let weekday = 0; weekday < 7; weekday += 1) {
      const key = addDays(first, week * 7 + weekday);
      const found = byDay.get(key);
      const ms = found?.listenedMs ?? 0;
      cells.push({
        day: key,
        listenedMs: ms,
        plays: found?.plays ?? 0,
        level: ms <= 0 ? 0 : 1 + edges.filter((value) => ms > value).length,
        inRange: key <= to && (from === null || key >= from),
      });
    }
    weeks.push(cells);
  }
  return weeks;
}

export function dayProfile(byHour: readonly number[]): { part: DayPart; share: number; ms: number }[] {
  const total = byHour.reduce((sum, ms) => sum + ms, 0);
  return DAY_PARTS.map(({ part, from, to }) => {
    const ms = byHour.slice(from, to).reduce((sum, value) => sum + value, 0);
    return { part, ms, share: total > 0 ? ms / total : 0 };
  });
}

export function peakIndex(values: readonly number[]): number {
  return values.reduce((best, value, index) => (value > values[best] ? index : best), 0);
}

export const filled = (values: readonly number[]): number => values.filter((value) => value > 0).length;

export type Fullness = "never" | "silent" | "first" | "full";

export function fullness(stats: StatsOverview): Fullness {
  if (!stats.firstPlayedAt) return "never";
  if (stats.totals.listenedMs === 0) return "silent";
  return stats.calendar.filter((day) => day.plays > 0).length < MIN_CALENDAR_DAYS ? "first" : "full";
}

export function weekdays(locale: string): [number, string][] {
  const first = firstWeekday(locale);
  // 2 January 2028 is a Sunday
  return Array.from({ length: 7 }, (_, index) => {
    const weekday = (first + index) % 7;
    return [weekday, new Date(2028, 0, 2 + weekday, 12).toLocaleDateString(locale, { weekday: "short" })] as [number, string];
  });
}
