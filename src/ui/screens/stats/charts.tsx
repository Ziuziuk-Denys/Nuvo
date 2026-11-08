import { useState, type CSSProperties, type JSX, type ReactNode } from "react";
import { useTranslation } from "../../ports/i18n";
import { ringSegment } from "../settings/StorageSection";
import { dayProfile, peakIndex, formatDay, formatTime, weekdays, calendarWeeks, type CalendarCell } from "./statsModel";
import type { StatsDay } from "../../ports/stats";
import styles from "./Stats.module.css";

export interface BarItem {
  key: string;
  label: string;
  title: string;
  value: number;
  plays?: number;
}

const TICKS = 6;

/** Which columns carry a label: evenly spread, first and last included. */
function tickIndexes(count: number): number[] {
  if (count <= TICKS + 2) return Array.from({ length: count }, (_, index) => index);
  return Array.from({ length: TICKS }, (_, index) => Math.round((index * (count - 1)) / (TICKS - 1)));
}

/** A section's heading, and on its right what the pointer is over. */
export function Section({ title, aside, children, id }: { title: string; aside?: ReactNode; children: ReactNode; id?: string }): JSX.Element {
  return (
    <section className={styles.section} data-stats-section={id}>
      <header className={styles.sectionHead}>
        <h2 className={styles.sectionTitle}>{title}</h2>
        {aside ? <span className={styles.readout}>{aside}</span> : null}
      </header>
      {children}
    </section>
  );
}

/** Columns from one baseline: the strongest in the accent, the top of the scale named once. */
export function BarChart({
  items,
  label,
  marks,
  onHover,
}: {
  items: BarItem[];
  label: string;
  marks?: readonly number[];
  onHover: (item: BarItem | null) => void;
}): JSX.Element {
  const { t } = useTranslation();
  const max = Math.max(1, ...items.map((item) => item.value));
  const peak = peakIndex(items.map((item) => item.value));
  const ticks = new Set(marks ?? tickIndexes(items.length));
  return (
    <div className={styles.chart}>
      <div className={styles.plot} role="img" aria-label={label} onPointerLeave={() => onHover(null)}>
        <span className={styles.scale}>{formatTime(max, t)}</span>
        <div className={styles.columns}>
          {items.map((item, index) => (
            <span key={item.key} className={styles.column} onPointerEnter={() => onHover(item)}>
              <span
                className={styles.columnBar}
                data-peak={index === peak && item.value > 0 ? "" : undefined}
                style={{ "--h": item.value / max, "--i": index / items.length } as CSSProperties}
              />
            </span>
          ))}
        </div>
      </div>
      <div className={styles.ticks} data-spread={items.length > TICKS + 2 && !marks ? "" : undefined} aria-hidden="true">
        {items.map((item, index) => (
          <span key={item.key} className={styles.tick}>
            {ticks.has(index) ? <span>{item.label}</span> : null}
          </span>
        ))}
      </div>
    </div>
  );
}

const CELL_LEVELS = [0, 1, 2, 3, 4] as const;

/** Fifty-three weeks of days; the selected period stays lit, the rest of the year steps back. */
export function Calendar({ days, from, to }: { days: readonly StatsDay[]; from: string | null; to: string }): JSX.Element {
  const { t, locale } = useTranslation();
  const [hover, setHover] = useState<CalendarCell | null>(null);
  const weeks = calendarWeeks(days, to, from, locale);
  const names = weekdays(locale);
  // a month's name sits over its first week; the very first would run into the second
  const months = weeks.map((week, index) =>
    index > 0 && week[0].day.slice(0, 7) !== weeks[index - 1][0].day.slice(0, 7)
      ? new Date(`${week[0].day}T12:00:00`).toLocaleDateString(locale, { month: "short" })
      : null,
  );
  const total = days.filter((day) => day.plays > 0).length;
  return (
    <Section
      id="calendar"
      title={t("ui.stats.calendar")}
      aside={
        hover ? (
          <>
            {formatDay(hover.day, locale, true)}: {hover.listenedMs > 0 ? formatTime(hover.listenedMs, t) : t("ui.stats.silence")}
          </>
        ) : (
          t("ui.stats.days_with_music", { count: total })
        )
      }
    >
      <div className={styles.calendar} role="img" aria-label={t("ui.stats.days_with_music", { count: total })} onPointerLeave={() => setHover(null)}>
        <div className={styles.calendarMonths} aria-hidden="true">
          {months.map((month, index) => (
            <span key={index} className={styles.calendarMonth}>
              {month ? <span>{month}</span> : null}
            </span>
          ))}
        </div>
        <div className={styles.calendarBody}>
          <div className={styles.calendarDays} aria-hidden="true">
            {names.map(([weekday, name], index) => (
              <span key={weekday}>{index % 2 === 1 ? name : ""}</span>
            ))}
          </div>
          <div className={styles.calendarGrid}>
            {weeks.map((week) => (
              <span key={week[0].day} className={styles.calendarWeek}>
                {week.map((cell) => (
                  <span
                    key={cell.day}
                    className={styles.cell}
                    data-level={cell.level}
                    data-out={cell.inRange ? undefined : ""}
                    onPointerEnter={() => setHover(cell)}
                  />
                ))}
              </span>
            ))}
          </div>
        </div>
        <div className={styles.calendarKey} aria-hidden="true">
          <span>{t("ui.stats.less")}</span>
          {CELL_LEVELS.map((level) => (
            <span key={level} className={styles.cell} data-level={level} />
          ))}
          <span>{t("ui.stats.more")}</span>
        </div>
      </div>
    </Section>
  );
}

