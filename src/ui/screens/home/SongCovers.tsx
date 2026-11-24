import type { CSSProperties, JSX, MouseEvent, ReactNode } from "react";
import { Button } from "../../components/Button";
import { Cover } from "../../components/Cover";
import { coverRadius } from "../../geometry";
import { Icon } from "../../icons/Icon";
import { useTranslation } from "../../ports/i18n";
import type { Track } from "../../ports/recs";
import { firstArtist } from "../../recs/notInterestedItems";
import { ShelfHeading } from "./ShelfHeading";
import shelf from "./SavedShelf.module.css";
import styles from "./SongCovers.module.css";
import type { Shelf } from "./useShelf";
import { useTrackMenu } from "../entity/useTrackMenu";
import { ArtistLinks } from "../../shell/ArtistLinks";

type ShelfState = Pick<Shelf, "round" | "arrived" | "busy" | "refresh">;
const order = (index: number) => ({ "--i": index }) as CSSProperties;
const rowClass = (state: ShelfState, base: string) => (state.arrived ? `${base} ${shelf.arrive}` : base);

interface SongCardProps {
  track: Track;
  size: number;
  index: number;
  onPlay(): void;
  onContextMenu(event: MouseEvent<HTMLElement>): void;
}

function SongCard({ track, size, index, onPlay, onContextMenu }: SongCardProps): JSX.Element {
  return (
    <div className={shelf.card} style={{ ...order(index), width: size }} data-song={track.id} onContextMenu={onContextMenu}>
      <button type="button" className={`${styles.card} ${styles.play}`} onClick={onPlay}>
        <Cover src={track.coverUrl} size={size} />
        <span className={shelf.name}>{track.title}</span>
      </button>
      <span className={shelf.subtitle}>
        <ArtistLinks track={track} />
      </span>
    </div>
  );
}

const WAITING_CARDS = 8;

export function ShelfPlaceholder({ name, title, size }: { name: string; title: string; size: number }): JSX.Element {
  return (
    <section className={shelf.shelf} aria-label={title} aria-busy="true" data-shelf-waiting={name}>
      <ShelfHeading title={title} />
      <div className={shelf.row} aria-hidden="true">
        <div className={styles.covers}>
          {Array.from({ length: WAITING_CARDS }, (_, index) => (
            <span key={index} className={styles.waiting} style={{ width: size }}>
              <span className={styles.blank} style={{ height: size, borderRadius: coverRadius(size) }} />
              <span className={shelf.name}>&nbsp;</span>
              <span className={shelf.subtitle}>&nbsp;</span>
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

export interface CoverShelfProps {
  name: string;
  title: string;
  shelf: ShelfState;
  songs: Track[];
  size: number;
  lead?: ReactNode;
  onPlay(index: number): void;
}

export function CoverShelf({ name, title, shelf: state, songs, size, lead, onPlay }: CoverShelfProps): JSX.Element {
  const menu = useTrackMenu();
  return (
    <section className={shelf.shelf} aria-label={title} data-shelf={name}>
      <ShelfHeading title={title} busy={state.busy} onRefresh={state.refresh} />
      <div className={shelf.row}>
        {lead}
        <div key={state.round} className={rowClass(state, styles.covers)}>
          {songs.map((track, index) => (
            <SongCard key={track.id} track={track} size={size} index={index} onPlay={() => onPlay(index)} onContextMenu={menu.onContextMenu(track)} />
          ))}
        </div>
      </div>
      {menu.element}
    </section>
  );
}

export function ArtistLead({ name, cover, size, onPlay }: { name: string; cover: string; size: number; onPlay(): void }): JSX.Element {
  const { t } = useTranslation();
  return (
    <button type="button" className={`${shelf.card} ${styles.card} ${styles.lead}`} style={{ width: size }} data-lead onClick={onPlay}>
      <Cover src={cover} size={size} shape="circle" />
      <span className={shelf.name}>{name}</span>
      <span className={shelf.subtitle}>{t("ui.home.more_like_line")}</span>
    </button>
  );
}

const STACK = 4;
const STACK_SIZE = 148;

export function ShuffleCard({
  title,
  shelf: state,
  songs,
  onPlay,
}: {
  title: string;
  shelf: ShelfState;
  songs: Track[];
  onPlay(index: number): void;
}): JSX.Element {
  const { t } = useTranslation();
  const menu = useTrackMenu();
  const names = [...new Set(songs.map((track) => firstArtist(track)).filter(Boolean))].slice(0, 3).join(", ");
  return (
    <section className={shelf.shelf} aria-label={title} data-shelf="shuffle">
      <ShelfHeading title={title} busy={state.busy} onRefresh={state.refresh} />
      <div className={styles.shuffle}>
        <div key={state.round} className={rowClass(state, styles.stack)} style={{ width: STACK_SIZE + (STACK - 1) * 36, height: STACK_SIZE }}>
          {songs.slice(0, STACK).map((track, index) => (
            <button
              key={track.id}
              type="button"
              className={styles.stacked}
              style={{ ...order(index), zIndex: STACK - index, left: index * 36 }}
              data-song={track.id}
              aria-label={`${track.title}, ${track.artists}`}
              onClick={() => onPlay(index)}
              onContextMenu={menu.onContextMenu(track)}
            >
              <Cover src={track.coverUrl} size={STACK_SIZE - index * 12} />
            </button>
          ))}
        </div>
        <div className={styles.about}>
          <span className={styles.from}>{t("ui.home.shuffle_from")}</span>
          <span className={styles.names}>{t("ui.home.shuffle_names", { names })}</span>
          <Button variant="primary" className={styles.play} onClick={() => onPlay(0)}>
            <Icon name="play" size={16} />
            {t("ui.entity.play")}
          </Button>
        </div>
      </div>
      {menu.element}
    </section>
  );
}
