import { useEffect, useMemo, useRef, useState, type CSSProperties, type JSX, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Cover } from "../../components/Cover";
import { CoverObject } from "../../light/CoverObject";
import { Icon } from "../../icons/Icon";
import { useTranslation } from "../../ports/i18n";
import { playerEngine, usePlayerStore } from "../../ports/player";
import { rowTrack, type StatsOverview, type StatsRow } from "../../ports/stats";
import { navigateWithTransition } from "../../shell/navigate";
import { useUnavailable } from "../entity/EntityTracks";
import look from "../look.module.css";
import { usePlayingTint } from "../playingTint";
import { arcPath, artistArcs, dayRows, minutesOf, type DayMark, type ReplayPeriod } from "./replayModel";
import { artistHref, trackHref, useSongMenu } from "./StatsRows";
import { buckets, dateOf, dayProfile, filled, formatDay, formatTime, isoDate, MIN_CHART_BUCKETS, MIN_CHART_DAYS, peakIndex, weekdays } from "./statsModel";
import styles from "./Replay.module.css";

const SONGS_SHOWN = 10;
const STACK = 3;
const ARC_W = 1000;
const ARC_H = 360;

export interface ScreenProps {
  stats: StatsOverview;
  period: ReplayPeriod;
  name: string;
  today: string;
  against: string | null;
}

export function Screen({
  id,
  label,
  cover,
  onLit,
  children,
}: {
  id: string;
  label: string;
  cover?: string;
  onLit: (cover: string | undefined) => void;
  children: ReactNode;
}): JSX.Element {
  const box = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!box.current || typeof IntersectionObserver === "undefined") return;
    const watch = new IntersectionObserver(([entry]) => entry.isIntersecting && onLit(cover), { rootMargin: "-50% 0px -49% 0px" });
    watch.observe(box.current);
    return () => watch.disconnect();
  }, [cover, onLit]);
  return (
    <section ref={box} className={styles.screen} data-replay-screen={id} tabIndex={0} aria-label={label}>
      {children}
    </section>
  );
}

function firstHeard({ range, firstPlayedAt, days }: StatsOverview): string {
  const from = range.from ?? range.to;
  return firstPlayedAt && days.length > 0 && isoDate(new Date(firstPlayedAt)) >= from ? days[0].day : from;
}

export function TimeScreen({ stats, period, name, against }: ScreenProps): JSX.Element {
  const { t, locale } = useTranslation();
  const [hover, setHover] = useState<number | null>(null);
  const minutes = minutesOf(stats.totals.listenedMs);
  const items = useMemo(() => (stats.days.length > 0 ? buckets(stats.days, firstHeard(stats), stats.range.to, locale) : []), [stats, locale]);
  const max = Math.max(1, ...items.map((item) => item.listenedMs));
  const peak = peakIndex(items.map((item) => item.listenedMs));
  const shown = items[hover ?? peak];
  const part = dayProfile(stats.byHour).reduce((best, item) => (item.share > best.share ? item : best)).part;
  const when = t(`ui.stats.part.${part}.when`);
  const habit =
    filled(stats.byHour) < MIN_CHART_BUCKETS
      ? null
      : filled(stats.byWeekday) < MIN_CHART_BUCKETS
        ? t("ui.stats.story_part", { when })
        : t("ui.stats.story", { when, day: t(`ui.stats.on_day.${peakIndex(stats.byWeekday)}`) });
  return (
    <>
      <div className={styles.time}>
        <div className={styles.timeText}>
          <p className={styles.giant} data-testid="replay-minutes">
            {minutes.toLocaleString(locale)}
          </p>
          <h2 className={styles.line}>
            {t(period.kind === "all" ? "ui.replay.minutes_all" : period.kind === "week" ? "ui.replay.minutes_week" : "ui.replay.minutes", {
              count: minutes,
              name,
            })}
          </h2>
          {habit || against ? <p className={styles.note}>{[against, habit].filter(Boolean).join(" ")}</p> : null}
        </div>
        <div className={styles.stack} aria-hidden="true">
          {stats.top.tracks.slice(0, STACK).map((row, index) => (
            <span key={row.id} className={styles.object} style={{ "--i": index } as CSSProperties}>
              <Cover src={row.coverUrl ?? ""} size={360} />
            </span>
          ))}
        </div>
      </div>
      {stats.days.length >= MIN_CHART_DAYS && shown ? (
        <div className={styles.rhythm} role="img" aria-label={t("ui.stats.rhythm")} onPointerLeave={() => setHover(null)}>
          <span className={styles.rhythmRead} style={{ "--x": ((hover ?? peak) + 0.5) / items.length } as CSSProperties}>
            <span>
              {shown.title}, {formatTime(shown.listenedMs, t)}
            </span>
          </span>
          <div className={styles.rhythmLines} style={{ "--n": items.length } as CSSProperties}>
            {items.map((item, index) => (
              <span
                key={item.key}
                data-on={index === (hover ?? peak) ? "" : undefined}
                data-silent={item.listenedMs === 0 ? "" : undefined}
                style={{ "--h": item.listenedMs / max } as CSSProperties}
                onPointerEnter={() => setHover(index)}
              />
            ))}
          </div>
        </div>
      ) : null}
    </>
  );
}

