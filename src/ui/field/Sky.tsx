import { useMemo, type JSX } from "react";
import { Backdrop } from "../karaoke/backdrop/Backdrop";
import { SKY } from "./skyShader";
import styles from "./Field.module.css";

const SKY_FPS = navigator.hardwareConcurrency >= 8 ? 30 : 20;

let layer: HTMLDivElement | null = null;
let place = { bottom: 0, height: 0 };

function apply(): void {
  if (!layer || place.height === 0) return;
  const height = `${place.height}px`;
  if (layer.style.height !== height) layer.style.height = height;
  layer.style.transform = `translateY(${place.bottom - place.height}px)`;
}

export function moveSky(bottom: number, height: number): void {
  place = { bottom, height };
  apply();
}

export function Sky({ cover, mode, dark }: { cover: string; mode: "live" | "still"; dark: boolean }): JSX.Element {
  const uniforms = useMemo(() => ({ dark: [dark ? 1 : 0] }), [dark]);
  return (
    <div
      ref={(node) => {
        layer = node;
        apply();
      }}
      className={styles.sky}
    >
      <Backdrop cover={cover} open={mode === "live"} fps={SKY_FPS} overlay={SKY} uniforms={uniforms} />
    </div>
  );
}
