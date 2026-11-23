import type { CSSProperties, JSX } from "react";
import { Cover } from "../../components/Cover";
import { Row } from "../../components/Row";
import type { IconName } from "../../icons";
import type { Track } from "../../ports/recs";
import { useTrackMenu } from "../entity/useTrackMenu";
import { ShelfHeading } from "./ShelfHeading";
import type { Shelf } from "./useShelf";
import { ArtistLinks } from "../../shell/ArtistLinks";
import shelf from "./SavedShelf.module.css";
import styles from "./SongsShelf.module.css";

export interface SongsShelfProps {
  /** Names the shelf for tests and the e2e: songs, shuffle, like, style. */
  name: string;
  title: string;
  icon: IconName;
  shelf: Pick<Shelf, "round" | "arrived" | "busy" | "refresh">;
  songs: Track[];
  onPlay(index: number): void;
}

export function SongsShelf({ name, title, icon, shelf: state, songs, onPlay }: SongsShelfProps): JSX.Element {
  const menu = useTrackMenu();
  return (
    <section className={shelf.shelf} aria-label={title} data-shelf={name}>
      <ShelfHeading icon={icon} title={title} busy={state.busy} onRefresh={state.refresh} />
      <div key={state.round} className={state.arrived ? `${styles.grid} ${shelf.arrive}` : styles.grid}>
        {songs.map((track, index) => (
          <Row
            key={track.id}
            style={{ "--i": index } as CSSProperties}
            data-song={track.id}
            leading={<Cover src={track.coverUrl} size={40} radius={6} />}
            title={track.title}
            subtitle={<ArtistLinks track={track} />}
            onActivate={() => onPlay(index)}
            onContextMenu={menu.onContextMenu(track)}
          />
        ))}
      </div>
      {menu.element}
    </section>
  );
}
