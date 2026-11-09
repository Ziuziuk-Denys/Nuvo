import { useCallback, useLayoutEffect, useRef, useState, type CSSProperties, type JSX, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Icon } from "../icons/Icon";
import type { IconName } from "../icons";
import { POPOVER_SHIFT_PX } from "../motion";
import { clamp, EDGE_PX, LAYER_ATTRIBUTE, useLayer, usePresence } from "./layers";
import styles from "./Menu.module.css";

export type MenuItem = { label: string; onSelect(): void; danger?: boolean; disabled?: boolean; icon?: IconName } | "separator";

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

export function Menu({ open, anchor, onClose, items, at, className }: MenuProps): JSX.Element | null {
  const phase = usePresence(open);
  const panelRef = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<Place | null>(null);
  const mounted = phase !== null;

  useLayer(open, panelRef, { onEscape: onClose, returnTo: anchor, onOutside: onClose });

  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!mounted || !panel) {
      setPlace(null);
      return;
    }
    const update = () => setPlace(placeMenu(anchor, at, panel.offsetWidth, panel.offsetHeight));
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [mounted, anchor, at, items]);

  if (!mounted) return null;

  const select = (item: Exclude<MenuItem, "separator">) => {
    onClose();
    item.onSelect();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')];
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const focusAt = (index: number) => buttons[(index + buttons.length) % buttons.length]?.focus();
    if (event.key === "ArrowDown") focusAt(current + 1);
    else if (event.key === "ArrowUp") focusAt(current < 0 ? -1 : current - 1);
    else if (event.key === "Home") focusAt(0);
    else if (event.key === "End") focusAt(-1);
    else if (event.key === "Enter" && current >= 0) buttons[current].click();
    else if (event.key === "Tab") onClose();
    else if (event.key.length === 1 && event.key !== " " && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const letter = event.key.toLocaleLowerCase();
      const order = buttons.map((_, step) => buttons[(current + 1 + step) % buttons.length]);
      order.find((node) => node.textContent?.toLocaleLowerCase().startsWith(letter))?.focus();
    } else return;
    event.preventDefault();
  };

  const style = {
    left: place?.left ?? 0,
    top: place?.top ?? 0,
    transformOrigin: `${place?.flipX ? "100%" : "0"} ${place?.flipY ? "100%" : "0"}`,
    "--shift": `${place?.flipY ? POPOVER_SHIFT_PX : -POPOVER_SHIFT_PX}px`,
  } as CSSProperties;

  return createPortal(
    <div
      ref={panelRef}
      role="menu"
      tabIndex={-1}
      className={className ? `${styles.menu} ${className}` : styles.menu}
      style={style}
      data-state={phase}
      onKeyDown={onKeyDown}
      {...{ [LAYER_ATTRIBUTE]: "" }}
    >
      {items.map((item, index) =>
        item === "separator" ? (
          <div key={`separator-${index}`} role="separator" className={styles.separator} />
        ) : (
          <button
            key={index}
            type="button"
            role="menuitem"
            tabIndex={-1}
            className={styles.item}
            disabled={item.disabled}
            data-danger={item.danger ? "" : undefined}
            onClick={() => select(item)}
          >
            {item.icon ? <Icon name={item.icon} size={16} className={styles.icon} /> : null}
            <span className={styles.label}>{item.label}</span>
          </button>
        ),
      )}
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
