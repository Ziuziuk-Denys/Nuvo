import { useEffect, useRef, type JSX } from "react";
import styles from "./Glow.module.css";

const WIDTH = 64;
const HEIGHT = 36;

export function Glow({ foot, onMirror }: { foot: [number, number, number] | null; onMirror(canvas: HTMLCanvasElement | null): void }): JSX.Element {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    // a canvas can be handed to the stage worker only once, so each mount makes its own
    const canvas = Object.assign(document.createElement("canvas"), { width: WIDTH, height: HEIGHT });
    element.append(canvas);
    onMirror(canvas);
    return () => {
      onMirror(null);
      canvas.remove();
    };
  }, [onMirror]);

  return (
    <div
      className={styles.field}
      style={{ backgroundColor: foot ? `color-mix(in oklab, rgb(${foot.join(" ")}) 40%, var(--s-bg))` : undefined }}
      aria-hidden="true"
    >
      <div ref={host} className={styles.cover} />
    </div>
  );
}
