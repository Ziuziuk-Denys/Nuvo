import type { JSX, ReactNode } from "react";
import { Cover } from "../../components/Cover";
import type { ArtistAlbumViewModel } from "../../ports/catalog";
import look from "../look.module.css";
import styles from "./Artist.module.css";

export function Shelf({ title, children }: { title: string; children: ReactNode }): JSX.Element {
  return (
    <section className={styles.section}>
      <h2 className={`${look.sectionTitle} ${styles.shelfTitle}`}>{title}</h2>
      <div className={styles.shelf}>{children}</div>
    </section>
  );
}

export function ReleaseCard({ release, onOpen }: { release: ArtistAlbumViewModel; onOpen: (id: string) => void }): JSX.Element {
  return (
    <button type="button" className={styles.card} onClick={() => onOpen(release.id)}>
      <span className={styles.art}>
        <Cover src={release.coverUrl} size={180} radius={10} />
      </span>
      <span className={styles.cardText}>
        <span className={styles.cardTitle}>{release.title}</span>
        {release.releaseDate ? <span className={styles.cardSubtitle}>{release.releaseDate}</span> : null}
      </span>
    </button>
  );
}
