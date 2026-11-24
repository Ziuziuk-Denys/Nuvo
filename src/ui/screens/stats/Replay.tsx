import { useEffect, useMemo, useState, type JSX } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "../../components/Button";
import { EmptyState } from "../../components/EmptyState";
import { Lens } from "../../components/Lens";
import { useToastStore } from "../../feedback/toastStore";
import { Icon } from "../../icons/Icon";
import { reducedEffectsNow } from "../../effects";
import { usePageBackdrop } from "../../ports/backdrop";
import { useTranslation } from "../../ports/i18n";
import { useAddPlaylistTracks, useCreatePlaylist } from "../../ports/library";
import { rowTrack, useStatsOverview, useStatsPaused, type StatsOverview } from "../../ports/stats";
import { playlistHref } from "../../app/hrefs";
import { navigateWithTransition } from "../../shell/navigate";
import { useShellScroller } from "../../shell/scroller";
import look from "../look.module.css";
import {
  askedDays,
  comparable,
  compareTime,
  parsePeriod,
  pastPeriods,
  periodName,
  previousSpan,
  REPLAY_KINDS,
  type ReplayKind,
  type ReplayPeriod,
} from "./replayModel";
import { ArtistsScreen, DaysScreen, Dial, EndsScreen, HoursScreen, Screen, SongScreen, SongsScreen, TimeScreen, type ScreenProps } from "./ReplayScreens";
import { ReplayShare } from "./ReplayShare";
import { filled, formatTime, fullness, isoDate, MIN_CHART_BUCKETS } from "./statsModel";
import styles from "./Replay.module.css";

const MIN_SONGS = 4;
const MIN_ARTISTS = 3;
const MIN_DAYS = 3;
const PLAYLIST_SONGS = 50;

function numbersHref(period: ReplayPeriod, today: string): string {
  const { from, to } = askedDays(period, today);
  return from && to ? `/stats/all?range=custom&from=${from}&to=${to}` : "/stats/all?range=all";
}

function useAgainst(period: ReplayPeriod, today: string, stats: StatsOverview | null, firstDay: string | null): string | null {
  const { t, locale } = useTranslation();
  const span = useMemo(() => previousSpan(period, today, locale), [period, today, locale]);
  const { data } = useStatsOverview(useMemo(() => span ?? {}, [span]));
  if (!stats || !data || !span || data.range.from !== span.from || !comparable(period.kind, span.from, firstDay, data.totals.activeDays)) return null;
  const result = compareTime(stats.totals.listenedMs, data.totals.listenedMs);
  if (!result) return null;
  const year = span.from.slice(0, 4);
  const before =
    period.kind === "month"
      ? t(`ui.replay.in_month.${Number(span.from.slice(5, 7))}`)
      : period.kind === "year"
        ? t("ui.replay.in_year", { year })
        : t("ui.replay.in_week");
  const prev = period.to > today ? t("ui.replay.by_day", { prev: before }) : before;
  if (result.kind === "same") return t("ui.replay.against_same", { prev });
  if ("ms" in result) return t(`ui.replay.against_${result.kind}`, { prev, time: formatTime(result.ms, t) });
  const { kind, times } = result;
  return t(`ui.replay.against_${kind}${times === 2 ? "_twice" : ""}`, { prev, count: times });
}

