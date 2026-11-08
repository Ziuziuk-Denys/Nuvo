import { useMemo, useState, type JSX } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "../../components/Button";
import { Cover } from "../../components/Cover";
import { EmptyState } from "../../components/EmptyState";
import { Enter } from "../../components/Enter";
import { Menu, type MenuItem } from "../../components/Menu";
import { Popover } from "../../components/Popover";
import { Sheet } from "../../components/Sheet";
import { useToastStore } from "../../feedback/toastStore";
import { Icon } from "../../icons/Icon";
import { usePageBackdrop } from "../../ports/backdrop";
import { useTranslation, type TFunction } from "../../ports/i18n";
import { playlistHref } from "../../app/hrefs";
import {
  deleteStats,
  exportStats,
  rowTrack,
  useStatsOverview,
  useStatsPaused,
  type StatsDays,
  type StatsOverview,
  type StatsRow,
  type StatsShare,
} from "../../ports/stats";
import { navigateWithTransition } from "../../shell/navigate";
import look from "../look.module.css";
import { BarChart, Calendar, Clock, Section, ShareRows, type BarItem, type ShareItem } from "./charts";
import { artistHref, GroupRows, SongRows, trackHref } from "./StatsRows";
import {
  addDays,
  buckets,
  change,
  dayProfile,
  filled,
  formatDay,
  formatInstant,
  formatTime,
  fullness,
  isoDate,
  MIN_CALENDAR_DAYS,
  MIN_CHART_BUCKETS,
  MIN_CHART_DAYS,
  parseRange,
  peakIndex,
  RANGE_KEYS,
  rangeDays,
  weekdays,
  type RangeKey,
} from "./statsModel";
import styles from "./Stats.module.css";

const TOP_SHOWN = 10;
const SIDE_SHOWN = 5;

type TopKind = "tracks" | "artists" | "albums" | "playlists" | "genres";
const TOP_KINDS: readonly TopKind[] = ["tracks", "artists", "albums", "playlists", "genres"];

function percentChange(delta: number, locale: string): string {
  return new Intl.NumberFormat(locale, { style: "percent", signDisplay: "exceptZero" }).format(delta / 100);
}

const count = (value: number, locale: string) => value.toLocaleString(locale);

/** The small difference beside a number; nothing without a previous period. */
function Delta({ now, before }: { now: number; before: number | undefined }): JSX.Element | null {
  const { locale } = useTranslation();
  const delta = change(now, before);
  if (!delta) return null;
  return <span className={styles.delta}>{percentChange(delta, locale)}</span>;
}

function Figure({ value, label, delta }: { value: string; label: string; delta?: JSX.Element | null }): JSX.Element {
  return (
    <div className={styles.figure}>
      <span className={styles.figureValue}>
        {value}
        {delta}
      </span>
      <span className={styles.figureLabel}>{label}</span>
    </div>
  );
}

function leadText(key: RangeKey, stats: StatsOverview, t: TFunction, locale: string): string {
  if (key === "all") return t("ui.stats.lead_all", { date: stats.range.from ? formatDay(stats.range.from, locale, true) : "" });
  if (key === "custom")
    return t("ui.stats.lead_custom", { from: formatDay(stats.range.from ?? "", locale, true), to: formatDay(stats.range.to, locale, true) });
  return t(`ui.stats.lead_${key}`);
}

/** A sentence about the period: when the listening happens, once there is enough to say it. */
function story(stats: StatsOverview, t: TFunction): string | null {
  if (filled(stats.byHour) < MIN_CHART_BUCKETS) return null;
  const part = dayProfile(stats.byHour).reduce((best, item) => (item.share > best.share ? item : best)).part;
  const when = t(`ui.stats.part.${part}.when`);
  if (filled(stats.byWeekday) < MIN_CHART_BUCKETS) return t("ui.stats.story_part", { when });
  return t("ui.stats.story", { when, day: t(`ui.stats.on_day.${peakIndex(stats.byWeekday)}`) });
}

