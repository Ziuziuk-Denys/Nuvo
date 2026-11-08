import type { JSX } from "react";
import styles from "./Explicit.module.css";

/** The small E after a song's title, where its source marks it explicit. */
export function Explicit({ label }: { label: string }): JSX.Element {
  return (
    <span role="img" className={styles.mark} aria-label={label} title={label}>
      E
    </span>
  );
}
