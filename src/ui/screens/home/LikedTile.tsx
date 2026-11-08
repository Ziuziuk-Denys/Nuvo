import type { JSX } from "react";
import { useLikesCover } from "../../ports/library";
import styles from "./LikedTile.module.css";

/** Liked songs' own artwork, the app's likes cover for the current look. Without a size it fills its box. */
export function LikedTile({ size }: { size?: number }): JSX.Element {
  const cover = useLikesCover();
  return (
    <span className={styles.tile} style={size ? { width: size, height: size } : undefined} aria-hidden="true">
      <img className={styles.image} src={cover} alt="" draggable={false} />
    </span>
  );
}