function Lead({ stats, range }: { stats: StatsOverview; range: RangeKey }): JSX.Element {
  const { t, locale } = useTranslation();
  const top = stats.top.tracks[0];
  const delta = change(stats.totals.listenedMs, stats.previous?.listenedMs);
  const sentence = story(stats, t);
  const track = top ? rowTrack(top.track) : null;
  const navigate = useNavigate();
  return (
    <div className={styles.lead}>
      <div className={styles.leadText}>
        <p className={styles.leadNumber} data-testid="stats-lead">
          {formatTime(stats.totals.listenedMs, t)}
        </p>
        <p className={styles.leadLine}>
          {leadText(range, stats, t, locale)}
          {delta !== null ? <span className={styles.leadDelta}> {t("ui.stats.vs_previous", { delta: percentChange(delta, locale) })}</span> : null}
        </p>
        {sentence ? <p className={styles.leadStory}>{sentence}</p> : null}
      </div>
      {top && track ? (
        <button type="button" className={styles.leadSong} onClick={() => navigateWithTransition(navigate, trackHref(top.id))}>
          <Cover src={top.coverUrl ?? ""} size={112} radius={10} />
          <span className={styles.leadSongText}>
            <span className={styles.leadSongLabel}>{t("ui.stats.most_played")}</span>
            <span className={styles.leadSongTitle}>{top.title}</span>
            <span className={styles.leadSongArtist}>{top.subtitle}</span>
            <span className={styles.leadSongMeta}>{t("ui.stats.plays", { count: top.plays })}</span>
          </span>
        </button>
      ) : null}
    </div>
  );
}

function Figures({ stats }: { stats: StatsOverview }): JSX.Element {
  const { t, locale } = useTranslation();
  const { totals, previous } = stats;
  return (
    <div className={styles.figures}>
      <Figure value={count(totals.plays, locale)} label={t("ui.stats.label_plays")} delta={<Delta now={totals.plays} before={previous?.plays} />} />
      <Figure value={count(totals.tracks, locale)} label={t("ui.stats.label_tracks")} delta={<Delta now={totals.tracks} before={previous?.tracks} />} />
      <Figure value={count(totals.artists, locale)} label={t("ui.stats.label_artists")} delta={<Delta now={totals.artists} before={previous?.artists} />} />
      <Figure value={count(totals.albums, locale)} label={t("ui.stats.label_albums")} delta={<Delta now={totals.albums} before={previous?.albums} />} />
      <Figure
        value={count(totals.activeDays, locale)}
        label={t("ui.stats.label_active_days")}
        delta={<Delta now={totals.activeDays} before={previous?.activeDays} />}
      />
      <Figure value={t("ui.stats.days", { count: stats.currentStreak })} label={t("ui.stats.label_streak", { best: stats.longestStreak.days })} />
    </div>
  );
}

function Rhythm({ stats }: { stats: StatsOverview }): JSX.Element | null {
  const { t, locale } = useTranslation();
  const [hover, setHover] = useState<BarItem | null>(null);
  const items = useMemo(
    () =>
      stats.range.from
        ? buckets(stats.days, stats.range.from, stats.range.to, locale).map((bucket) => ({
            key: bucket.key,
            label: bucket.label,
            title: bucket.title,
            value: bucket.listenedMs,
            plays: bucket.plays,
          }))
        : [],
    [stats.days, stats.range.from, stats.range.to, locale],
  );
  if (stats.days.length < MIN_CHART_DAYS) return null;
  const shown = hover ?? items[peakIndex(items.map((item) => item.value))];
  return (
    <Section
      id="rhythm"
      title={t("ui.stats.rhythm")}
      aside={
        <>
          {shown.title}: {formatTime(shown.value, t)}, {t("ui.stats.plays", { count: shown.plays ?? 0 })}
        </>
      }
    >
      <BarChart items={items} label={t("ui.stats.rhythm")} onHover={setHover} />
    </Section>
  );
}

