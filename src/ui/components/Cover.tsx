import { useState, type JSX } from "react";
import { coverRadius } from "../geometry";
import { coverSrc } from "../ports/covers";
import styles from "./Cover.module.css";

export interface CoverProps {
  src: string;
  /** Drawn size in CSS pixels; the image is requested at this size. */
  size: number;
  shape?: "square" | "circle";
  /** Overrides coverRadius(size). */
  radius?: number;
  alt?: string;
  /** "low" for long result lists, so their thumbnails never hold up a click's player request. */
  fetchPriority?: "low" | "high" | "auto";
}

/** The daemon already tried every source variant, so one late retry is enough. */
const RETRY_MS = 250;

/** Failed attempts for one URL: 1 while the retry waits, 2 once it failed too. */
interface Failure {
  url: string;
  attempt: number;
}

/**
 * Artwork on a tint box of the same size and radius. The box is the loading and the failed state,
 * so nothing moves when the image arrives or never does. One retry after 250 ms, then the box stays.
 */
export function Cover({ src, size, shape = "square", radius, alt = "", fetchPriority }: CoverProps): JSX.Element {
  const url = coverSrc(src, size, window.devicePixelRatio);
  const [failure, setFailure] = useState<Failure | null>(null);
  const attempt = failure?.url === url ? failure.attempt : 0;

  const style = {
    width: size,
    height: size,
    borderRadius: shape === "circle" ? "50%" : (radius ?? coverRadius(size)),
  };

  return (
    <span className={styles.cover} style={style}>
      {url && attempt < 2 ? (
        <img
          key={attempt}
          ref={showIfCached}
          className={styles.image}
          src={url}
          alt={alt}
          width={size}
          height={size}
          loading="lazy"
          decoding="async"
          fetchPriority={fetchPriority}
          draggable={false}
          onLoad={(event) => {
            event.currentTarget.dataset.loaded = "";
          }}
          onError={() => {
            const next = { url, attempt: attempt + 1 };
            if (next.attempt < 2) window.setTimeout(() => setFailure(next), RETRY_MS);
            else setFailure(next);
          }}
        />
      ) : null}
    </span>
  );
}

// a cover already in memory (scrolling back, a virtual row remounting) shows at once instead of fading again
function showIfCached(image: HTMLImageElement | null) {
  if (image?.complete && image.naturalWidth > 0) image.dataset.loaded = "";
}
