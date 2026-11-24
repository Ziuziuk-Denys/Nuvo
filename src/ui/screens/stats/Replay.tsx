import { useEffect, useMemo, useState, type JSX } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "../../components/Button";
import { EmptyState } from "../../components/EmptyState";
import { Lens } from "../../components/Lens";
import { useToastStore } from "../../feedback/toastStore";
import { Icon } from "../../icons/Icon";
import { usePageBackdrop } from "../../ports/backdrop";
import { useTranslation } from "../../ports/i18n";
import { useAddPlaylistTracks, useCreatePlaylist } from "../../ports/library";
import { rowTrack, useStatsOverview, useStatsPaused } from "../../ports/stats";
import { playlistHref } from "../../app/hrefs";
import { navigateWithTransition } from "../../shell/navigate";
import { useShellScroller } from "../../shell/scroller";
import look from "../look.module.css";
import { parsePeriod, pastPeriods, periodName, REPLAY_KINDS, type ReplayKind, type ReplayPeriod } from "./replayModel";
import { ArtistsScreen, DaysScreen, EndsScreen, HoursScreen, Screen, SongScreen, SongsScreen, TimeScreen, type ScreenProps } from "./ReplayScreens";
import { ReplayShare } from "./ReplayShare";
import { filled, fullness, isoDate, MIN_CHART_BUCKETS } from "./statsModel";
import styles from "./Replay.module.css";

const MIN_SONGS = 4;
const MIN_ARTISTS = 3;
const MIN_DAYS = 3;
const PLAYLIST_SONGS = 50;

function numbersHref(period: ReplayPeriod, today: string): string {
  if (period.kind === "all") return "/stats/all?range=all";
  return `/stats/all?range=custom&from=${period.from}&to=${period.to < today ? period.to : today}`;
}

function Screens({
  stats,
  period,
  name,
  today,
  onLit,
  onShare,
}: ScreenProps & { onLit: (cover: string | undefined) => void; onShare: () => void }): JSX.Element {
  const { t, locale } = useTranslation();
  const navigate = useNavigate();
  const create = useCreatePlaylist();
  const add = useAddPlaylistTracks();
  const [saving, setSaving] = useState(false);
  const spoken = periodName(period, today, locale, true);
  const props = { stats, period, name: spoken, today };
  const top = stats.top.tracks;
  const artists = stats.top.artists;

  const savePlaylist = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const title = period.kind === "all" ? t("ui.replay.playlist_all") : t("ui.replay.playlist", { name });
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
      <Screen id="time" cover={top[0]?.coverUrl} onLit={onLit}>
        <TimeScreen {...props} />
      </Screen>
      {top.length > 0 ? (
        <Screen id="song" cover={top[0].coverUrl} onLit={onLit}>
          <SongScreen {...props} />
        </Screen>
      ) : null}
      {top.length >= MIN_SONGS ? (
        <Screen id="songs" cover={top[1].coverUrl} onLit={onLit}>
          <SongsScreen {...props} onLit={onLit} />
        </Screen>
      ) : null}
      {artists.length >= MIN_ARTISTS && stats.days.length >= MIN_DAYS ? (
        <Screen id="artists" cover={artists[0].coverUrl} onLit={onLit}>
          <ArtistsScreen {...props} />
        </Screen>
      ) : null}
      {filled(stats.byHour) >= MIN_CHART_BUCKETS ? (
        <Screen id="hours" onLit={onLit} cover={top[0]?.coverUrl}>
          <HoursScreen {...props} />
        </Screen>
      ) : null}
      {stats.totals.activeDays >= MIN_DAYS ? (
        <Screen id="days" onLit={onLit} cover={top[0]?.coverUrl}>
          <DaysScreen {...props} />
        </Screen>
      ) : null}
      {stats.totals.plays > MIN_SONGS ? (
        <Screen id="ends" cover={stats.firstSong?.coverUrl} onLit={onLit}>
          <EndsScreen {...props} />
        </Screen>
      ) : null}
      <Screen id="close" cover={top[0]?.coverUrl} onLit={onLit}>
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

export function Replay(): JSX.Element {
  const { t, locale } = useTranslation();
  const navigate = useNavigate();
  const scroller = useShellScroller();
  const [params, setParams] = useSearchParams();
  const [today] = useState(() => isoDate(new Date()));
  const period = useMemo(() => parsePeriod(params.get("kind"), params.get("at"), today, locale), [params, today, locale]);
  const days = useMemo(() => (period.kind === "all" ? {} : { from: period.from, to: period.to < today ? period.to : today }), [period, today]);
  const { data, failed, reload } = useStatsOverview(days);
  const { paused, setPaused } = useStatsPaused();
  const [lit, setLit] = useState<string | undefined>();
  const [sharing, setSharing] = useState(false);
  usePageBackdrop(lit ?? data?.top.tracks[0]?.coverUrl);

  useEffect(() => {
    const box = scroller.current;
    if (!box) return;
    box.style.setProperty("scroll-snap-type", "y proximity");
    return () => {
      box.style.removeProperty("scroll-snap-type");
    };
  }, [scroller]);

  const firstDay = data?.firstPlayedAt ? isoDate(new Date(data.firstPlayedAt)) : null;
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
          actions={[{ label: t("ui.stats.silent_action"), primary: true, onClick: () => open("all") }]}
        />
      </div>
    );
  } else if (data) {
    content = (
      <Screens key={`${period.kind}${period.from}`} stats={data} period={period} name={name} today={today} onLit={setLit} onShare={() => setSharing(true)} />
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