/** The day as a dial: midnight on top, each hour a wedge as long as its listening. */
export function Clock({ byHour }: { byHour: readonly number[] }): JSX.Element {
  const { t, locale } = useTranslation();
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...byHour);
  const peak = peakIndex(byHour);
  const total = byHour.reduce((sum, ms) => sum + ms, 0);
  const lead = dayProfile(byHour).reduce((best, item) => (item.share > best.share ? item : best));
  const hourName = (hour: number) => `${String(hour).padStart(2, "0")}:00`;
  return (
    <div className={styles.clock} role="img" aria-label={t(`ui.stats.part.${lead.part}.listener`)} onPointerLeave={() => setHover(null)}>
      <svg viewBox="0 0 200 200" aria-hidden="true">
        <circle className={styles.clockRing} cx="100" cy="100" r="47" />
        {byHour.map((ms, hour) => (
          <path
            key={hour}
            className={styles.wedge}
            data-peak={hour === peak && ms > 0 ? "" : undefined}
            data-on={hover === hour ? "" : undefined}
            d={ringSegment(50, 50 + Math.max(0.04, ms / max) * 38, hour * 15 + 0.9, (hour + 1) * 15 - 0.9)}
          />
        ))}
        {byHour.map((_, hour) => (
          <path key={hour} className={styles.wedgeHit} d={ringSegment(47, 92, hour * 15, (hour + 1) * 15)} onPointerEnter={() => setHover(hour)} />
        ))}
        {[0, 6, 12, 18].map((hour) => {
          const angle = ((hour * 15 - 90) * Math.PI) / 180;
          return (
            <text
              key={hour}
              className={styles.clockHour}
              x={100 + 96 * Math.cos(angle)}
              y={100 + 96 * Math.sin(angle)}
              textAnchor="middle"
              dominantBaseline="central"
            >
              {hour}
            </text>
          );
        })}
      </svg>
      <div className={styles.clockCenter}>
        {hover === null ? (
          <>
            <strong>{t(`ui.stats.part.${lead.part}.name`)}</strong>
            <span>{lead.share.toLocaleString(locale, { style: "percent" })}</span>
          </>
        ) : (
          <>
            <strong>{hourName(hover)}</strong>
            <span>{total > 0 ? formatTime(byHour[hover], t) : ""}</span>
          </>
        )}
      </div>
    </div>
  );
}

export interface ShareItem {
  key: string;
  label: string;
  share: number;
  note: string;
}

/** Parts of a whole as thin rows: name, share and the bar under them. */
export function ShareRows({ items }: { items: ShareItem[] }): JSX.Element {
  const { locale } = useTranslation();
  return (
    <ul className={styles.shares}>
      {items.map((item) => (
        <li key={item.key} className={styles.share}>
          <span className={styles.shareName}>{item.label}</span>
          <span className={styles.shareNote}>
            {item.note} <b>{item.share.toLocaleString(locale, { style: "percent" })}</b>
          </span>
          <span className={styles.shareTrack}>
            <span className={styles.shareBar} style={{ "--w": item.share } as CSSProperties} />
          </span>
        </li>
      ))}
    </ul>
  );
}

export interface CurvePoint {
  key: string;
  label: string;
  value: number;
  title: string;
}

const CURVE_TOP = 6;

/** A soft area under one line, for a song's months. */
export function Curve({ points, label, onHover }: { points: CurvePoint[]; label: string; onHover: (point: CurvePoint | null) => void }): JSX.Element {
  const max = Math.max(1, ...points.map((point) => point.value));
  const x = (index: number) => (index / Math.max(1, points.length - 1)) * 100;
  const y = (value: number) => 100 - (value / max) * (100 - CURVE_TOP);
  const line = points.map((point, index) => `${index === 0 ? "M" : "L"} ${x(index)} ${y(point.value)}`).join(" ");
  const ticks = new Set(tickIndexes(points.length));
  return (
    <div className={styles.chart}>
      <div className={styles.curve} role="img" aria-label={label} onPointerLeave={() => onHover(null)}>
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <path className={styles.curveArea} d={`${line} L 100 100 L 0 100 Z`} />
          <path className={styles.curveLine} d={line} />
        </svg>
        <div className={styles.curveHits}>
          {points.map((point) => (
            <span key={point.key} onPointerEnter={() => onHover(point)} />
          ))}
        </div>
      </div>
      <div className={styles.ticks} data-spread="" aria-hidden="true">
        {points.map((point, index) => (
          <span key={point.key} className={styles.tick}>
            {ticks.has(index) ? <span>{point.label}</span> : null}
          </span>
        ))}
      </div>
    </div>
  );
}
