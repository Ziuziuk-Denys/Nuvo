import { useEffect, useId, useRef, type JSX, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { LAYER_ATTRIBUTE, trapTab, useLayer } from "../components/layers";
import { WindowButtons } from "../shell/WindowButtons";
import styles from "./StateCard.module.css";

interface StateCardProps {
  title: string;
  line: string;
  glyph: ReactNode;
  role?: "dialog" | "alertdialog";
  busy?: boolean;
  shake?: number;
  children: ReactNode;
}

const SHAKE: Keyframe[] = [0, -10, 9, -7, 5, -3, 0].map((x) => ({ transform: `translateX(${x}px)` }));

function reducedMotion(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function StateCard({ title, line, glyph, role = "dialog", busy = false, shake = 0, children }: StateCardProps): JSX.Element {
  const titleId = useId();
  const lineId = useId();
  const cardRef = useRef<HTMLDivElement>(null);

  useLayer(true, cardRef, { onEscape: () => undefined });

  useEffect(() => {
    const card = cardRef.current;
    if (shake === 0 || !card || reducedMotion() || typeof card.animate !== "function") return;
    card.animate(SHAKE, { duration: 420, easing: "cubic-bezier(0.36, 0.07, 0.19, 0.97)" });
  }, [shake]);

  return createPortal(
    <div className={styles.layer} {...{ [LAYER_ATTRIBUTE]: "" }}>
      <div className={styles.backdrop} />
      <div className={styles.top} data-window-drag>
        <WindowButtons />
      </div>
      <div
        ref={cardRef}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={lineId}
        aria-busy={busy || undefined}
        tabIndex={-1}
        className={styles.card}
        onKeyDown={(event) => trapTab(event, event.currentTarget)}
      >
        <span className={styles.glyph}>{glyph}</span>
        <h2 id={titleId} className={styles.title}>
          {title}
        </h2>
        <p id={lineId} className={styles.line}>
          {line}
        </p>
        {children}
      </div>
    </div>,
    document.body,
  );
}