function usePlay(rows: readonly StatsRow[]): (row: StatsRow) => void {
  const tracks = useMemo(() => rows.flatMap((item) => rowTrack(item.track) ?? []), [rows]);
  const unavailable = useUnavailable(tracks);
  return (row) => {
    const playable = tracks.filter((track) => unavailable(track) === null);
    const track = playable.find((item) => item.id === row.id);
    if (track) void playerEngine.playTrack(track, playable, "stats", "");
  };
}

export function SongScreen({ stats }: ScreenProps): JSX.Element {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const top = stats.top.tracks[0];
  const play = usePlay(stats.top.tracks);
  return (
    <div className={styles.song}>
      <CoverObject src={top.coverUrl ?? ""} size={560} className={styles.hero} />
      <div className={styles.songText}>
        <h2 className={styles.songTitle} data-long={top.title.length > 22 ? "" : undefined}>
          {top.title}
        </h2>
        <p className={styles.line}>{top.subtitle}</p>
        <p className={styles.note}>{t("ui.replay.song_plays", { count: top.plays, time: formatTime(top.listenedMs, t) })}</p>
        <div className={styles.actions}>
          <button type="button" className={`${look.pill} ${look.solid} ${look.wide}`} onClick={() => play(top)}>
            <Icon name="play" size={16} />
            {t("ui.stats.play")}
          </button>
          <button type="button" className={`${look.pill} ${look.glass}`} onClick={() => navigateWithTransition(navigate, trackHref(top.id))}>
            {t("ui.replay.song_story")}
          </button>
        </div>
      </div>
    </div>
  );
}

export function SongsScreen({ stats, onLit }: ScreenProps & { onLit: (cover: string | undefined) => void }): JSX.Element {
  const { t } = useTranslation();
  const rows = stats.top.tracks.slice(0, SONGS_SHOWN);
  const [at, setAt] = useState(1);
  const currentId = usePlayerStore((state) => state.currentTrack?.id ?? null);
  const play = usePlay(stats.top.tracks);
  const menu = useSongMenu();
  const tint = usePlayingTint(rows.some((row) => row.id === currentId));
  const shown = rows[Math.min(at, rows.length - 1)];
  return (
    <div className={styles.songs} style={tint}>
      <div className={styles.songsList}>
        <h2 className={styles.heading}>{t("ui.replay.songs")}</h2>
        <ol>
          {rows.map((row, index) => (
            <li key={row.id}>
              <button
                type="button"
                className={styles.songRow}
                data-on={row === shown ? "" : undefined}
                data-current={row.id === currentId ? "" : undefined}
                onPointerEnter={() => {
                  setAt(index);
                  onLit(row.coverUrl);
                }}
                onFocus={() => setAt(index)}
                onClick={() => play(row)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  const track = rowTrack(row.track);
                  if (track) menu.open(track, event.currentTarget, { x: event.clientX, y: event.clientY });
                }}
              >
                <span className={styles.rank}>{row.rank}</span>
                <span className={styles.songName}>{row.title}</span>
                <span className={styles.songBy}>{row.subtitle}</span>
                <span className={styles.songCount}>{t("ui.stats.plays", { count: row.plays })}</span>
              </button>
            </li>
          ))}
        </ol>
      </div>
      <div className={styles.object} style={{ "--size": "min(46cqh, 30cqw)" } as CSSProperties} aria-hidden="true">
        {rows.map((row) => (
          <span key={row.id} className={styles.layer} data-on={row === shown ? "" : undefined}>
            <Cover src={row.coverUrl ?? ""} size={420} />
          </span>
        ))}
      </div>
      {menu.layers}
    </div>
  );
}