function Screens({
  stats,
  period,
  today,
  against,
  onLit,
  onShare,
}: Omit<ScreenProps, "name"> & { onLit: (cover: string | undefined) => void; onShare: () => void }): JSX.Element {
  const { t, locale } = useTranslation();
  const navigate = useNavigate();
  const create = useCreatePlaylist();
  const add = useAddPlaylistTracks();
  const [saving, setSaving] = useState(false);
  const spoken = periodName(period, today, locale, true);
  const props = { stats, period, name: spoken, today, against };
  const top = stats.top.tracks;
  const artists = stats.top.artists;

  const savePlaylist = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const title = period.kind === "all" ? t("ui.replay.playlist_all") : t("ui.replay.playlist", { name: periodName(period, today, locale) });
      const { id } = await create.mutateAsync({ title });
      for (const row of top.slice(0, PLAYLIST_SONGS)) {
        const track = rowTrack(row.track);
        if (track) await add.mutateAsync({ playlistId: id, track });
      }
      useToastStore.getState().show({
        message: t("ui.replay.playlist_saved", { title }),
        variant: "success",
        action: { label: t("ui.replay.playlist_open"), onClick: () => navigateWithTransition(navigate, playlistHref(id)) },
      });
    } catch {
      useToastStore.getState().show({ message: t("ui.replay.playlist_failed"), variant: "error" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Screen id="time" label={t("ui.stats.label_time")} cover={top[0]?.coverUrl} onLit={onLit}>
        <TimeScreen {...props} />
      </Screen>
      {top.length > 0 ? (
        <Screen id="song" label={t("ui.stats.most_played")} cover={top[0].coverUrl} onLit={onLit}>
          <SongScreen {...props} />
        </Screen>
      ) : null}
      {top.length >= MIN_SONGS ? (
        <Screen id="songs" label={t("ui.replay.songs")} cover={top[1].coverUrl} onLit={onLit}>
          <SongsScreen {...props} onLit={onLit} />
        </Screen>
      ) : null}
      {artists.length >= MIN_ARTISTS && stats.days.length >= MIN_DAYS ? (
        <Screen id="artists" label={t("ui.stats.top_artists")} cover={artists[0].coverUrl} onLit={onLit}>
          <ArtistsScreen {...props} />
        </Screen>
      ) : null}
      {filled(stats.byHour) >= MIN_CHART_BUCKETS ? (
        <Screen id="hours" label={t("ui.stats.by_hour")} onLit={onLit} cover={top[0]?.coverUrl}>
          <HoursScreen {...props} />
        </Screen>
      ) : null}
      {stats.totals.activeDays >= MIN_DAYS ? (
        <Screen id="days" label={t("ui.stats.calendar")} onLit={onLit} cover={top[0]?.coverUrl}>
          <DaysScreen {...props} />
        </Screen>
      ) : null}
      {stats.totals.plays > MIN_SONGS ? (
        <Screen id="ends" label={t("ui.replay.ends_label")} cover={stats.firstSong?.coverUrl} onLit={onLit}>
          <EndsScreen {...props} />
        </Screen>
      ) : null}
      <Screen id="close" label={t("ui.replay.share")} cover={top[0]?.coverUrl} onLit={onLit}>
        <div className={styles.close}>
          <h2 className={styles.closing}>
            {t(period.kind === "all" ? "ui.replay.close_all" : period.kind === "week" ? "ui.replay.close_week" : "ui.replay.close", { name: spoken })}
          </h2>
          <div className={styles.actions}>
            <button type="button" className={`${look.pill} ${look.solid} ${look.wide}`} onClick={onShare}>
              <Icon name="image" size={16} />
              {t("ui.replay.share")}
            </button>
            {top.length >= MIN_SONGS ? (
              <button type="button" className={`${look.pill} ${look.glass}`} disabled={saving} onClick={() => void savePlaylist()}>
                <Icon name="add" size={16} />
                {t("ui.replay.save_playlist")}
              </button>
            ) : null}
            <button type="button" className={`${look.pill} ${look.glass}`} onClick={() => navigateWithTransition(navigate, numbersHref(period, today))}>
              {t("ui.replay.numbers")}
            </button>
            <button type="button" className={`${look.pill} ${look.glass}`} onClick={() => navigateWithTransition(navigate, "/stats/history")}>
              {t("ui.history.title")}
            </button>
          </div>
          <p className={styles.private}>{t("ui.stats.private")}</p>
        </div>
      </Screen>
    </>
  );
}

const QUIET_HOURS = Array.from({ length: 24 }, () => 0);

function Quiet({ id, title, message, action, onAction }: { id: string; title: string; message: string; action: string; onAction: () => void }): JSX.Element {
  return (
    <section className={styles.screen} data-testid={id} data-replay-quiet="">
      <div className={styles.hours}>
        <div className={styles.hoursText}>
          <h2 className={styles.heading}>{title}</h2>
          <p className={styles.note}>{message}</p>
          <div className={styles.actions}>
            <button type="button" className={`${look.pill} ${look.solid} ${look.wide}`} onClick={onAction}>
              {action}
            </button>
          </div>
        </div>
        <div className={styles.dial} aria-hidden="true">
          <Dial byHour={QUIET_HOURS} shown={new Date().getHours()} />
        </div>
      </div>
    </section>
  );
}

export function Replay(): JSX.Element {
  const { t, locale } = useTranslation();
  const navigate = useNavigate();
  const scroller = useShellScroller();
  const [params, setParams] = useSearchParams();
  const [today] = useState(() => isoDate(new Date()));
  const period = useMemo(() => parsePeriod(params.get("kind"), params.get("at"), today, locale), [params, today, locale]);
  const days = useMemo(() => askedDays(period, today), [period, today]);
  const { data, failed, reload } = useStatsOverview(days);
  const { paused, setPaused } = useStatsPaused();
  const [lit, setLit] = useState<string | undefined>();
  const [sharing, setSharing] = useState(false);
  usePageBackdrop(lit ?? data?.top.tracks[0]?.coverUrl);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const step = event.key === "PageDown" ? 1 : event.key === "PageUp" ? -1 : 0;
      if (step === 0 || event.defaultPrevented || document.querySelector("[aria-modal=true]")) return;
      const screens = [...document.querySelectorAll<HTMLElement>("[data-replay-screen]")];
      const middle = window.innerHeight / 2;
      const at = screens.findIndex((screen) => screen.getBoundingClientRect().bottom > middle);
      const next = screens[Math.min(Math.max(at + step, 0), screens.length - 1)];
      if (!next) return;
      event.preventDefault();
      next.focus({ preventScroll: true });
      next.scrollIntoView({ block: "start", behavior: reducedEffectsNow() ? "auto" : "smooth" });
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const firstDay = data?.firstPlayedAt ? isoDate(new Date(data.firstPlayedAt)) : null;
  const against = useAgainst(period, today, data, firstDay);
  const past = useMemo(() => pastPeriods(period.kind, today, firstDay, locale), [period.kind, today, firstDay, locale]);
  const name = periodName(period, today, locale);
  const state = data ? fullness(data) : null;

  const open = (kind: ReplayKind, at?: string) => {
    setLit(undefined);
    scroller.current?.scrollTo({ top: 0 });
    setParams(at ? { kind, at } : { kind }, { replace: true });
  };

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
      <Quiet
        id="stats-empty"
        title={t("ui.replay.empty_title")}
        message={t("ui.stats.empty_message")}
        action={t("ui.stats.empty_action")}
        onAction={() => navigateWithTransition(navigate, "/library")}
      />
    );
  } else if (state === "silent") {
    content = (
      <Quiet
        id="stats-silent"
        title={t("ui.stats.silent_title")}
        message={t("ui.stats.silent_message")}
        action={t("ui.stats.silent_action")}
        onAction={() => open("all")}
      />
    );
  } else if (data) {
    content = (
      <Screens
        key={`${period.kind}${period.from}`}
        stats={data}
        period={period}
        today={today}
        against={against}
        onLit={setLit}
        onShare={() => setSharing(true)}
      />
    );
  }

  return (
    <div className={styles.page} data-testid="replay-page">
      <header className={styles.head}>
        <h1 className={styles.title}>{period.kind === "all" ? t("ui.stats.range_all") : name}</h1>
        {state === "never" ? null : (
          <div className={styles.bar}>
            <div className={`${styles.kinds} ${look.segments}`} role="tablist" aria-label={t("ui.stats.range")}>
              {REPLAY_KINDS.map((kind) => (
                <button
                  key={kind}
                  type="button"
                  role="tab"
                  aria-selected={kind === period.kind}
                  className={`${look.pill} ${kind === period.kind ? look.solid : look.glass}`}
                  onClick={() => open(kind)}
                >
                  {kind === period.kind ? <Lens group="replay-kind" value={kind} radius={16} className={look.solidLens} /> : null}
                  {t(`ui.stats.range_${kind}`)}
                </button>
              ))}
            </div>
            {past.length > 1 ? (
              <nav className={styles.past} aria-label={t("ui.replay.earlier")}>
                {past.map((item) => (
                  <button
                    key={item.from}
                    type="button"
                    aria-current={item.from === period.from ? "true" : undefined}
                    onClick={() => open(item.kind, item.from)}
                  >
                    {periodName(item, today, locale)}
                  </button>
                ))}
              </nav>
            ) : null}
            <div className={styles.barEnd}>
              {data && state !== "silent" ? (
                <button type="button" className={`${look.pill} ${look.glass}`} onClick={() => setSharing(true)}>
                  {t("ui.replay.share")}
                </button>
              ) : null}
              <button type="button" className={`${look.pill} ${look.glass}`} onClick={() => navigateWithTransition(navigate, numbersHref(period, today))}>
                {t("ui.replay.numbers")}
              </button>
            </div>
          </div>
        )}
        {paused ? (
          <div className={styles.paused} data-testid="stats-paused">
            <span>{t("ui.stats.paused_line")}</span>
            <Button variant="text" onClick={() => setPaused(false)}>
              {t("ui.stats.resume")}
            </Button>
          </div>
        ) : null}
      </header>
      {content}
      {sharing && data ? <ReplayShare stats={data} period={period} name={name} onClose={() => setSharing(false)} /> : null}
    </div>
  );
}