function When({ stats }: { stats: StatsOverview }): JSX.Element | null {
  const { t, locale } = useTranslation();
  const [hover, setHover] = useState<BarItem | null>(null);
  const hours = filled(stats.byHour) >= MIN_CHART_BUCKETS;
  const days = filled(stats.byWeekday) >= MIN_CHART_BUCKETS;
  if (!hours && !days) return null;
  const profile = dayProfile(stats.byHour);
  const parts: ShareItem[] = profile.map(({ part, share, ms }) => ({
    key: part,
    label: t(`ui.stats.part.${part}.name`),
    share,
    note: ms > 0 ? formatTime(ms, t) : "",
  }));
  const week: BarItem[] = weekdays(locale).map(([weekday, name]) => ({
    key: String(weekday),
    label: name,
    title: name,
    value: stats.byWeekday[weekday],
  }));
  const lead = profile.reduce((best, item) => (item.share > best.share ? item : best));
  return (
    <div className={styles.when}>
      {hours ? (
        <Section id="hours" title={t(`ui.stats.part.${lead.part}.listener`)}>
          <div className={styles.dayPlan}>
            <Clock byHour={stats.byHour} />
            <ShareRows items={parts} />
          </div>
        </Section>
      ) : null}
      {days ? (
        <Section id="weekdays" title={t("ui.stats.by_weekday")} aside={hover ? `${hover.title}: ${formatTime(hover.value, t)}` : undefined}>
          <BarChart items={week} label={t("ui.stats.by_weekday")} onHover={setHover} />
        </Section>
      ) : null}
    </div>
  );
}

function Top({ stats }: { stats: StatsOverview }): JSX.Element {
  const { t } = useTranslation();
  const [kind, setKind] = useState<TopKind>("tracks");
  const [all, setAll] = useState(false);
  const kinds = TOP_KINDS.filter((item) => stats.top[item].length > 0);
  const shownKind = kinds.includes(kind) ? kind : "tracks";
  const rows = stats.top[shownKind].slice(0, all ? undefined : TOP_SHOWN);
  const meta = (row: StatsRow) => `${t("ui.stats.plays", { count: row.plays })} · ${formatTime(row.listenedMs, t)}`;
  const named = rows.map((row) => (shownKind === "playlists" && row.id === "likes" ? { ...row, title: t("ui.library.liked") } : row));
  return (
    <Section id="top" title={t("ui.stats.top")}>
      <div className={styles.topTabs} role="tablist" aria-label={t("ui.stats.top")}>
        {kinds.map((item) => (
          <button
            key={item}
            type="button"
            role="tab"
            aria-selected={item === shownKind}
            className={`${look.pill} ${item === shownKind ? look.solid : look.glass}`}
            onClick={() => {
              setKind(item);
              setAll(false);
            }}
          >
            {t(`ui.stats.top_${item}`)}
          </button>
        ))}
      </div>
      {shownKind === "tracks" ? <SongRows rows={named} meta={meta} ranked /> : null}
      {shownKind === "artists" ? <GroupRows rows={named} meta={meta} shape="circle" open={(row) => artistHref(row.id)} /> : null}
      {shownKind === "albums" ? (
        <GroupRows rows={named} meta={meta} open={(row) => (row.openId ? `/collection?type=album&id=${encodeURIComponent(row.openId)}` : null)} />
      ) : null}
      {shownKind === "playlists" ? <GroupRows rows={named} meta={meta} open={(row) => playlistHref(row.id)} /> : null}
      {shownKind === "genres" ? <GroupRows rows={named} meta={meta} /> : null}
      {!all && stats.top[shownKind].length > TOP_SHOWN ? (
        <button type="button" className={`${look.pill} ${look.glass} ${styles.showAll}`} onClick={() => setAll(true)}>
          {t("ui.stats.show_all", { count: stats.top[shownKind].length })}
        </button>
      ) : null}
    </Section>
  );
}

