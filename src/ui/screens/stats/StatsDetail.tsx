import { useMemo, useState, type JSX } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Cover } from "../../components/Cover";
import { EmptyState } from "../../components/EmptyState";
import { Enter } from "../../components/Enter";
import { Icon } from "../../icons/Icon";
import { usePageBackdrop } from "../../ports/backdrop";
import { useTranslation } from "../../ports/i18n";
import { playerEngine } from "../../ports/player";
import { rowTrack, useStatsDetail, type StatsDetail as Detail, type StatsRow } from "../../ports/stats";
import { navigateWithTransition } from "../../shell/navigate";
import { EntityHead } from "../entity/EntityHead";
import { EntityLoading } from "../entity/EntityPage";
import look from "../look.module.css";
import { BarChart, Curve, Section, ShareRows, type BarItem, type CurvePoint, type ShareItem } from "./charts";
import { SongRows, useSongMenu } from "./StatsRows";
import { filled, formatInstant, formatTime, MIN_CHART_BUCKETS, weekdays } from "./statsModel";
import styles from "./Stats.module.css";

const HOUR_MARKS = [0, 6, 12, 18];

function monthPoints(detail: Detail, locale: string): CurvePoint[] {
  const first = detail.byMonth[0]?.month;
  const last = detail.byMonth.at(-1)?.month;
  if (!first || !last) return [];
  const byMonth = new Map(detail.byMonth.map((item) => [item.month, item]));
  const points: CurvePoint[] = [];
  const date = new Date(Number(first.slice(0, 4)), Number(first.slice(5, 7)) - 1, 1, 12);
  for (;;) {
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    if (key > last) return points;
    points.push({
      key,
      label: date.toLocaleDateString(locale, { month: "short", year: "2-digit" }),
      title: date.toLocaleDateString(locale, { month: "long", year: "numeric" }),
      value: byMonth.get(key)?.plays ?? 0,
    });
    date.setMonth(date.getMonth() + 1);
  }
}

function Numbers({ detail }: { detail: Detail }): JSX.Element {
  const { t, locale } = useTranslation();
  const facts: [string, string][] = [
    [detail.plays.toLocaleString(locale), t("ui.stats.label_plays")],
    [formatTime(detail.listenedMs, t), t("ui.stats.label_time")],
    [detail.activeDays.toLocaleString(locale), t("ui.stats.label_active_days")],
    [detail.skips.toLocaleString(locale), t("ui.stats.label_skips")],
  ];
  return (
    <>
      <div className={styles.figures} data-compact="">
        {facts.map(([value, label]) => (
          <div key={label} className={styles.figure}>
            <span className={styles.figureValue}>{value}</span>
            <span className={styles.figureLabel}>{label}</span>
          </div>
        ))}
      </div>
      {detail.firstPlayedAt && detail.lastPlayedAt ? (
        <p className={styles.detailDates}>
          {t("ui.stats.first_last", { first: formatInstant(detail.firstPlayedAt, locale), last: formatInstant(detail.lastPlayedAt, locale) })}
        </p>
      ) : null}
    </>
  );
}

function Charts({ detail }: { detail: Detail }): JSX.Element {
  const { t, locale } = useTranslation();
  const [month, setMonth] = useState<CurvePoint | null>(null);
  const [weekday, setWeekday] = useState<BarItem | null>(null);
  const [hour, setHour] = useState<BarItem | null>(null);
  const points = useMemo(() => monthPoints(detail, locale), [detail, locale]);
  const week: BarItem[] = weekdays(locale).map(([index, name]) => ({ key: String(index), label: name, title: name, value: detail.byWeekday[index] }));
  const hours: BarItem[] = detail.byHour.map((value, index) => ({
    key: String(index),
    label: String(index),
    title: `${String(index).padStart(2, "0")}:00`,
    value,
  }));
  const total = detail.sources.reduce((sum, share) => sum + share.listenedMs, 0);
  const sources: ShareItem[] = detail.sources.map((share) => ({
    key: share.kind,
    label: t(`ui.stats.source.${share.kind}`),
    share: share.listenedMs / Math.max(1, total),
    note: formatTime(share.listenedMs, t),
  }));
  const peakMonth = points.reduce<CurvePoint | null>((best, point) => (!best || point.value > best.value ? point : best), null);
  const shownMonth = month ?? peakMonth;
  return (
    <>
      {points.length >= 2 ? (
        <Section
          id="months"
          title={t("ui.stats.by_month")}
          aside={shownMonth ? `${shownMonth.title}: ${t("ui.stats.plays", { count: shownMonth.value })}` : undefined}
        >
          <Curve points={points} label={t("ui.stats.by_month")} onHover={setMonth} />
        </Section>
      ) : null}
      <div className={styles.when}>
        {filled(detail.byHour) >= MIN_CHART_BUCKETS ? (
          <Section id="detail-hours" title={t("ui.stats.by_hour")} aside={hour ? `${hour.title}: ${formatTime(hour.value, t)}` : undefined}>
            <BarChart items={hours} label={t("ui.stats.by_hour")} marks={HOUR_MARKS} onHover={setHour} />
          </Section>
        ) : null}
        {filled(detail.byWeekday) >= MIN_CHART_BUCKETS ? (
          <Section id="detail-weekdays" title={t("ui.stats.by_weekday")} aside={weekday ? `${weekday.title}: ${formatTime(weekday.value, t)}` : undefined}>
            <BarChart items={week} label={t("ui.stats.by_weekday")} onHover={setWeekday} />
          </Section>
        ) : null}
      </div>
      {sources.length > 1 ? (
        <Section id="detail-sources" title={t("ui.stats.started_from")}>
          <div className={styles.narrow}>
            <ShareRows items={sources} />
          </div>
        </Section>
      ) : null}
    </>
  );
}