export function ArtistsScreen({ stats }: ScreenProps): JSX.Element {
  const { t, locale } = useTranslation();
  const navigate = useNavigate();
  const [hover, setHover] = useState<string | null>(null);
  const from = firstHeard(stats);
  const arcs = useMemo(() => artistArcs(stats.artistDays, from, stats.range.to), [stats.artistDays, from, stats.range.to]);
  const rows = new Map(stats.top.artists.map((row) => [row.id, row]));
  const leader = stats.top.artists[0];
  const share = leader.listenedMs / Math.max(1, stats.totals.listenedMs);
  return (
    <div className={styles.artists}>
      <div>
        <h2 className={styles.heading}>{t("ui.replay.artists", { artist: leader.title })}</h2>
        <p className={styles.note}>{t("ui.replay.artists_note", { share: share.toLocaleString(locale, { style: "percent" }), artist: leader.title })}</p>
      </div>
      <div className={styles.arcs} data-hover={hover ? "" : undefined}>
        <svg viewBox={`0 0 ${ARC_W} ${ARC_H}`} preserveAspectRatio="none" aria-hidden="true">
          {arcs.map((arc, index) => (
            <path
              key={arc.id}
              className={styles.arc}
              data-on={hover === arc.id ? "" : undefined}
              style={{ "--i": index } as CSSProperties}
              d={arcPath(arc, ARC_W, ARC_H)}
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </svg>
        {arcs.map((arc, index) => {
          const row = rows.get(arc.id);
          if (!row) return null;
          return (
            <button
              key={arc.id}
              type="button"
              className={styles.artist}
              data-side={arc.peak > 0.72 ? "left" : undefined}
              data-on={hover === arc.id ? "" : undefined}
              data-lead={index === 0 ? "" : undefined}
              style={{ "--x": arc.peak, "--y": 1 - arc.height, "--i": index } as CSSProperties}
              onPointerEnter={() => setHover(arc.id)}
              onPointerLeave={() => setHover(null)}
              onFocus={() => setHover(arc.id)}
              onBlur={() => setHover(null)}
              onClick={() => navigateWithTransition(navigate, artistHref(row.id))}
            >
              <Cover src={row.coverUrl ?? ""} size={56} shape="circle" />
              <span>
                <b>{row.title}</b>
                <i>{formatTime(row.listenedMs, t)}</i>
              </span>
            </button>
          );
        })}
      </div>
      <div className={styles.axis} aria-hidden="true">
        <span>{formatDay(from, locale)}</span>
        <span>{formatDay(stats.range.to, locale)}</span>
      </div>
    </div>
  );
}

const DIAL = 200;
const DIAL_IN = 92;
const DIAL_OUT = 194;
const DIAL_HOURS = 74;

function dialPoint(hour: number, radius: number): [number, number] {
  const angle = ((hour * 15 - 90) * Math.PI) / 180;
  return [DIAL + radius * Math.cos(angle), DIAL + radius * Math.sin(angle)];
}

export function Dial({ byHour, shown, onHover }: { byHour: readonly number[]; shown: number; onHover?: (hour: number) => void }): JSX.Element {
  const max = Math.max(1, ...byHour);
  return (
    <svg viewBox="0 0 400 400" aria-hidden="true">
      {byHour.map((ms, hour) => {
        const [x1, y1] = dialPoint(hour, DIAL_IN);
        const [x2, y2] = dialPoint(hour, DIAL_IN + 2 + (ms / max) * (DIAL_OUT - DIAL_IN));
        return (
          <line
            key={hour}
            className={styles.ray}
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            data-on={hour === shown ? "" : undefined}
            data-silent={ms === 0 ? "" : undefined}
            style={{ "--v": ms / max } as CSSProperties}
          />
        );
      })}
      {onHover
        ? byHour.map((_, hour) => {
            const [x1, y1] = dialPoint(hour, DIAL_HOURS);
            const [x2, y2] = dialPoint(hour, DIAL_OUT);
            return <line key={hour} className={styles.rayHit} x1={x1} y1={y1} x2={x2} y2={y2} onPointerEnter={() => onHover(hour)} />;
          })
        : null}
      {[0, 6, 12, 18].map((hour) => {
        const [x, y] = dialPoint(hour, DIAL_HOURS);
        return (
          <text key={hour} className={styles.dialHour} x={x} y={y} textAnchor="middle" dominantBaseline="central">
            {hour}
          </text>
        );
      })}
    </svg>
  );
}

export function HoursScreen({ stats }: ScreenProps): JSX.Element {
  const { t, locale } = useTranslation();
  const [hover, setHover] = useState<number | null>(null);
  const shown = hover ?? peakIndex(stats.byHour);
  const lead = dayProfile(stats.byHour).reduce((best, item) => (item.share > best.share ? item : best));
  return (
    <div className={styles.hours}>
      <div className={styles.hoursText}>
        <h2 className={styles.heading}>{t(`ui.stats.part.${lead.part}.listener`)}</h2>
        <p className={styles.note}>
          {t("ui.replay.hours", { share: lead.share.toLocaleString(locale, { style: "percent" }), when: t(`ui.stats.part.${lead.part}.when`) })}
        </p>
      </div>
      <div className={styles.dial} role="img" aria-label={t("ui.stats.by_hour")} onPointerLeave={() => setHover(null)}>
        <Dial byHour={stats.byHour} shown={shown} onHover={setHover} />
        <div className={styles.dialCenter}>
          <strong>{`${String(shown).padStart(2, "0")}:00`}</strong>
          <span>{formatTime(stats.byHour[shown], t)}</span>
        </div>
      </div>
    </div>
  );
}

export function DaysScreen({ stats, period, today }: ScreenProps): JSX.Element {
  const { t, locale } = useTranslation();
  const [hover, setHover] = useState<DayMark | null>(null);
  const run = stats.longestStreak;
  const year = stats.range.to.slice(0, 4);
  const span = period.kind === "all" ? { from: `${year}-01-01`, to: `${year}-12-31` } : period;
  const days = period.kind === "all" ? stats.calendar : stats.days;
  const rows = dayRows(days, run, span, today, locale);
  const kind = rows.length === 1 ? "week" : rows.length > 6 ? "year" : "month";
  const heard = new Map(days.map((day) => [day.day, day.listenedMs]));
  return (
    <div className={styles.days} data-kind={kind}>
      <div>
        <h2 className={styles.heading}>{t("ui.replay.streak", { count: run.days })}</h2>
        <p className={styles.note}>
          {run.from && run.to ? t("ui.replay.streak_note", { from: formatDay(run.from, locale), to: formatDay(run.to, locale) }) : null}{" "}
          {t("ui.replay.days_heard", { count: stats.totals.activeDays })}
        </p>
        <p className={styles.note} aria-hidden="true">
          {hover ? `${formatDay(hover.day, locale)}: ${hover.share > 0 ? formatTime(heard.get(hover.day) ?? 0, t) : t("ui.stats.silence")}` : "\u00a0"}
        </p>
      </div>
      <div
        className={styles.dots}
        role="img"
        aria-label={t("ui.stats.days_with_music", { count: stats.totals.activeDays })}
        onPointerLeave={() => setHover(null)}
      >
        {kind === "year" ? null : (
          <div className={styles.dotRow} aria-hidden="true">
            {weekdays(locale).map(([weekday, name]) => (
              <span key={weekday} className={styles.dotName}>
                {name}
              </span>
            ))}
          </div>
        )}
        {rows.map((row) => (
          <div key={row.key} className={styles.dotRow}>
            {kind === "year" ? <span className={styles.dotName}>{dateOf(row.key).toLocaleDateString(locale, { month: "short" })}</span> : null}
            {row.days.map((mark, index) =>
              mark ? (
                <span
                  key={mark.day}
                  className={styles.dotDay}
                  data-run={mark.run ? "" : undefined}
                  data-heard={mark.share > 0 ? "" : undefined}
                  data-joined={mark.run && row.days[index + 1]?.run ? "" : undefined}
                  data-future={mark.future ? "" : undefined}
                  style={{ "--d": mark.share > 0 ? 0.3 + 0.7 * Math.sqrt(mark.share) : 0 } as CSSProperties}
                  onPointerEnter={() => setHover(mark)}
                />
              ) : (
                <span key={index} />
              ),
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function Moment({ row, at, line, lead }: { row: StatsRow; at: string; line: string; lead?: boolean }): JSX.Element {
  const { t, locale } = useTranslation();
  const play = usePlay(useMemo(() => [row], [row]));
  const when = new Date(at).toLocaleString(locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  return (
    <button
      type="button"
      className={styles.moment}
      data-lead={lead ? "" : undefined}
      aria-label={t("ui.stats.play_song", { title: row.title })}
      onClick={() => play(row)}
    >
      <span className={styles.object} style={{ "--size": "min(36cqh, 26cqw)" } as CSSProperties}>
        <Cover src={row.coverUrl ?? ""} size={360} />
      </span>
      <span className={styles.momentText}>
        <b>{row.title}</b>
        <span>{row.subtitle}</span>
        <i>
          {line} {when}
        </i>
      </span>
    </button>
  );
}

export function EndsScreen({ stats, period, today }: ScreenProps): JSX.Element | null {
  const { t, locale } = useTranslation();
  const { firstSong, lastSong, totals } = stats;
  if (!firstSong?.firstPlayedAt || !lastSong?.lastPlayedAt) return null;
  const open = period.kind === "all" || period.to >= today;
  return (
    <div className={styles.ends}>
      <Moment row={firstSong} at={firstSong.firstPlayedAt} line={t("ui.replay.first")} lead />
      <div className={styles.between}>
        <span>{t("ui.replay.between", { count: Math.max(0, totals.plays - 2), shown: Math.max(0, totals.plays - 2).toLocaleString(locale) })}</span>
      </div>
      <Moment row={lastSong} at={lastSong.lastPlayedAt} line={t(open ? "ui.replay.latest" : "ui.replay.last")} />
    </div>
  );
}
