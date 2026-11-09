import type { CSSProperties, JSX } from "react";
import styles from "./Recognize.module.css";

const BARS = 48;
const REST = Array.from({ length: BARS }, (_, index) => 0.14 + 0.3 * Math.sin((index / (BARS - 1)) * Math.PI) ** 2 * (0.6 + 0.4 * Math.sin(index * 1.7) ** 2));

export function Wave({ peaks, live }: { peaks: readonly number[]; live: boolean }): JSX.Element {
  const shown = peaks.length === BARS ? peaks : REST;
  return (
    <div className={styles.wave} aria-hidden="true" data-live={live && peaks.length !== BARS ? "" : undefined}>
      {shown.map((peak, index) => (
        <i key={index} style={{ "--peak": Math.max(0.06, peak), "--bar": index } as CSSProperties} />
      ))}
    </div>
  );
}
