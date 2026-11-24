import type { CSSProperties, JSX } from "react";
import styles from "./MorphPlayIcon.module.css";

// Same command list in both, so CSS can morph one into the other
export const PLAY_PATH =
  "M5.9 6.48 C5.9 4.71 7.82 3.61 9.35 4.49 L12.6 6.37 C12.6 6.37 12.6 6.37 12.6 6.37 L12.6 17.63 C12.6 17.63 12.6 17.63 12.6 17.63 L9.35 19.51 C7.82 20.39 5.9 19.29 5.9 17.52 Z M12.4 6.25 C12.4 6.25 12.4 6.25 12.4 6.25 L18.91 10.01 C19.62 10.42 20.06 11.18 20.06 12 L20.06 12 C20.06 12.82 19.62 13.58 18.91 13.99 L12.4 17.75 C12.4 17.75 12.4 17.75 12.4 17.75 Z";
export const PAUSE_PATH =
  "M5.75 5.65 C5.75 4.88 6.38 4.25 7.15 4.25 L8.85 4.25 C9.62 4.25 10.25 4.88 10.25 5.65 L10.25 18.35 C10.25 19.12 9.62 19.75 8.85 19.75 L7.15 19.75 C6.38 19.75 5.75 19.12 5.75 18.35 Z M13.75 5.65 C13.75 4.88 14.38 4.25 15.15 4.25 L16.85 4.25 C17.62 4.25 18.25 4.88 18.25 5.65 L18.25 18.35 C18.25 19.12 17.62 19.75 16.85 19.75 L15.15 19.75 C14.38 19.75 13.75 19.12 13.75 18.35 Z";

export function MorphPlayIcon({ playing, size }: { playing: boolean; size: number }): JSX.Element {
  const icon = playing ? PAUSE_PATH : PLAY_PATH;
  // the attribute draws it where CSS d is unknown; the property is what the transition animates
  const style = { d: `path("${icon}")` } as CSSProperties;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className={styles.icon}>
      <path d={icon} style={style} fill="currentColor" />
    </svg>
  );
}
