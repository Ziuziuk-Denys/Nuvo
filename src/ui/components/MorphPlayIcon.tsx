import type { CSSProperties, JSX } from "react";
import styles from "./MorphPlayIcon.module.css";

/** Play and pause drawn as two four-point shapes each, so CSS can morph the path between them; the round stroke softens the corners. */
export const PLAY_PATH = "M9 6 L14 9 L14 15 L9 18 Z M14 9 L19 12 L19 12 L14 15 Z";
export const PAUSE_PATH = "M6.8 6 L9.2 6 L9.2 18 L6.8 18 Z M14.8 6 L17.2 6 L17.2 18 L14.8 18 Z";

export function MorphPlayIcon({ playing, size }: { playing: boolean; size: number }): JSX.Element {
  const icon = playing ? PAUSE_PATH : PLAY_PATH;
  // the attribute draws it where CSS d is unknown; the property is what the transition animates
  const style = { d: `path("${icon}")` } as CSSProperties;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className={styles.icon}>
      <path d={icon} style={style} fill="currentColor" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" />
    </svg>
  );
}
