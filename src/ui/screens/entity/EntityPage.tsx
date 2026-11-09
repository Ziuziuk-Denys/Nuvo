import type { JSX, ReactNode } from "react";
import { Enter } from "../../components/Enter";
import { MediaRowPlaceholder } from "../MediaRow";
import styles from "./EntityPage.module.css";

const PLACEHOLDER_ROWS = 8;

export interface EntityPageProps {
  head: ReactNode;
  tracks: ReactNode;
  empty?: ReactNode;
  kind: "playlist" | "album" | "artist";
}

export function EntityPage({ head, tracks, empty, kind }: EntityPageProps): JSX.Element {
  return (
    <div className={styles.page} data-entity={kind}>
      <Enter index={0} screen={`entity-${kind}`}>
        {head}
      </Enter>
      <Enter index={1} screen={`entity-${kind}`}>
        <div className={styles.tracks}>{empty ?? tracks}</div>
      </Enter>
    </div>
  );
}

export function EntityLoading({ kind }: { kind: EntityPageProps["kind"] }): JSX.Element {
  return (
    <EntityPage
      kind={kind}
      head={
        <div className={styles.placeholderHead} aria-hidden="true">
          <span className={styles.placeholderCover} data-shape={kind === "artist" ? "circle" : undefined} />
        </div>
      }
      tracks={Array.from({ length: PLACEHOLDER_ROWS }, (_, index) => (
        <MediaRowPlaceholder key={index} />
      ))}
    />
  );
}
