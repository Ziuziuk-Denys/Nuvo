import { useEffect, useId, useRef, type JSX, type ReactNode } from "react";
import { useThemeMode } from "../../../ports/theme";
import { floorOf, place, ringFor } from "./ring";
import { createRoom, type Room, type RoomCard } from "./room";
import styles from "./EmptyRoom.module.css";

const RING_HEIGHT = 330;
const HEIGHT = 380;
const CLEAR_TOP = 40;
const SLABS = 9;

function slabs(ring: ReturnType<typeof ringFor>): RoomCard[] {
  return Array.from({ length: SLABS }, (_, slot) => slot - (SLABS - 1) / 2).flatMap((offset) => {
    const spot = place(ring, offset);
    return spot ? [{ slot: 0, offset, spot }] : [];
  });
}

function paint(room: Room, width: number, light: boolean): void {
  const ring = ringFor(width, RING_HEIGHT, CLEAR_TOP);
  room.draw({ ring, floor: floorOf(ring), cards: slabs(ring), lean: 0, tilt: { x: 0, y: 0, amount: 0 }, light }, 0);
}

export function EmptyRoom({ title, message, children }: { title: string; message?: string; children?: ReactNode }): JSX.Element {
  const light = useThemeMode() === "light";
  const stage = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    const canvas = document.createElement("canvas");
    stage.current!.append(canvas);
    const room = createRoom(canvas, () => undefined);
    const observer = new ResizeObserver(([entry]) => {
      const { width } = entry.contentRect;
      if (!room || width === 0) return;
      room.resize(width, HEIGHT, window.devicePixelRatio);
      paint(room, width, light);
    });
    observer.observe(stage.current!);
    return () => {
      observer.disconnect();
      room?.dispose();
      canvas.remove();
    };
  }, [light]);
  return (
    <section className={styles.empty} aria-labelledby={titleId} data-empty-state="">
      <h2 id={titleId} className={styles.title}>
        {title}
      </h2>
      {message ? <p className={styles.message}>{message}</p> : null}
      <div ref={stage} className={styles.stage} style={{ height: HEIGHT }} aria-hidden="true" />
      <div className={styles.below}>{children}</div>
    </section>
  );
}
