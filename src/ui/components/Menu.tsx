import { useCallback, useLayoutEffect, useRef, useState, type CSSProperties, type JSX, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Icon } from "../icons/Icon";
import type { IconName } from "../icons";
import { POPOVER_SHIFT_PX } from "../motion";
import { clamp, EDGE_PX, LAYER_ATTRIBUTE, useLayer, usePresence } from "./layers";
import styles from "./Menu.module.css";

export type MenuAction = { label: string; onSelect(): void; danger?: boolean; disabled?: boolean; icon?: IconName };
export type MenuGroup = { label: string; items: MenuItem[]; icon?: IconName; disabled?: boolean };
export type MenuItem = MenuAction | MenuGroup | "separator";

export interface MenuProps {
  open: boolean;
  anchor: HTMLElement | null;
  onClose: () => void;
  items: MenuItem[];
  at?: { x: number; y: number };
  className?: string;
}

const GAP_PX = 4;

interface Place {
  left: number;
  top: number;
  flipX: boolean;
  flipY: boolean;
}

function placeMenu(anchor: HTMLElement | null, at: MenuProps["at"], width: number, height: number): Place {
  const viewWidth = window.innerWidth;
  const viewHeight = window.innerHeight;
  const box = at ? { left: at.x, right: at.x, top: at.y, bottom: at.y } : anchor?.getBoundingClientRect();
  if (!box) return { left: EDGE_PX, top: EDGE_PX, flipX: false, flipY: false };
  const gap = at ? 0 : GAP_PX;
  const flipX = box.left + width > viewWidth - EDGE_PX;
  const flipY = box.bottom + gap + height > viewHeight - EDGE_PX;
  return {
    left: clamp(flipX ? box.right - width : box.left, EDGE_PX, viewWidth - width - EDGE_PX),
    top: clamp(flipY ? box.top - gap - height : box.bottom + gap, EDGE_PX, viewHeight - height - EDGE_PX),
    flipX,
    flipY,
  };
}

export function isMenuGroup(item: MenuItem): item is MenuGroup {
  return item !== "separator" && "items" in item;
}

