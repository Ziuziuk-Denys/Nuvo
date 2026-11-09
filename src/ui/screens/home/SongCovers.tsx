import type { CSSProperties, JSX, ReactNode } from "react";
import { Button } from "../../components/Button";
import { Cover } from "../../components/Cover";
import { Icon } from "../../icons/Icon";
import type { IconName } from "../../icons";
import { useTranslation } from "../../ports/i18n";
import type { Track } from "../../ports/recs";
import { firstArtist } from "../../recs/notInterestedItems";
import { ShelfHeading } from "./ShelfHeading";
import shelf from "./SavedShelf.module.css";
import styles from "./SongCovers.module.css";
import type { Shelf } from "./useShelf";

type ShelfState = Pick<Shelf, "round" | "arrived" | "busy" | "refresh">;
const order = (index: number) => ({ "--i": index }) as CSSProperties;
const rowClass = (state: ShelfState, base: string) => (state.arrived ? `${base} ${shelf.arrive}` : base);

function SongCard({ track, size, index, onPlay }: { track: Track; size: number; index: number; onPlay(): void }): JSX.Element {
  return (
    <button type="button" className={`${shelf.card} ${styles.card}`} style={{ ...order(index), width: size }} data-song={track.id} onClick={onPlay}>
      <Cover src={track.coverUrl} size={size} />
      <span className={shelf.name}>{track.title}</span>
      <span className={shelf.subtitle}>{track.artists}</span>
    </button>
  );
}

export interface CoverShelfProps {
  name: string;
  title: string;
  icon: IconName;
  shelf: ShelfState;
  songs: Track[];
  size: number;
  lead?: ReactNode;
  onPlay(index: number): void;
}

export function CoverShelf({ name, title, icon, shelf: state, songs, size, lead, onPlay }: CoverShelfProps): JSX.Element {
  return (
    <section className={shelf.shelf} aria-label={title} data-shelf={name}>
      <ShelfHeading icon={icon} title={title} busy={state.busy} onRefresh={state.refresh} />
      <div className={shelf.row}>
        {lead}
        <div key={state.round} className={rowClass(state, styles.covers)}>
          {songs.map((track, index) => (
            <SongCard key={track.id} track={track} size={size} index={index} onPlay={() => onPlay(index)} />
          ))}
        </div>
      </div>
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
  const names = [...new Set(songs.map((track) => firstArtist(track)).filter(Boolean))].slice(0, 3).join(", ");
  return (
    <section className={shelf.shelf} aria-label={title} data-shelf="shuffle">
      <ShelfHeading icon="shuffle" title={title} busy={state.busy} onRefresh={state.refresh} />
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
    </section>
  );
}
