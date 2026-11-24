import type { JSX } from "react";
import styles from "./EmptyArt.module.css";

export function EmptyArt(): JSX.Element {
  return <span className={styles.sleeve} aria-hidden="true" />;
}
