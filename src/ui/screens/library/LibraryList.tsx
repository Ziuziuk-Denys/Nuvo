import { useRef, type JSX } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Cover } from "../../components/Cover";
import type { TFunction } from "../../ports/i18n";
import { useScrollMargin } from "../../components/useScrollMargin";
import { useShellScroller } from "../../shell/scroller";
import { LikedTile } from "../home/LikedTile";
import { MediaRow } from "../MediaRow";
import { entryKey, type LibraryEntry } from "./libraryModel";
import styles from "./Library.module.css";

/** A 64 px row and the 4 px between rows. */
const ROW_STEP = 68;

export interface EntryViewProps {
  entries: LibraryEntry[];
  /** Key of the entry whose menu is open: it keeps its fill while the menu is up. */
  selected: string | null;
  /** Key of the entry playing now. */
  playing: string | null;
  onActivate: (entry: LibraryEntry) => void;
  onMenu: (entry: LibraryEntry, anchor: HTMLElement | null, at?: { x: number; y: number }) => void;
  t: TFunction;
}

export function entryMeta(entry: LibraryEntry, t: TFunction): string | undefined {
  if (entry.importing !== undefined) return t("ui.library.importing", { percent: entry.importing });
  if (entry.count === undefined) return undefined;
  return t(entry.kind === "liked" ? "common.songs" : "common.tracks", { count: entry.count });
}

/** The entry's artwork at a fixed size, or filling its box when no size is given. */
export function EntryArt({ entry, size }: { entry: LibraryEntry; size?: number }): JSX.Element {
  if (entry.kind === "liked") return <LikedTile size={size} />;
  return <Cover src={entry.cover ?? ""} size={size ?? 200} radius={8} shape={entry.kind === "artist" ? "circle" : "square"} />;
}

/** 64 px rows in the page's own scroll, virtualised so a library of thousands keeps a flat DOM. */
export function LibraryList({ entries, selected, playing, onActivate, onMenu, t }: EntryViewProps): JSX.Element {
  const scroller = useShellScroller();
  const listRef = useRef<HTMLDivElement>(null);
  const scrollMargin = useScrollMargin(listRef);
  const virtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => ROW_STEP,
    overscan: 8,
    scrollMargin,
    // tests and the first frame have no measured scroller yet
    initialRect: { width: 1120, height: 800 },
  });

  return (
    <div ref={listRef} className={styles.list} style={{ height: virtualizer.getTotalSize() }}>
      {virtualizer.getVirtualItems().map((item) => {
        const entry = entries[item.index];
        const key = entryKey(entry);
        const importing = entry.importing !== undefined;
        return (
          <div key={key} className={styles.slot} style={{ transform: `translateY(${item.start - scrollMargin}px)` }}>
            <MediaRow
              className={styles.entry}
              data-selected={selected === key ? "" : undefined}
              data-importing={importing ? "" : undefined}
              leading={<EntryArt entry={entry} size={48} />}
              title={entry.title}
              subtitle={entry.subtitle}
              meta={entryMeta(entry, t)}
              active={playing === key}
              onActivate={() => onActivate(entry)}
              onContextMenu={(event) => {
                event.preventDefault();
                onMenu(entry, event.currentTarget, { x: event.clientX, y: event.clientY });
              }}
              menuLabel={t("ui.library.more")}
              onMenu={(anchor) => onMenu(entry, anchor)}
            />
          </div>
        );
      })}
    </div>
  );
}
