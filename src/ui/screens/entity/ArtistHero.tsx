import { type CSSProperties, type JSX, type ReactNode } from "react";
import { Icon } from "../../icons/Icon";
import { usePageBackdrop } from "../../ports/backdrop";
import { useTranslation } from "../../ports/i18n";
import { useLikedTracks } from "../../ports/library";
import type { Track } from "../../ports/player";
import { useStatsDetail } from "../../ports/stats";
import look from "../look.module.css";
import styles from "./ArtistHero.module.css";
import { heardOf, monthAndYear, nameWidth } from "./artistModel";

export interface ArtistHeroProps {
  name: string;
  banner?: string;
  cover: string;
  actions: ReactNode;
  aside: ReactNode;
}

export function ArtistHero({ name, banner, cover, actions, aside }: ArtistHeroProps): JSX.Element {
  usePageBackdrop(banner || cover || undefined, { scene: "wall", banner, portrait: banner ? undefined : cover || undefined });
  return (
    <header className={styles.hero}>
      <h1 className={`${look.pageTitle} ${styles.name}`} style={{ "--name": nameWidth(name) } as CSSProperties}>
        {name}
      </h1>
      <div className={styles.foot}>
        {actions}
        {aside ? <div className={styles.aside}>{aside}</div> : null}
      </div>
    </header>
  );
}

export interface PersonalLineProps {
  name: string;
  tracks: readonly Track[];
  byArtist: (track: Track) => boolean;
  audience: string | null;
}

export function PersonalLine({ name, tracks, byArtist, audience }: PersonalLineProps): JSX.Element | null {
  const { t, locale } = useTranslation();
  const { data } = useStatsDetail("artists", `name:${name}`);
  const liked = useLikedTracks().data.tracks.filter(byArtist).length;
  if (!data || data.plays === 0) return audience ? <span>{audience}</span> : null;
  const heard = heardOf(tracks, data.trackIds);
  const second = [heard > 0 ? t("ui.artist.heard", { heard, total: tracks.length }) : null, liked > 0 ? t("ui.artist.liked", { count: liked }) : null].filter(
    Boolean,
  );
  return (
    <>
      <span>
        <b>{t("ui.stats.plays", { count: data.plays })}</b>
        {data.firstPlayedAt ? ` ${t("ui.artist.since", { date: monthAndYear(data.firstPlayedAt, locale) })}` : null}
      </span>
      {second.length > 0 ? <span>{second.join(", ")}</span> : null}
    </>
  );
}

export function SlimBar({ name, idle, onPlay, onShuffle }: { name: string; idle: boolean; onPlay(): void; onShuffle(): void }): JSX.Element {
  const { t } = useTranslation();
  return (
    <div className={styles.slim}>
      <div className={styles.strip} data-slim-bar="">
        <span className={styles.slimName} aria-hidden="true">
          {name}
        </span>
        <button type="button" className={`${look.pill} ${look.solid}`} onClick={onPlay} disabled={idle}>
          <Icon name="play" size={14} />
          {t("ui.entity.play")}
        </button>
        <button type="button" className={`${look.pill} ${look.glass} ${look.square}`} aria-label={t("ui.entity.shuffle")} onClick={onShuffle} disabled={idle}>
          <Icon name="shuffle" size={16} />
        </button>
      </div>
    </div>
  );
}
