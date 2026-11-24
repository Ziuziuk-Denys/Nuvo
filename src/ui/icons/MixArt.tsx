import type { CSSProperties, JSX } from "react";
import { Cover } from "../components/Cover";
import { useCoverFluidColors } from "../ports/covers";
import styles from "./MixArt.module.css";

export interface MixArtProps {
  covers: readonly string[];
  number: number;
  size: number;
}

const SLAB = 0.62;

export function MixArt({ covers, number, size }: MixArtProps): JSX.Element {
  const { color1 } = useCoverFluidColors(covers[0]);
  const slab = Math.round(size * SLAB);
  return (
    <div className={styles.art} style={{ "--size": `${size}px`, "--key": color1 } as CSSProperties}>
      <span className={styles.number} data-mix-number>
        {number}
      </span>
      {covers[0] ? (
        <span className={styles.slab} style={{ width: slab, height: slab }}>
          <Cover src={covers[0]} size={slab} radius={0} />
        </span>
      ) : null}
    </div>
  );
}
