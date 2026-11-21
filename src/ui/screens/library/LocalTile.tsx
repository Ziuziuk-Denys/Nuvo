import type { JSX } from "react";
import { Icon } from "../../icons/Icon";
import styles from "./LocalTile.module.css";

export function LocalTile({ size }: { size?: number }): JSX.Element {
  return (
    <span className={styles.tile} style={size ? { width: size, height: size } : undefined} aria-hidden="true">
      <Icon name="folder" size={size !== undefined && size < 64 ? 20 : 26} />
    </span>
  );
}
