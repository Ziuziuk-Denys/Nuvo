import { useEffect, useRef, useState, type JSX, type PointerEvent } from "react";
import { Cover } from "../components/Cover";
import { useReducedEffects } from "../effects";
import { coverRadius } from "../geometry";
import { coverSrc } from "../ports/covers";
import styles from "./CoverObject.module.css";

export interface CoverObjectProps {
  src: string;
  size: number;
  radius?: number;
  alt?: string;
  className?: string;
}

const TILT_DEG = 5;

interface Face {
  src: string;
  id: number;
}

function useFaces(src: string, size: number): { faces: Face[]; settle: () => void } {
  const [faces, setFaces] = useState<Face[]>([{ src, id: 0 }]);
  const last = useRef(src);
  useEffect(() => {
    if (src === last.current) return;
    let live = true;
    const show = () => {
      if (!live) return;
      last.current = src;
      setFaces((now) => [...now.slice(-1), { src, id: now[now.length - 1].id + 1 }]);
    };
    const picture = new Image();
    picture.src = coverSrc(src, size, window.devicePixelRatio);
    picture.onload = show;
    picture.onerror = show;
    return () => {
      live = false;
    };
  }, [src, size]);
  return { faces, settle: () => setFaces((now) => now.slice(-1)) };
}

export function CoverObject({ src, size, radius = coverRadius(size), alt = "", className }: CoverObjectProps): JSX.Element {
  const body = useRef<HTMLSpanElement>(null);
  const reduced = useReducedEffects();
  const { faces, settle } = useFaces(src, size);

  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    if (reduced || event.pointerType === "touch") return;
    const box = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - box.x) / box.width - 0.5;
    const y = (event.clientY - box.y) / box.height - 0.5;
    const style = body.current!.style;
    style.setProperty("--tilt", `rotateX(${(-y * 2 * TILT_DEG).toFixed(2)}deg) rotateY(${(x * 2 * TILT_DEG).toFixed(2)}deg)`);
    style.setProperty("--sweep", `${((x + y) * 60).toFixed(1)}%`);
  };
  const onPointerLeave = () => body.current?.style.removeProperty("--tilt");

  return (
    <span
      className={className ? `${styles.object} ${className}` : styles.object}
      style={{ width: size, height: size, borderRadius: radius }}
      data-live={reduced ? undefined : ""}
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
    >
      <span ref={body} className={styles.body}>
        <span className={styles.slab} />
        <span className={styles.front}>
          {faces.map((face, i) => (
            <span key={face.id} className={styles.face} data-turning={i > 0 && !reduced ? "" : undefined} onAnimationEnd={settle}>
              <span className={styles.picture}>
                <Cover src={face.src} size={size} radius={0} alt={alt} fetchPriority="high" />
              </span>
              <span className={styles.ray} />
            </span>
          ))}
          <span className={styles.sweep} />
          <span className={styles.edge} />
        </span>
      </span>
    </span>
  );
}