function Failed(): JSX.Element {
  const { t } = useTranslation();
  const navigate = useNavigate();
  return (
    <EmptyState
      title={t("ui.stats.detail_none")}
      actions={[{ label: t("ui.stats.title"), primary: true, onClick: () => navigateWithTransition(navigate, "/stats") }]}
    />
  );
}

export function StatsTrack(): JSX.Element {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const id = params.get("id") ?? "";
  const { data, failed } = useStatsDetail("tracks", id);
  const track = useMemo(() => (data ? rowTrack(data.track) : null), [data]);
  const menu = useSongMenu();
  usePageBackdrop(data?.coverUrl);
  if (failed) return <Failed />;
  if (!data || !track) return <EntityLoading kind="album" />;
  return (
    <div className={styles.page} data-detail="" data-testid="stats-track">
      <Enter index={0} screen="stats-detail">
        <EntityHead
          cover={<Cover src={data.coverUrl ?? ""} size={168} radius={10} />}
          title={data.title}
          subtitle={data.subtitle ?? undefined}
          actions={
            <>
              <button
                type="button"
                className={`${look.pill} ${look.solid} ${look.wide}`}
                onClick={() => void playerEngine.playTrack(track, [track], "stats", "")}
              >
                <Icon name="play" size={16} />
                {t("ui.stats.play")}
              </button>
              <button
                type="button"
                className={`${look.pill} ${look.glass} ${look.square}`}
                aria-label={t("ui.entity.more")}
                aria-haspopup="menu"
                onClick={(event) => menu.open(track, event.currentTarget)}
              >
                <Icon name="more" size={16} />
              </button>
            </>
          }
        />
      </Enter>
      <Enter index={1} screen="stats-detail">
        <Numbers detail={data} />
        <Charts detail={data} />
      </Enter>
      {menu.layers}
    </div>
  );
}

export function StatsArtist(): JSX.Element {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const key = params.get("key") ?? "";
  const { data, failed } = useStatsDetail("artists", key);
  usePageBackdrop(data?.coverUrl);
  if (failed) return <Failed />;
  if (!data) return <EntityLoading kind="artist" />;
  const tracks = data.topTracks.flatMap((row) => {
    const track = rowTrack(row.track);
    return track ? [track] : [];
  });
  const meta = (row: StatsRow) => `${t("ui.stats.plays", { count: row.plays })} · ${formatTime(row.listenedMs, t)}`;
  return (
    <div className={styles.page} data-detail="" data-testid="stats-artist">
      <Enter index={0} screen="stats-detail">
        <EntityHead
          shape="circle"
          cover={<Cover src={data.coverUrl ?? ""} size={144} shape="circle" />}
          title={data.title}
          onPlay={tracks.length > 0 ? () => void playerEngine.playTrack(tracks[0], tracks, "stats", "") : undefined}
          menu={
            data.openId
              ? [{ label: t("ui.stats.open_artist"), onSelect: () => navigateWithTransition(navigate, `/artist?id=${encodeURIComponent(data.openId ?? "")}`) }]
              : []
          }
        />
      </Enter>
      <Enter index={1} screen="stats-detail">
        <Numbers detail={data} />
        <Section id="artist-top" title={t("ui.stats.top_tracks")}>
          <SongRows rows={data.topTracks} meta={meta} ranked />
        </Section>
        <Charts detail={data} />
      </Enter>
    </div>
  );
}
