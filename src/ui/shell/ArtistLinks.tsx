import { Fragment, useEffect, useRef, type JSX } from "react";
import { artistsOf, catalogId } from "../app/hrefs";
import { warmArtist } from "../ports/catalog";
import type { Track } from "../ports/player";
import styles from "./ArtistLinks.module.css";
import { openArtist } from "./openArtist";

const DWELL_MS = 120;

export interface ArtistLinksProps {
  track: Pick<Track, "artists" | "artistId" | "artistList">;
  focusable?: boolean;
}

export function ArtistLinks({ track, focusable = false }: ArtistLinksProps): JSX.Element {
  const dwell = useRef(0);
  useEffect(() => () => window.clearTimeout(dwell.current), []);

  return (
    <>
      {artistsOf(track).map((artist, index) => (
        <Fragment key={`${index}:${artist.name}`}>
          {index > 0 ? ", " : null}
          <span
            role="link"
            tabIndex={focusable ? 0 : -1}
            className={styles.link}
            data-artist-link=""
            data-no-window-drag
            onPointerEnter={() => {
              const id = catalogId(artist);
              if (id) dwell.current = window.setTimeout(() => warmArtist(id), DWELL_MS);
            }}
            onPointerLeave={() => window.clearTimeout(dwell.current)}
            onDoubleClick={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              openArtist(artist);
            }}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.stopPropagation();
              openArtist(artist);
            }}
          >
            {artist.name}
          </span>
        </Fragment>
      ))}
    </>
  );
}
