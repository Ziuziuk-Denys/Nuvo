import { useLayoutEffect, useRef, useState, type JSX, type RefObject } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useScrollMargin } from "../../components/useScrollMargin";
import { useShellScroller } from "../../shell/scroller";
import { entryKey, type LibraryEntry } from "./libraryModel";
import { EntryArt, entryMeta, type EntryViewProps } from "./LibraryList";
import styles from "./LibraryGrid.module.css";

const GAP = 24;
const MIN_TILE = 165;
/** 8 px under the cover, a 21 px title line, a 19.5 px subtitle line and 24 px below. */
const TEXT_HEIGHT = 8 + 21 + 19.5 + 24;
/** Up to this many tiles render as one plain grid; past it the grid is virtualised by rows. */
const PLAIN_MAX = 100;
const PLACEHOLDER_TILES = 10;

/** Tint tiles in the grid's own columns, so the covers land exactly where they will stand. */
export function TilePlaceholders(): JSX.Element {
  return (
    <div className={styles.grid} data-placeholder="tile" aria-hidden>
      {Array.from({ length: PLACEHOLDER_TILES }, (_, index) => (
        <span key={index} className={styles.placeholder}>
          <span className={styles.box} />
          <span className={styles.bar} />
          <span className={`${styles.bar} ${styles.short}`} />
        </span>
      ))}
    </div>
  );
}

function Tile({ entry, selected, playing, onActivate, onMenu, t }: Omit<EntryViewProps, "entries"> & { entry: LibraryEntry }): JSX.Element {
  const key = entryKey(entry);
  // a count reads better than the kind under a cover; artists keep their kind
  const subtitle = entry.kind === "artist" ? entry.subtitle : (entryMeta(entry, t) ?? entry.subtitle);
  return (
    <button
      type="button"
      className={styles.tile}
      data-selected={selected === key ? "" : undefined}
      data-playing={playing === key ? "" : undefined}
      data-kind={entry.kind}
      onClick={() => onActivate(entry)}
      onContextMenu={(event) => {
        event.preventDefault();
        onMenu(entry, event.currentTarget, { x: event.clientX, y: event.clientY });
      }}
    >
      <span className={styles.art}>
        <EntryArt entry={entry} />
      </span>
      <span className={styles.text}>
        <span className={styles.title}>{entry.title}</span>
        <span className={styles.subtitle}>{subtitle}</span>
      </span>
    </button>
  );
}

/** Columns that fit tiles of at least 165 px, and the width each tile gets. */
function useColumns(ref: RefObject<HTMLDivElement | null>): { columns: number; tile: number } {
  const [layout, setLayout] = useState({ columns: 1, tile: MIN_TILE });
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const measure = () => {
      const width = node.clientWidth;
      const columns = Math.max(1, Math.floor((width + GAP) / (MIN_TILE + GAP)));
      setLayout({ columns, tile: Math.max(MIN_TILE, (width - GAP * (columns - 1)) / columns) });
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref]);
  return layout;
}

/** Covers in columns of at least 165 px that share the full width, 24 px apart. */
export function LibraryGrid(props: EntryViewProps): JSX.Element {
  const { entries } = props;
  const scroller = useShellScroller();
  const gridRef = useRef<HTMLDivElement>(null);
  const { columns, tile } = useColumns(gridRef);
  const scrollMargin = useScrollMargin(gridRef);
  const virtual = entries.length > PLAIN_MAX;
  const rowCount = virtual ? Math.ceil(entries.length / columns) : 0;
  const rowHeight = tile + TEXT_HEIGHT + GAP;
  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scroller.current,
    estimateSize: () => rowHeight,
    overscan: 2,
    scrollMargin,
    initialRect: { width: 1120, height: 800 },
  });
  useLayoutEffect(() => {
    if (virtual) virtualizer.measure();
  }, [virtual, virtualizer, rowHeight]);

  const render = (entry: LibraryEntry) => <Tile key={entryKey(entry)} entry={entry} {...props} />;

  if (!virtual) {
    return (
      <div ref={gridRef} className={styles.grid}>
        {entries.map(render)}
      </div>
    );
  }

  return (
    <div ref={gridRef} className={styles.virtual} style={{ height: virtualizer.getTotalSize() }}>
      {virtualizer.getVirtualItems().map((row) => (
        <div key={row.index} className={`${styles.grid} ${styles.row}`} style={{ transform: `translateY(${row.start - scrollMargin}px)` }}>
          {entries.slice(row.index * columns, (row.index + 1) * columns).map(render)}
        </div>
      ))}
    </div>
  );
}
