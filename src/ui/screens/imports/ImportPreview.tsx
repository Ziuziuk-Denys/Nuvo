import { useEffect, useRef, useState, type CSSProperties, type JSX } from "react";
import { Cover } from "../../components/Cover";
import { useScrollActivity } from "../../components/useScrollActivity";
import { Icon } from "../../icons/Icon";
import { useTranslation } from "../../ports/i18n";
import type { CatalogTrack, Listing } from "../../ports/imports";
import type { ImportSource } from "../../ports/importSources";
import { ServiceMark } from "../../tour/ServiceMark";
import glass from "../../sheets/GlassSheet.module.css";
import { formatDuration } from "../entity/entityModel";
import styles from "./ImportPreview.module.css";

const SHORT_ROWS = 4;
/** A likes import can list 20,000 rows; past this many the open list says how many more there are. */
const LONG_ROWS = 200;
const STACK = 3;

type Rows = Listing["rows"];
export type SongSearch = (query: string) => Promise<CatalogTrack[]>;

const MARK: Partial<Record<Listing["source"], ImportSource>> = {
  "youtube-music": "youtube",
  "apple-music": "apple",
  soundcloud: "soundcloud",
  deezer: "deezer",
  spotify: "spotify",
};

export function listingCovers(rows: Rows): string[] {
  const covers = new Set<string>();
  for (const row of rows) {
    const url = row.track?.cover?.url;
    if (url) covers.add(url);
    if (covers.size === STACK) break;
  }
  return [...covers];
}

export async function searchCovers(rows: Rows, search: SongSearch): Promise<string[]> {
  const found = await Promise.all(
    rows.slice(0, STACK).map((row) =>
      search([row.artists[0], row.title].filter(Boolean).join(" ")).then(
        (tracks) => tracks[0]?.cover?.url,
        () => undefined,
      ),
    ),
  );
  return [...new Set(found.filter((url): url is string => !!url))];
}

function useCovers(rows: Rows, search?: SongSearch): string[] | null {
  const own = listingCovers(rows);
  const [borrowed, setBorrowed] = useState<string[] | null>(null);
  const needed = own.length === 0 && !!search;
  useEffect(() => {
    if (!needed || !search) return;
    let live = true;
    void searchCovers(rows, search).then((covers) => live && setBorrowed(covers));
    return () => {
      live = false;
    };
  }, [needed, rows, search]);
  return needed ? borrowed : own;
}

function CoverStack({ covers }: { covers: string[] | null }): JSX.Element | null {
  if (covers === null) return <span className={styles.pending} aria-hidden="true" />;
  if (covers.length === 0) return null;
  return (
    <span className={styles.stack} data-count={covers.length} aria-hidden="true">
      {covers.map((url) => (
        <span key={url} className={styles.card}>
          <Cover src={url} size={56} radius={12} />
        </span>
      ))}
    </span>
  );
}

export function ImportPreview({
  listing,
  label,
  notice,
  headingId,
  search,
}: {
  listing: Listing;
  label: string;
  notice?: string;
  headingId: string;
  search?: SongSearch;
}): JSX.Element {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const listRef = useRef<HTMLOListElement>(null);
  useScrollActivity(listRef);
  const { rows } = listing;
  const covers = useCovers(rows, search);
  const shown = open ? rows.slice(0, LONG_ROWS) : rows.slice(0, SHORT_ROWS);
  const hidden = rows.length - shown.length;

  return (
    <>
      <div className={styles.head}>
        <CoverStack covers={covers} />
        <div className={styles.headText}>
          <h2 id={headingId} className={styles.name}>
            {label}
          </h2>
          <p className={styles.meta}>
            {MARK[listing.source] ? <ServiceMark source={MARK[listing.source]!} size={14} /> : null}
            <span>
              {t(`ui.imports.source.${listing.source}`)} · {t("ui.imports.songs", { count: rows.length })}
            </span>
          </p>
        </div>
      </div>
      {notice ? (
        <p className={styles.notice}>
          <Icon name="info" size={16} />
          <span>{notice}</span>
        </p>
      ) : null}
      <div className={styles.list}>
        <ol ref={listRef} className={`${styles.songs} n-scroll`} data-open={open ? "" : undefined}>
          {shown.map((row, index) => (
            <li key={index} className={styles.song} style={{ "--i": Math.min(index, SHORT_ROWS) } as CSSProperties}>
              <span className={styles.songText}>
                <span className={styles.songTitle}>{row.title}</span>
                {row.artists.length ? <span className={styles.songArtist}>{row.artists.join(", ")}</span> : null}
              </span>
              {row.durationMs ? <span className={styles.time}>{formatDuration(row.durationMs)}</span> : null}
            </li>
          ))}
          {open && hidden > 0 ? <li className={styles.rest}>{t("ui.imports.more_songs", { count: hidden })}</li> : null}
        </ol>
        {rows.length > SHORT_ROWS ? (
          <button type="button" className={`${glass.quiet} ${styles.toggle}`} aria-expanded={open} onClick={() => setOpen(!open)}>
            {open ? t("ui.imports.show_less") : t("ui.imports.show_all", { count: rows.length })}
            <Icon name={open ? "chevron-up" : "chevron-down"} size={16} />
          </button>
        ) : null}
      </div>
    </>
  );
}
