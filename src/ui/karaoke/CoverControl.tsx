import { useRef, type JSX, type PointerEvent, type WheelEvent } from "react";
import { Cover } from "../components/Cover";
import { MorphPlayIcon } from "../components/MorphPlayIcon";
import { playerEngine, toVolumeGain, toVolumeLevel, usePlayerStore } from "../ports/player";
import styles from "./Karaoke.module.css";

const LEVEL_PER_PIXEL = 0.0004;
const PIXELS_PER_LINE = 40;

export function CoverControl({ src, playing }: { src: string; playing: boolean }): JSX.Element {
  const glyph = useRef<HTMLSpanElement>(null);
  const volume = useRef<HTMLSpanElement>(null);
  const wakingTap = useRef(false);
  const level = usePlayerStore((state) => toVolumeLevel(state.volume ?? 1));

  const show = (element: HTMLElement | null, holdMs: number) => {
    for (const mark of [glyph.current, volume.current]) mark?.getAnimations().forEach((animation) => animation.cancel());
    element?.animate({ opacity: [1, 1, 0], offset: [0, 0.55, 1] }, { duration: holdMs, easing: "cubic-bezier(0.2, 0.7, 0.2, 1)" });
  };
  const onPointerDown = (event: PointerEvent) => {
    wakingTap.current = event.pointerType !== "mouse" && event.currentTarget.closest("[data-rest]") !== null;
  };
  const toggle = () => {
    if (wakingTap.current) return;
    void playerEngine.togglePlayPause();
    show(glyph.current, 620);
  };
  const onWheel = (event: WheelEvent) => {
    const pixels = event.deltaMode === 0 ? event.deltaY : event.deltaY * PIXELS_PER_LINE;
    const now = toVolumeLevel(usePlayerStore.getState().volume ?? 1);
    playerEngine.setVolume(toVolumeGain(Math.min(1, Math.max(0, now - pixels * LEVEL_PER_PIXEL))));
    show(volume.current, 1_100);
  };

  return (
    <div className={styles.cover} aria-hidden="true" onPointerDownCapture={onPointerDown} onClick={toggle} onWheel={onWheel} data-no-window-drag>
      <Cover src={src} size={400} radius={12} />
      <span ref={glyph} className={styles.mark}>
        <MorphPlayIcon playing={playing} size={72} />
      </span>
      <span ref={volume} className={styles.mark}>
        {Math.round(level * 100)}
      </span>
    </div>
  );
}
