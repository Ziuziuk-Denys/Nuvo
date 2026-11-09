import { cloneElement, useEffect, useId, useLayoutEffect, useRef, useState, type FocusEvent, type JSX, type MouseEvent, type ReactElement } from "react";
import { createPortal } from "react-dom";
import styles from "./Tooltip.module.css";

const HOVER_DELAY_MS = 500;
const GAP_PX = 8;
const EDGE_PX = 8;

export function Tooltip({ text, children }: { text: string; children: ReactElement<{ "aria-describedby"?: string }> }): JSX.Element {
  const id = useId();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const timer = useRef<number | undefined>(undefined);
  // a mouse press focuses the button too; that focus must not bring the hint back
  const pressed = useRef(false);

  const hide = () => {
    window.clearTimeout(timer.current);
    setAnchor(null);
  };

  useEffect(() => () => window.clearTimeout(timer.current), []);

  useEffect(() => {
    if (!anchor) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") hide();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [anchor]);

  const onMouseEnter = (event: MouseEvent<HTMLSpanElement>) => {
    const target = event.currentTarget.firstElementChild as HTMLElement | null;
    window.clearTimeout(timer.current);
    if (target) timer.current = window.setTimeout(() => setAnchor(target), HOVER_DELAY_MS);
  };

  const onMouseLeave = () => {
    pressed.current = false;
    hide();
  };

  const onMouseDown = () => {
    pressed.current = true;
    hide();
  };

  const onFocus = (event: FocusEvent<HTMLSpanElement>) => {
    if (!pressed.current) setAnchor(event.target as HTMLElement);
  };

  const onBlur = () => {
    pressed.current = false;
    hide();
  };

  const shown = anchor !== null && text !== "";
  const describedBy = shown ? id : children.props["aria-describedby"];

  return (
    <span className={styles.anchor} onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave} onMouseDown={onMouseDown} onFocus={onFocus} onBlur={onBlur}>
      {cloneElement(children, { "aria-describedby": describedBy })}
      {shown ? createPortal(<Bubble id={id} text={text} anchor={anchor} />, document.body) : null}
    </span>
  );
}

function Bubble({ id, text, anchor }: { id: string; text: string; anchor: HTMLElement }) {
  const ref = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    const bubble = ref.current;
    if (!bubble) return;
    const box = anchor.getBoundingClientRect();
    const width = bubble.offsetWidth;
    const height = bubble.offsetHeight;
    const above = box.top - GAP_PX - height;
    const top = above >= EDGE_PX ? above : box.bottom + GAP_PX;
    const centred = box.left + box.width / 2 - width / 2;
    const left = Math.min(Math.max(centred, EDGE_PX), window.innerWidth - width - EDGE_PX);
    setPlace({ top, left });
  }, [anchor, text]);

  return (
    <div ref={ref} id={id} role="tooltip" className={styles.tooltip} data-placed={place ? "" : undefined} style={place ?? undefined}>
      {text}
    </div>
  );
}
