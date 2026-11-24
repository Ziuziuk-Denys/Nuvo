import { useState, type JSX } from "react";
import { useCoverSrc } from "../ports/covers";
import styles from "./Banner.module.css";

const PORTRAIT_PX = 640;

function Picture({ src, className }: { src: string | undefined; className: string }): JSX.Element {
  const [shown, setShown] = useState(false);
  return <img className={className} src={src} alt="" draggable={false} decoding="async" data-shown={shown ? "" : undefined} onLoad={() => setShown(true)} />;
}

export function Banner({ src, portrait }: { src: string; portrait: boolean }): JSX.Element {
  const [widthPx] = useState(() => (portrait ? PORTRAIT_PX : window.innerWidth));
  const soon = useCoverSrc(src);
  const sharp = useCoverSrc(src, widthPx);
  const shape = portrait ? styles.portrait : styles.photo;
  return (
    <div className={styles.banner} data-banner={portrait ? "portrait" : "wide"}>
      <Picture src={soon} className={shape} />
      <Picture src={sharp} className={shape} />
      <div className={styles.shade} />
    </div>
  );
}
