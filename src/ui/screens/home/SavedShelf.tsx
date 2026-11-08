import { useRef, useState, type CSSProperties, type JSX } from "react";
import { Cover } from "../../components/Cover";
import type { MostSavedEntry } from "../../ports/library";
import { ShelfHeading } from "./ShelfHeading";
import styles from "./SavedShelf.module.css";

const CARD_SIZE = 175;
const CARD_GAP = 28;
/** About what a narrow window shows at once; with no more than this a refresh would bring nothing new. */
const ROTATES_FROM = 5;

/**
 * A titled row of 175 px covers that scrolls sideways; each opens its album or playlist page.
 * Refresh turns the row on by as many covers as the window shows, so the ones after them come into view.
 */
export function SavedShelf({ title, items, onOpen }: { title: string; items: MostSavedEntry[]; onOpen(href: string): void }): JSX.Element {
  const row = useRef<HTMLDivElement>(null);
  const [turn, setTurn] = useState({ offset: 0, round: 0 });
  const start = turn.offset % items.length;
  const shown = [...items.slice(start), ...items.slice(0, start)];
  // the row mounts anew for each round, so it starts at its left edge
  const refresh = () => {
    const box = row.current;
    if (!box) return;
    const fits = Math.max(1, Math.floor((box.clientWidth + CARD_GAP) / (CARD_SIZE + CARD_GAP)));
    setTurn(({ offset, round }) => ({ offset: offset + fits, round: round + 1 }));
  };
  return (
    <section className={styles.shelf} aria-label={title} data-shelf="saved">
      <ShelfHeading icon="bookmark" title={title} onRefresh={items.length >= ROTATES_FROM ? refresh : undefined} />
      <div ref={row} key={turn.round} className={turn.round > 0 ? `${styles.row} ${styles.arrive}` : styles.row}>
        {shown.map((item, index) => {
          const href = `/collection?type=${item.type}&id=${encodeURIComponent(item.id)}`;
          return (
            <a
              key={`${item.type}:${item.id}`}
              className={styles.card}
              style={{ "--i": index } as CSSProperties}
              href={`#${href}`}
              draggable={false}
              onClick={(event) => {
                event.preventDefault();
                onOpen(href);
              }}
            >
              <Cover src={item.coverUrl ?? ""} size={CARD_SIZE} />
              <span className={styles.name}>{item.title}</span>
              {item.subtitle ? <span className={styles.subtitle}>{item.subtitle}</span> : null}
            </a>
          );
        })}
      </div>
    </section>
  );
}