function Habits({ stats }: { stats: StatsOverview }): JSX.Element {
  const { t, locale } = useTranslation();
  const { totals, previous, sessions } = stats;
  const percent = (rate: number) => new Intl.NumberFormat(locale, { style: "percent" }).format(rate);
  const total = (list: StatsShare[]) => list.reduce((sum, share) => sum + share.listenedMs, 0);
  const shares = (list: StatsShare[], prefix: string): ShareItem[] =>
    list.map((share) => ({
      key: share.kind,
      label: t(`ui.stats.${prefix}.${share.kind}`),
      share: share.listenedMs / Math.max(1, total(list)),
      note: formatTime(share.listenedMs, t),
    }));
  return (
    <Section id="habits" title={t("ui.stats.habits")}>
      <div className={styles.figures} data-compact="">
        <Figure
          value={percent(totals.completedRate)}
          label={t("ui.stats.completed_rate")}
          delta={<Delta now={totals.completedRate} before={previous?.completedRate} />}
        />
        <Figure value={percent(totals.skipRate)} label={t("ui.stats.skip_rate")} delta={<Delta now={totals.skipRate} before={previous?.skipRate} />} />
        <Figure value={formatTime(sessions.averageMs, t)} label={t("ui.stats.average_session")} />
        <Figure
          value={formatTime(sessions.longestMs, t)}
          label={
            sessions.longestStartedAt
              ? t("ui.stats.longest_session", { date: formatInstant(sessions.longestStartedAt, locale) })
              : t("ui.stats.longest_session_plain")
          }
        />
      </div>
      {stats.sources.length > 1 || stats.origins.length > 1 ? (
        <div className={styles.sources}>
          {stats.sources.length > 1 ? (
            <div>
              <h3 className={styles.subTitle}>{t("ui.stats.started_from")}</h3>
              <ShareRows items={shares(stats.sources, "source")} />
            </div>
          ) : null}
          {stats.origins.length > 1 ? (
            <div>
              <h3 className={styles.subTitle}>{t("ui.stats.played_from")}</h3>
              <ShareRows items={shares(stats.origins, "origin")} />
            </div>
          ) : null}
        </div>
      ) : null}
    </Section>
  );
}

function SideList({ title, rows, meta, id }: { title: string; rows: StatsRow[]; meta: (row: StatsRow) => string; id: string }): JSX.Element | null {
  if (rows.length === 0) return null;
  return (
    <Section id={id} title={title}>
      <SongRows rows={rows.slice(0, SIDE_SHOWN)} meta={meta} />
    </Section>
  );
}

function SongStories({ stats, range }: { stats: StatsOverview; range: RangeKey }): JSX.Element {
  const { t, locale } = useTranslation();
  const plays = (row: StatsRow) => t("ui.stats.plays", { count: row.plays });
  return (
    <div className={styles.lists}>
      <SideList id="on-repeat" title={t("ui.stats.on_repeat")} rows={stats.onRepeat} meta={plays} />
      {range !== "all" ? (
        <SideList
          id="discoveries"
          title={t("ui.stats.discoveries", { count: stats.newTracks })}
          rows={stats.discoveries}
          meta={(row) => (row.firstPlayedAt ? formatInstant(row.firstPlayedAt, locale) : "")}
        />
      ) : null}
      <SideList
        id="replayed"
        title={t("ui.stats.most_replayed")}
        rows={stats.mostReplayed}
        meta={(row) => t("ui.stats.replays", { count: row.replays ?? 0 })}
      />
      <SideList id="skipped" title={t("ui.stats.most_skipped")} rows={stats.mostSkipped} meta={(row) => t("ui.stats.skips", { count: row.skips ?? 0 })} />
      <SideList
        id="forgotten"
        title={t("ui.stats.forgotten")}
        rows={stats.forgotten}
        meta={(row) => (row.lastPlayedAt ? new Date(row.lastPlayedAt).toLocaleDateString(locale, { month: "short", year: "numeric" }) : plays(row))}
      />
    </div>
  );
}

/** While the history is young: what the page will add, so nothing looks missing. */
function Growing({ stats }: { stats: StatsOverview }): JSX.Element {
  const { t } = useTranslation();
  const days = stats.calendar.filter((day) => day.plays > 0).length;
  return (
    <div className={styles.growing} data-testid="stats-growing">
      <h2 className={styles.sectionTitle}>{t("ui.stats.growing")}</h2>
      <p className={styles.growingLine}>{t("ui.stats.growing_days", { count: days, total: MIN_CALENDAR_DAYS })}</p>
    </div>
  );
}

function Pages({ stats, range }: { stats: StatsOverview; range: RangeKey }): JSX.Element {
  const state = fullness(stats);
  const showCalendar = state === "full";
  return (
    <>
      <Enter index={1} screen="stats">
        <Lead stats={stats} range={range} />
        <Figures stats={stats} />
      </Enter>
      <Enter index={2} screen="stats">
        <Rhythm stats={stats} />
        {showCalendar ? <Calendar days={stats.calendar} from={stats.range.from} to={stats.range.to} /> : null}
      </Enter>
      <Enter index={3} screen="stats">
        <When stats={stats} />
        <Top stats={stats} />
      </Enter>
      <Enter index={4} screen="stats">
        <Habits stats={stats} />
        {state === "first" ? <Growing stats={stats} /> : <SongStories stats={stats} range={range} />}
      </Enter>
    </>
  );
}

