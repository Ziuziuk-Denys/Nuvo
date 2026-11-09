import { useState, type JSX } from "react";
import { coverRadius } from "../geometry";
import { coverSrc } from "../ports/covers";
import styles from "./Cover.module.css";

export interface CoverProps {
  src: string;
  size: number;
  shape?: "square" | "circle";
  radius?: number;
  alt?: string;
  fetchPriority?: "low" | "high" | "auto";
}

/** The daemon already tried every source variant, so one late retry is enough. */
const RETRY_MS = 250;

interface Failure {
  url: string;
  attempt: number;
}

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

function showIfCached(image: HTMLImageElement | null) {
  if (image?.complete && image.naturalWidth > 0) image.dataset.loaded = "";
}
