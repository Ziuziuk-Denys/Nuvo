import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type JSX, type ReactNode, type WheelEvent } from "react";
import { createPortal } from "react-dom";
import { POPOVER } from "../geometry";
import { DURATION_MS, EASE } from "../motion";
import { useTranslation } from "../ports/i18n";
import { IconButton } from "./IconButton";
import { clamp, EDGE_PX, LAYER_ATTRIBUTE, trapTab, useLayer, usePresence } from "./layers";
import styles from "./Popover.module.css";

export interface PopoverProps {
  open: boolean;
  anchor: HTMLElement | null;
  onClose: () => void;
  title: string;
  width: 300 | 320 | 440 | 560;
  trailing?: ReactNode;
  showClose?: boolean;
  solid?: boolean;
  onWheel?: (event: WheelEvent<HTMLDivElement>) => void;
  children: ReactNode;
}

interface Place {
  left: number;
  edge: number;
  below: boolean;
  originX: number;
  room: number;
}

export function placeOn(anchor: HTMLElement | null, width: number, height: number): Place {
  const viewWidth = window.innerWidth;
  const viewHeight = window.innerHeight;
  if (!anchor) {
    const left = clamp((viewWidth - width) / 2, EDGE_PX, viewWidth - width - EDGE_PX);
    return { left, edge: Math.max(EDGE_PX, (viewHeight - height) / 2), below: true, originX: width / 2, room: viewHeight - 2 * EDGE_PX };
  }
  const box = anchor.getBoundingClientRect();
  const centre = box.left + box.width / 2;
  const left = clamp(centre - width / 2, EDGE_PX, viewWidth - width - EDGE_PX);
  const bar = anchor.closest("[data-island]");
  const top = bar ? bar.getBoundingClientRect().top : box.top;
  const gap = bar ? POPOVER.islandGap : POPOVER.gap;
  const roomAbove = top - gap - EDGE_PX;
  const roomBelow = viewHeight - box.bottom - POPOVER.gap - EDGE_PX;
  const below = !bar && height > roomAbove && roomBelow > roomAbove;
  const edge = below ? box.bottom + POPOVER.gap : viewHeight - top + gap;
  return { left, edge, below, originX: centre - left, room: Math.max(0, below ? roomBelow : roomAbove) };
}

const SLIVER_PX = 44;
const FRESH_MS = 1000;

export function Popover(props: PopoverProps): JSX.Element | null {
  const phase = usePresence(props.open);
  return phase === null ? null : <PopoverPanel {...props} phase={phase} />;
}

function PopoverPanel({
  open,
  anchor,
  onClose,
  title,
  width,
  trailing,
  showClose = false,
  solid = false,
  onWheel,
  children,
  phase,
}: PopoverProps & { phase: "in" | "out" }) {
  const { t } = useTranslation();
  const panelRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | null>(null);
  const [place, setPlace] = useState<Place | null>(null);
  // transitions start only after the first placement has painted, so the opening never slides in from 0
  const [settled, setSettled] = useState(false);
  const [fresh, setFresh] = useState(true);
  const opening = useRef(true);

  useEffect(() => {
    const timer = window.setTimeout(() => setFresh(false), FRESH_MS);
    return () => window.clearTimeout(timer);
  }, []);

  useLayer(open, panelRef, { onEscape: onClose, returnTo: anchor, onOutside: onClose });

  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    const measure = () => setHeight(content.offsetHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    if (height === null) return;
    const update = () => setPlace(placeOn(anchor, width, height));
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [anchor, width, height]);

  useEffect(() => {
    if (!place || settled) return;
    const frame = requestAnimationFrame(() => setSettled(true));
    return () => cancelAnimationFrame(frame);
  }, [place, settled]);

  useEffect(() => {
    if (!settled) return;
    if (opening.current) {
      opening.current = false;
      return;
    }
    bodyRef.current?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: DURATION_MS.quick, easing: `cubic-bezier(${EASE.out.join(",")})` });
  }, [settled, anchor, width, height]);

  const frameStyle: CSSProperties = {
    width,
    transform: `translateX(${place?.left ?? 0}px)`,
    ...(place?.below ? { top: place.edge } : { bottom: place?.edge ?? 0 }),
  };
  const originX = place?.originX ?? width / 2;
  const sliver = place?.below ? "0 VAR calc(100% - 1px) VAR" : "calc(100% - 1px) VAR 0 VAR";
  const capped = height !== null && place !== null && height > place.room;
  const panelStyle = {
    height: capped ? place.room : (height ?? undefined),
    "--nx": `${originX}px`,
    "--from": sliver.replace("VAR", `${Math.max(0, width - originX - SLIVER_PX / 2)}px`).replace("VAR", `${Math.max(0, originX - SLIVER_PX / 2)}px`),
  } as CSSProperties;

  return createPortal(
    <div className={styles.frame} style={frameStyle} data-settled={settled ? "" : undefined} {...{ [LAYER_ATTRIBUTE]: "" }}>
      <div
        ref={panelRef}
        role="dialog"
        aria-label={title}
        tabIndex={-1}
        className={styles.panel}
        style={panelStyle}
        data-state={phase}
        data-settled={settled ? "" : undefined}
        data-below={place?.below ? "" : undefined}
        data-fresh={fresh ? "" : undefined}
        data-solid={solid ? "" : undefined}
        onKeyDown={(event) => trapTab(event, event.currentTarget)}
        onWheel={onWheel}
      >
        <div className={capped ? `${styles.scroller} n-scroll` : styles.scroller}>
          <div ref={contentRef} className={styles.content} style={{ width }}>
            <div className={styles.header}>
              <h2 className={styles.title}>{title}</h2>
              {trailing}
              {showClose ? <IconButton icon="close" label={t("common.close")} size="s" tone="solo" onClick={onClose} /> : null}
            </div>
            <div ref={bodyRef} className={styles.body}>
              {children}
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