function CustomRange({
  value,
  today,
  onApply,
}: {
  value: { from: string; to: string };
  today: string;
  onApply: (next: { from: string; to: string }) => void;
}): JSX.Element {
  const { t } = useTranslation();
  const [from, setFrom] = useState(value.from);
  const [to, setTo] = useState(value.to);
  const valid = from !== "" && to !== "" && from <= to;
  return (
    <form
      className={styles.customRange}
      onSubmit={(event) => {
        event.preventDefault();
        if (valid) onApply({ from, to });
      }}
    >
      <label className={styles.dateField}>
        {t("ui.stats.from")}
        <input type="date" value={from} max={to || today} onChange={(event) => setFrom(event.target.value)} />
      </label>
      <label className={styles.dateField}>
        {t("ui.stats.to")}
        <input type="date" value={to} min={from} max={today} onChange={(event) => setTo(event.target.value)} />
      </label>
      <Button variant="primary" type="submit" disabled={!valid}>
        {t("ui.stats.show")}
      </Button>
    </form>
  );
}

function DeleteSheet({ target, stats, onClose }: { target: "range" | "all" | null; stats: StatsOverview | null; onClose: () => void }): JSX.Element {
  const { t, locale } = useTranslation();
  const [pending, setPending] = useState(false);
  const days: StatsDays = target === "range" && stats?.range.from ? { from: stats.range.from, to: stats.range.to } : {};
  const confirm = async () => {
    if (pending) return;
    setPending(true);
    try {
      const events = await deleteStats(days);
      useToastStore.getState().show({ message: t("ui.stats.deleted", { count: events }), variant: "success" });
      onClose();
    } catch {
      useToastStore.getState().show({ message: t("ui.stats.delete_failed"), variant: "error" });
    } finally {
      setPending(false);
    }
  };
  const span = stats?.range.from ? `${formatDay(stats.range.from, locale, true)} – ${formatDay(stats.range.to, locale, true)}` : "";
  return (
    <Sheet
      open={target !== null}
      onClose={onClose}
      title={t(target === "all" ? "ui.stats.delete_all_title" : "ui.stats.delete_range_title")}
      actions={[
        { label: t("common.cancel"), onClick: onClose },
        { label: t("ui.stats.delete_confirm"), primary: true, onClick: () => void confirm(), disabled: pending },
      ]}
    >
      <p className={styles.sheetText}>{target === "all" ? t("ui.stats.delete_all_text") : t("ui.stats.delete_range_text", { span })}</p>
      <p className={styles.sheetText}>{t("ui.stats.delete_recs")}</p>
    </Sheet>
  );
}

