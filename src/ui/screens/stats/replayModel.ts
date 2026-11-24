import type { StatsDay } from "../../ports/stats";
import { addDays, dateOf, daysBetween, firstWeekday, isoDate } from "./statsModel";

export type ReplayKind = "week" | "month" | "year" | "all";
export const REPLAY_KINDS: readonly ReplayKind[] = ["week", "month", "year", "all"];

export interface ReplayPeriod {
  kind: ReplayKind;
  from: string;
  to: string;
}

const PAST_SHOWN: Record<ReplayKind, number> = { week: 8, month: 12, year: 10, all: 0 };
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export function periodOf(kind: ReplayKind, day: string, locale: string): ReplayPeriod {
  const date = dateOf(day);
  if (kind === "week") {
    const from = addDays(day, -((date.getDay() - firstWeekday(locale) + 7) % 7));
    return { kind, from, to: addDays(from, 6) };
  }
  if (kind === "month") {
    return { kind, from: isoDate(new Date(date.getFullYear(), date.getMonth(), 1, 12)), to: isoDate(new Date(date.getFullYear(), date.getMonth() + 1, 0, 12)) };
  }
  if (kind === "year") return { kind, from: `${date.getFullYear()}-01-01`, to: `${date.getFullYear()}-12-31` };
  return { kind, from: "", to: "" };
}

export function parsePeriod(kind: string | null, at: string | null, today: string, locale: string): ReplayPeriod {
  const known = REPLAY_KINDS.find((item) => item === kind) ?? "month";
  const valid = at && ISO_DAY.test(at) && isoDate(dateOf(at)) === at && at <= today;
  return periodOf(known, valid ? at : today, locale);
}

export function pastPeriods(kind: ReplayKind, today: string, firstDay: string | null, locale: string): ReplayPeriod[] {
  const out: ReplayPeriod[] = [];
  if (kind === "all") return out;
  let period = periodOf(kind, today, locale);
  while (out.length < PAST_SHOWN[kind] && (out.length === 0 || (firstDay !== null && period.to >= firstDay))) {
    out.push(period);
    period = periodOf(kind, addDays(period.from, -1), locale);
  }
  return out;
}

export function periodName(period: ReplayPeriod, today: string, locale: string, inSentence = false): string {
  if (period.kind === "all") return "";
  const from = dateOf(period.from);
  const year = period.from.slice(0, 4);
  if (period.kind === "year") return year;
  const sameYear = year === today.slice(0, 4);
  if (period.kind === "month") {
    const name = from.toLocaleDateString(locale, { month: "long" });
    const title = inSentence ? name : name.charAt(0).toLocaleUpperCase(locale) + name.slice(1);
    return sameYear ? title : `${title} ${year}`;
  }
  const day: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" };
  return new Intl.DateTimeFormat(locale, sameYear ? day : { ...day, year: "numeric" }).formatRange(from, dateOf(period.to));
}

export interface Arc {
  id: string;
  from: number;
  peak: number;
  to: number;
  height: number;
}

const ARC_MIN_WIDTH = 0.06;
const ARC_EDGE = 0.14;
const ARC_STEP = 0.19;

/** One arc per artist, from the first to the last day it played, its top where the listening was thickest. */
export function artistArcs(artists: readonly { id: string; days: readonly StatsDay[] }[], from: string, to: string): Arc[] {
  const span = daysBetween(from, to) + 1;
  const reach = Math.max(0, Math.round(span / 24));
  return artists.flatMap(({ id, days }, rank) => {
    const heard = days.filter((day) => day.listenedMs > 0).map((day) => ({ at: daysBetween(from, day.day), ms: day.listenedMs }));
    if (heard.length === 0) return [];
    const weight = (at: number) => heard.reduce((sum, day) => sum + (Math.abs(day.at - at) <= reach ? day.ms : 0), 0);
    const top = heard.reduce((best, day) => (weight(day.at) > weight(best.at) ? day : best));
    let start = heard[0].at / span;
    let end = (heard[heard.length - 1].at + 1) / span;
    if (end - start < ARC_MIN_WIDTH) {
      start = Math.min(Math.max(0, (start + end - ARC_MIN_WIDTH) / 2), 1 - ARC_MIN_WIDTH);
      end = start + ARC_MIN_WIDTH;
    }
    const edge = (end - start) * ARC_EDGE;
    const peak = Math.min(Math.max((top.at + 0.5) / span, start + edge), end - edge);
    return [{ id, from: start, peak, to: end, height: 1 - rank * ARC_STEP }];
  });
}

export function arcPath(arc: Arc, width: number, height: number): string {
  const [start, peak, end] = [arc.from, arc.peak, arc.to].map((x) => x * width);
  const top = height * (1 - arc.height);
  const shoulder = top + (height - top) * 0.45;
  return `M ${start} ${height} C ${start} ${shoulder} ${peak - (peak - start) * 0.55} ${top} ${peak} ${top} C ${peak + (end - peak) * 0.55} ${top} ${end} ${shoulder} ${end} ${height}`;
}

export interface DayMark {
  day: string;
  share: number;
  run: boolean;
  future: boolean;
}

/** The days of the period as rows: one for a week, calendar weeks for a month, months for a year. */
export function dayRows(
  days: readonly StatsDay[],
  run: { from: string | null; to: string | null },
  period: { from: string; to: string },
  today: string,
  locale: string,
): { key: string; days: (DayMark | null)[] }[] {
  const byDay = new Map(days.map((day) => [day.day, day]));
  const max = Math.max(1, ...days.map((day) => day.listenedMs));
  const months = daysBetween(period.from, period.to) >= 31;
  const rows = new Map<string, { key: string; days: (DayMark | null)[] }>();
  for (let day = period.from; day <= period.to; day = addDays(day, 1)) {
    const week = periodOf("week", day, locale).from;
    const key = months ? day.slice(0, 7) : week;
    const row = rows.get(key) ?? { key: months ? `${key}-01` : key, days: months ? [] : Array.from({ length: daysBetween(week, day) }, () => null) };
    const found = byDay.get(day);
    row.days.push({
      day,
      share: found && found.plays > 0 ? found.listenedMs / max : 0,
      run: run.from !== null && run.to !== null && day >= run.from && day <= run.to,
      future: day > today,
    });
    rows.set(key, row);
  }
  return [...rows.values()];
}

export function minutesOf(ms: number): number {
  return Math.round(ms / 60_000);
}
