import { useEffect, useId, useRef, type JSX, type ReactNode } from "react";
import { useLook } from "../../../ports/theme";
import { floorOf, place, ringFor } from "./ring";
import { createRoom, type Room, type RoomCard } from "./room";
import styles from "./EmptyRoom.module.css";

const RING_HEIGHT = 330;
const HEIGHT = 340;
const CLEAR_TOP = 40;
const SLABS = 3;

function slabs(ring: ReturnType<typeof ringFor>): RoomCard[] {
  return Array.from({ length: SLABS }, (_, slot) => slot - (SLABS - 1) / 2).flatMap((offset) => {
    const spot = place(ring, offset);
    return spot ? [{ slot: 0, offset, spot }] : [];
  });
}

function paperOf(stage: HTMLElement): [number, number, number] {
  const context = document.createElement("canvas").getContext("2d")!;
  context.fillStyle = getComputedStyle(stage).color;
  context.fillRect(0, 0, 1, 1);
  const [red, green, blue] = context.getImageData(0, 0, 1, 1).data;
  return [red / 255, green / 255, blue / 255];
}

function paint(room: Room, stage: HTMLElement, width: number, light: boolean): void {
  const ring = ringFor(width, RING_HEIGHT, CLEAR_TOP);
  room.draw({ ring, floor: floorOf(ring), cards: slabs(ring), lean: 0, tilt: { x: 0, y: 0, amount: 0 }, light, paper: paperOf(stage) }, 0);
}

function Frames(): JSX.Element {
  const { preset, mode } = useLook();
  const light = mode === "light";
  const stage = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = stage.current!;
    const canvas = document.createElement("canvas");
    host.append(canvas);
    const room = createRoom(canvas, () => undefined);
    const observer = new ResizeObserver(([entry]) => {
      const { width } = entry.contentRect;
      if (!room || width === 0) return;
      room.resize(width, HEIGHT, window.devicePixelRatio);
      paint(room, host, width, light);
    });
    observer.observe(host);
    return () => {
      observer.disconnect();
      room?.dispose();
      canvas.remove();
    };
  }, [light, preset]);
  return <div ref={stage} className={styles.frames} aria-hidden="true" />;
}

interface EmptyRoomProps {
  title: string;
  message?: string;
  stage?: ReactNode;
  children?: ReactNode;
}

export function EmptyRoom({ title, message, stage = <Frames />, children }: EmptyRoomProps): JSX.Element {
  const titleId = useId();
  return (
    <section className={styles.empty} aria-labelledby={titleId} data-empty-state="">
      <h2 id={titleId} className={styles.title}>
        {title}
      </h2>
      {message ? <p className={styles.message}>{message}</p> : null}
      <div className={styles.stage} style={{ minHeight: HEIGHT }}>
        {stage}
      </div>
      <div className={styles.below}>{children}</div>
    </section>
  );
}