export function Menu({ open, anchor, onClose, items, at, className }: MenuProps): JSX.Element | null {
  const phase = usePresence(open);
  const panelRef = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<Place | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [lit, setLit] = useState<{ top: number; height: number; danger: boolean } | null>(null);
  const mounted = phase !== null;

  useLayer(open, panelRef, { onEscape: onClose, returnTo: anchor, onOutside: onClose });

  const opening = open ? `${at?.x},${at?.y}` : null;
  const [openedAt, setOpenedAt] = useState(opening);
  if (openedAt !== opening) {
    setOpenedAt(opening);
    setExpanded(null);
  }

  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!mounted || !panel) {
      setPlace(null);
      setLit(null);
      return;
    }
    const update = () => setPlace(placeMenu(anchor, at, panel.offsetWidth, panel.offsetHeight));
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [mounted, anchor, at, items, expanded]);

  const light = useCallback((node: HTMLElement | null) => {
    setLit(node ? { top: node.offsetTop, height: node.offsetHeight, danger: node.hasAttribute("data-danger") } : null);
  }, []);

  if (!mounted) return null;

  const select = (item: MenuAction) => {
    onClose();
    item.onSelect();
  };

  const toggle = (index: number, focusFirst: boolean) => {
    const next = expanded === index ? null : index;
    setExpanded(next);
    if (next === null || !focusFirst) return;
    requestAnimationFrame(() => {
      const first = panelRef.current?.querySelector<HTMLElement>(`[data-group="${index}"] [role="menuitem"]`);
      first?.focus();
      light(first ?? null);
    });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')].filter(
      (node) => !node.closest("[data-group]:not([data-open])"),
    );
    const active = document.activeElement as HTMLButtonElement;
    const current = lit ? buttons.indexOf(active) : -1;
    const reach = (node: HTMLButtonElement | undefined) => {
      node?.focus();
      if (node) light(node);
    };
    const focusAt = (index: number) => reach(buttons[(index + buttons.length) % buttons.length]);
    const parent = active?.closest<HTMLElement>("[data-group]");
    if (event.key === "ArrowDown") focusAt(current + 1);
    else if (event.key === "ArrowUp") focusAt(current < 0 ? -1 : current - 1);
    else if (event.key === "Home") focusAt(0);
    else if (event.key === "End") focusAt(-1);
    else if (event.key === "ArrowRight" && active?.hasAttribute("aria-expanded")) {
      if (active.getAttribute("aria-expanded") === "false") toggle(Number(active.dataset.index), true);
    } else if (event.key === "ArrowLeft" && parent) {
      setExpanded(null);
      reach(panelRef.current?.querySelector<HTMLButtonElement>(`[data-index="${parent.dataset.group}"]`) ?? undefined);
    } else if (event.key === "Enter" && current >= 0) buttons[current].click();
    else if (event.key === "Tab") onClose();
    else if (event.key.length === 1 && event.key !== " " && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const letter = event.key.toLocaleLowerCase();
      const order = buttons.map((_, step) => buttons[(current + 1 + step) % buttons.length]);
      reach(order.find((node) => node.textContent?.toLocaleLowerCase().startsWith(letter)));
    } else return;
    event.preventDefault();
  };

  const style = {
    left: place?.left ?? 0,
    top: place?.top ?? 0,
    transformOrigin: `${place?.flipX ? "100%" : "0"} ${place?.flipY ? "100%" : "0"}`,
    "--shift": `${place?.flipY ? POPOVER_SHIFT_PX : -POPOVER_SHIFT_PX}px`,
  } as CSSProperties;

  const row = (item: MenuAction | MenuGroup, key: string | number, nested: boolean, index?: number) => {
    const group = isMenuGroup(item);
    const open = group && expanded === index;
    return (
      <button
        key={key}
        type="button"
        role="menuitem"
        tabIndex={-1}
        className={styles.item}
        disabled={item.disabled}
        data-nested={nested ? "" : undefined}
        data-danger={!group && item.danger ? "" : undefined}
        data-index={group ? index : undefined}
        aria-expanded={group ? open : undefined}
        onClick={() => (group ? toggle(index!, false) : select(item))}
        onPointerMove={(event) => {
          const node = event.currentTarget;
          if (lit?.top === node.offsetTop) return;
          node.focus({ preventScroll: true });
          light(node);
        }}
        onFocus={(event) => {
          if (event.currentTarget.matches(":focus-visible")) light(event.currentTarget);
        }}
      >
        {item.icon ? <Icon name={item.icon} size={16} className={styles.icon} /> : null}
        <span className={styles.label}>{item.label}</span>
        {group ? <Icon name="chevron-down" size={14} className={styles.chevron} /> : null}
      </button>
    );
  };

  return createPortal(
    <div
      ref={panelRef}
      role="menu"
      tabIndex={-1}
      className={className ? `${styles.menu} ${className}` : styles.menu}
      style={style}
      data-state={phase}
      onKeyDown={onKeyDown}
      onPointerLeave={() => {
        panelRef.current?.focus({ preventScroll: true });
        light(null);
      }}
      {...{ [LAYER_ATTRIBUTE]: "" }}
    >
      {lit ? (
        <span
          aria-hidden
          className={styles.lit}
          data-danger={lit.danger ? "" : undefined}
          style={{ transform: `translateY(${lit.top}px)`, height: lit.height }}
        />
      ) : null}
      {items.map((item, index) => {
        if (item === "separator") return <div key={`separator-${index}`} role="separator" className={styles.separator} />;
        if (!isMenuGroup(item)) return row(item, index, false);
        return (
          <div key={index} className={styles.group}>
            {row(item, index, false, index)}
            <div role="group" aria-label={item.label} className={styles.children} data-group={index} data-open={expanded === index ? "" : undefined}>
              {item.items.map((child, step) => (child === "separator" || isMenuGroup(child) ? null : row(child, step, true)))}
            </div>
          </div>
        );
      })}
    </div>,
    document.body,
  );
}

export function useContextMenu(): {
  open: (event: { clientX: number; clientY: number; preventDefault(): void }, items: MenuItem[]) => void;
  element: JSX.Element | null;
} {
  const [menu, setMenu] = useState<{ at: { x: number; y: number }; items: MenuItem[]; open: boolean } | null>(null);
  const open = useCallback((event: { clientX: number; clientY: number; preventDefault(): void }, items: MenuItem[]) => {
    event.preventDefault();
    setMenu({ at: { x: event.clientX, y: event.clientY }, items, open: true });
  }, []);
  const close = useCallback(() => setMenu((current) => current && { ...current, open: false }), []);
  const element = menu ? <Menu open={menu.open} anchor={null} at={menu.at} items={menu.items} onClose={close} /> : null;
  return { open, element };
}
