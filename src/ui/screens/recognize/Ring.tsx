import type { CSSProperties, JSX, ReactNode } from "react";
import styles from "./Recognize.module.css";

const PEAKS = 48;
const TICKS = PEAKS * 2;
const REST = Array.from(
  { length: PEAKS },
  (_, index) => 0.26 + 0.3 * Math.sin((index / (PEAKS - 1)) * Math.PI) ** 2 * (0.5 + 0.5 * Math.sin(index * 1.7) ** 2),
);

export function Ring({ peaks, live, found, children }: { peaks: readonly number[]; live: boolean; found?: boolean; children?: ReactNode }): JSX.Element {
  const known = peaks.length === PEAKS;
  const shown = known ? peaks : REST;
  return (
    <div className={styles.ring} data-found={found ? "" : undefined}>
      <div className={styles.ticks} aria-hidden="true" data-live={live && !known ? "" : undefined} data-heard={live && known ? "" : undefined}>
        {Array.from({ length: TICKS }, (_, index) => {
          const peak = shown[index < PEAKS ? index : TICKS - 1 - index];
          return <i key={index} style={{ "--peak": Math.max(0.06, Math.min(1, peak)), "--at": index / TICKS } as CSSProperties} />;
        })}
      </div>
      <div className={styles.center}>{children}</div>
    </div>
  );
}