/** /stats: how much, when, how and which songs, from the plays stored on this device. */
export function Stats(): JSX.Element {
  const { t, locale } = useTranslation();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [today] = useState(() => isoDate(new Date()));
  const range = parseRange(params.get("range"));
  const customFrom = params.get("from");
  const customTo = params.get("to");
  const custom = useMemo(() => (customFrom && customTo ? { from: customFrom, to: customTo } : null), [customFrom, customTo]);
  const days = useMemo(() => rangeDays(range, today, custom), [range, today, custom]);
  const { data, failed, reload } = useStatsOverview(days);
  const { paused, setPaused } = useStatsPaused();
  const [moreAnchor, setMoreAnchor] = useState<HTMLElement | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [customAnchor, setCustomAnchor] = useState<HTMLElement | null>(null);
  const [customOpen, setCustomOpen] = useState(false);
  const [deleting, setDeleting] = useState<"range" | "all" | null>(null);
  usePageBackdrop(data?.top.tracks[0]?.coverUrl);

  const pick = (key: RangeKey, anchor: HTMLElement) => {
    if (key === "custom") {
      setCustomAnchor(anchor);
      setCustomOpen(true);
      return;
    }
    setParams({ range: key }, { replace: true });
  };

  const save = (format: "json" | "csv") => {
    void exportStats(format, days).then((error) => {
      if (error) useToastStore.getState().show({ message: error, variant: "error" });
    });
  };

  const state = data ? fullness(data) : null;
  const items: MenuItem[] = [
    { label: t("ui.stats.export_json"), disabled: state === "never", onSelect: () => save("json") },
    { label: t("ui.stats.export_csv"), disabled: state === "never", onSelect: () => save("csv") },
    "separator",
    ...(range !== "all"
      ? [{ label: t("ui.stats.delete_range"), disabled: !data || data.totals.listenedMs === 0, onSelect: () => setDeleting("range") } as MenuItem]
      : []),
    { label: t("ui.stats.delete_all"), danger: true, disabled: state === "never", onSelect: () => setDeleting("all") },
  ];
  const customLabel = custom ? `${formatDay(custom.from, locale)} – ${formatDay(custom.to, locale)}` : t("ui.stats.range_custom");

  let content: JSX.Element | null = null;
  if (failed && !data) {
    content = (
      <EmptyState
        title={t("ui.stats.failed_title")}
        message={t("ui.stats.failed_message")}
        actions={[{ label: t("ui.library.retry"), primary: true, onClick: reload }]}
      />
    );
  } else if (state === "never") {
    content = (
      <div data-testid="stats-empty">
        <EmptyState
          title={t("ui.stats.empty_title")}
          message={t("ui.stats.empty_message")}
          actions={[{ label: t("ui.stats.empty_action"), primary: true, onClick: () => navigateWithTransition(navigate, "/library") }]}
        />
      </div>
    );
  } else if (state === "silent") {
    content = (
      <div data-testid="stats-silent">
        <EmptyState
          title={t("ui.stats.silent_title")}
          message={t("ui.stats.silent_message")}
          actions={[{ label: t("ui.stats.silent_action"), primary: true, onClick: () => setParams({ range: "all" }, { replace: true }) }]}
        />
      </div>
    );
  } else if (data) {
    content = <Pages stats={data} range={range} />;
  }

  return (
    <div className={styles.page} data-testid="stats-page">
      <Enter index={0} screen="stats">
        <h1 className={styles.title}>{t("ui.stats.title")}</h1>
        <div className={styles.bar} hidden={state === "never"}>
          <div className={styles.ranges} role="tablist" aria-label={t("ui.stats.range")}>
            {RANGE_KEYS.map((key) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={key === range}
                className={`${look.pill} ${key === range ? look.solid : look.glass}`}
                onClick={(event) => pick(key, event.currentTarget)}
              >
                {key === "custom" ? customLabel : t(`ui.stats.range_${key}`)}
              </button>
            ))}
          </div>
          <div className={styles.barEnd}>
            <button type="button" className={`${look.pill} ${look.glass}`} onClick={() => navigateWithTransition(navigate, "/stats/history")}>
              <Icon name="history" size={16} />
              {t("ui.history.title")}
            </button>
            <button
              type="button"
              className={`${look.pill} ${look.glass} ${look.square}`}
              aria-label={t("ui.stats.more_actions")}
              aria-haspopup="menu"
              aria-expanded={moreOpen}
              onClick={(event) => {
                setMoreAnchor(event.currentTarget);
                setMoreOpen(true);
              }}
            >
              <Icon name="more" size={16} />
            </button>
          </div>
        </div>
        {paused ? (
          <div className={styles.paused} data-testid="stats-paused">
            <span>{t("ui.stats.paused_line")}</span>
            <Button variant="text" onClick={() => setPaused(false)}>
              {t("ui.stats.resume")}
            </Button>
          </div>
        ) : null}
      </Enter>
      {content}
      {data && state !== "never" ? <p className={styles.private}>{t("ui.stats.private")}</p> : null}
      <Menu open={moreOpen} anchor={moreAnchor} onClose={() => setMoreOpen(false)} items={items} />
      <Popover open={customOpen} anchor={customAnchor} onClose={() => setCustomOpen(false)} title={t("ui.stats.range_custom")} width={300}>
        <CustomRange
          value={custom ?? { from: addDays(today, -29), to: today }}
          today={today}
          onApply={(next) => {
            setParams({ range: "custom", from: next.from, to: next.to }, { replace: true });
            setCustomOpen(false);
          }}
        />
      </Popover>
      <DeleteSheet target={deleting} stats={data} onClose={() => setDeleting(null)} />
    </div>
  );
}
