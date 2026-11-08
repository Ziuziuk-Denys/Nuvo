import { useLayoutEffect, useRef, useState, type CSSProperties, type JSX, type KeyboardEvent, type MouseEvent, type RefObject } from "react";
import styles from "./Tabs.module.css";

export interface TabsProps<T extends string> {
  /** href is used in navigation mode, where items are links. */
  items: { id: T; label: string; href?: string }[];
  /** null marks no item (a route outside the navigation). */
  value: T | null;
  onChange: (id: T) => void;
  /** Names the tab list or the navigation for assistive tech. */
  label: string;
  /** "nav" renders a nav of links with aria-current on the active one instead of a tablist. */
  as?: "tabs" | "nav";
}

export function Tabs<T extends string>({ items, value, onChange, label, as = "tabs" }: TabsProps<T>): JSX.Element {
  const listRef = useRef<HTMLElement>(null);
  const tabRefs = useRef(new Map<T, HTMLElement>());
  const [line, setLine] = useState<{ x: number; width: number } | null>(null);

  // re-measured when the value changes and when the list resizes (locale switch, late font metrics)
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const measure = () => {
      const tab = value === null ? undefined : tabRefs.current.get(value)?.getBoundingClientRect();
      const box = list.getBoundingClientRect();
      // rects keep subpixels that offsetLeft rounds away; the ratio undoes a parent transform (a popover entering at .96)
      const scale = box.width ? list.offsetWidth / box.width : 1;
      setLine(tab ? { x: (tab.left - box.left) * scale, width: tab.width * scale } : null);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    return () => observer.disconnect();
  }, [value, items]);

  const select = (index: number) => {
    const item = items[(index + items.length) % items.length];
    onChange(item.id);
    tabRefs.current.get(item.id)?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next: Record<string, number> = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: items.length - 1 };
    if (!(event.key in next)) return;
    event.preventDefault();
    select(next[event.key]);
  };

  const remember = (id: T) => (node: HTMLElement | null) => {
    if (node) tabRefs.current.set(id, node);
    else tabRefs.current.delete(id);
  };

  // one indicator under the active item: a sliding pill in tabs, an underline in navigation
  const indicator = line ? <span className={styles.line} aria-hidden="true" style={{ "--x": `${line.x}px`, "--w": line.width } as CSSProperties} /> : null;

  if (as === "nav") {
    const follow = (event: MouseEvent<HTMLAnchorElement>, id: T) => {
      // modified clicks keep the browser's own link behaviour
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      onChange(id);
    };
    return (
      <nav ref={listRef} aria-label={label} className={styles.tabs}>
        {items.map((item) => (
          <a
            key={item.id}
            ref={remember(item.id)}
            href={item.href}
            data-nav={item.id}
            aria-current={item.id === value ? "page" : undefined}
            className={styles.tab}
            onClick={(event) => follow(event, item.id)}
          >
            {item.label}
          </a>
        ))}
        {indicator}
      </nav>
    );
  }

  return (
    <div ref={listRef as RefObject<HTMLDivElement>} role="tablist" aria-label={label} className={styles.tabs}>
      {items.map((item, index) => {
        const selected = item.id === value;
        return (
          <button
            key={item.id}
            ref={remember(item.id)}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            className={styles.tab}
            onClick={() => onChange(item.id)}
            onKeyDown={(event) => onKeyDown(event, index)}
          >
            {item.label}
          </button>
        );
      })}
      {indicator}
    </div>
  );
}
