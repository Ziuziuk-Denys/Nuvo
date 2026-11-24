import { useEffect, useLayoutEffect, useMemo, useRef, useState, type JSX, type KeyboardEvent, type PointerEvent } from "react";
import { Cover } from "../../../components/Cover";
import { useReducedEffects } from "../../../effects";
import { addLightObjects, lightMoved } from "../../../light/objects";
import { usePageBackdrop } from "../../../ports/backdrop";
import { playSongs } from "../../../ports/homeShelves";
import { coverSrc } from "../../../ports/covers";
import type { Track } from "../../../ports/recs";
import { useLook } from "../../../ports/theme";
import look from "../../look.module.css";
import { floorOf, PERSPECTIVE, place, ringFor, ringHeight, ringOffset, ringSlots } from "./ring";
import { createRoom, type Room, type RoomCard } from "./room";
import { ArtistLinks } from "../../../shell/ArtistLinks";
import styles from "./DiscoverArc.module.css";

const FLOOR_ROOM = 20;
const COMPACT_HEIGHT = 330;
const CAPTION_ROOM = 84;
const CLEAR_TOP = 64;
const STIFFNESS = 15;
const LONGEST_STEP_S = 1 / 30;
const DETENT = 0.45;
const LANDING = 1.4;
const LEAN_PER_SPEED = 1.6;
const MAX_LEAN = 9;
const POINTER_TILT = 5;
const TILT_MS = 140;
const UNTILT_MS = 420;
const WHEEL_PER_TRACK = 100;
const WHEEL_SETTLE_MS = 140;
const DRAG_SLOP = 4;
const THROW_MS = 240;
const CONTEXT = "home:discover";
const STARTER_CONTEXT = "home:starter";

interface Drag {
  x: number;
  from: number;
  moved: boolean;
  lastX: number;
  lastAt: number;
  velocity: number;
}

export function DiscoverArc({ tracks, title, compact = false }: { tracks: Track[]; title: string; compact?: boolean }): JSX.Element {
  const reduced = useReducedEffects();
  const light = useLook().mode === "light";
  const rootRef = useRef<HTMLElement>(null);
  const items = useRef<Array<HTMLLIElement | null>>([]);
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const position = useRef(0);
  const speed = useRef(0);
  const target = useRef(0);
  const frame = useRef(0);
  const drag = useRef<Drag | null>(null);
  const swallowClick = useRef(false);
  const hover = useRef({ x: 0, y: 0, on: false, tilt: { x: 0, y: 0, amount: 0 } });
  const placed = useRef<RoomCard[]>([]);
  const stageRef = useRef<HTMLDivElement>(null);
  const room = useRef<Room | null>(null);
  const [width, setWidth] = useState(0);
  const [centre, setCentre] = useState(0);
  const [settled, setSettled] = useState(0);
  const count = ringSlots(tracks.length);
  const slots = useMemo(() => Array.from({ length: count }, (_, slot) => tracks[slot % tracks.length]), [count, tracks]);
  const ring = useMemo(() => (compact ? ringFor(width, COMPACT_HEIGHT, 0) : ringFor(width, ringHeight(width), CLEAR_TOP)), [compact, width]);
  const height = compact ? floorOf(ring) + CAPTION_ROOM : ringHeight(width) + FLOOR_ROOM;
  const wrap = (index: number) => ((index % count) + count) % count;

  const paint = (now = performance.now()): boolean => {
    const shown = position.current - (reduced ? 0 : (DETENT * Math.sin(2 * Math.PI * position.current)) / (2 * Math.PI));
    const cards: RoomCard[] = [];
    items.current.forEach((item, index) => {
      if (!item) return;
      const offset = ringOffset(index, shown, count);
      const spot = width > 0 ? place(ring, offset) : null;
      item.style.visibility = spot ? "" : "hidden";
      if (!spot) return;
      item.style.zIndex = String(100 - Math.round(Math.abs(offset) * 4));
      item.style.transform = `translate(${spot.x - ring.cover / 2}px, ${spot.y - ring.cover / 2}px) scale(${spot.scale}) perspective(${PERSPECTIVE}px) rotateY(${spot.turn}deg) rotateZ(${spot.tilt}rad)`;
      item.style.opacity = String(spot.shown);
      cards.push({ slot: index, offset, spot });
    });
    placed.current = cards;
    lightMoved();
    if (!room.current || width === 0) return false;
    if (cards.every((card) => room.current!.settled(card.slot % tracks.length))) rootRef.current?.setAttribute("data-room", "");
    return room.current.draw(
      {
        ring,
        floor: floorOf(ring),
        cards: cards.map((card) => ({ ...card, slot: card.slot % tracks.length })),
        lean: reduced ? 0 : Math.max(-MAX_LEAN, Math.min(MAX_LEAN, speed.current * LEAN_PER_SPEED)),
        tilt: reduced ? { x: 0, y: 0, amount: 0 } : hover.current.tilt,
        light,
      },
      now,
    );
  };
  const paintRef = useRef(paint);
  useLayoutEffect(() => {
    paintRef.current = paint;
    paint();
  });

  const run = () => {
    if (frame.current) return;
    let last = performance.now();
    const tick = (now: number) => {
      const step = Math.min(LONGEST_STEP_S, (now - last) / 1000);
      const gap = target.current - position.current;
      if (reduced || (Math.abs(gap) < 0.0008 && Math.abs(speed.current) < 0.01)) {
        position.current = target.current;
        speed.current = 0;
      } else if (drag.current?.moved) {
        speed.current += (drag.current.velocity * 1000 - speed.current) * (1 - Math.exp(-step / 0.05));
      } else {
        speed.current = (speed.current + step * STIFFNESS * STIFFNESS * gap) / (1 + STIFFNESS * step) ** 2;
        position.current += speed.current * step;
      }
      const { tilt, x, y, on } = hover.current;
      const ease = 1 - Math.exp(-(now - last) / (on ? TILT_MS : UNTILT_MS));
      tilt.x += ((on ? x * POINTER_TILT : 0) - tilt.x) * ease;
      tilt.y += ((on ? x * 0.883 + y * 0.469 : tilt.y) - tilt.y) * ease;
      tilt.amount += ((on ? 1 : 0) - tilt.amount) * ease;
      const tilting = !reduced && (Math.abs((on ? x * POINTER_TILT : 0) - tilt.x) > 0.02 || Math.abs((on ? 1 : 0) - tilt.amount) > 0.004);
      last = now;
      const fading = paintRef.current(now);
      setCentre(wrap(Math.round(position.current)));
      const resting = position.current === target.current && !drag.current?.moved;
      if (!drag.current?.moved && Math.abs(target.current - position.current) < LANDING) setSettled(wrap(Math.round(target.current)));
      frame.current = resting && !fading && !tilting ? 0 : requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
  };
  const runRef = useRef(run);
  useLayoutEffect(() => {
    runRef.current = run;
  });

  useEffect(() => {
    const root = rootRef.current!;
    const canvas = document.createElement("canvas");
    stageRef.current!.append(canvas);
    const made = createRoom(canvas, () => runRef.current());
    room.current = made;
    const lost = () => {
      room.current = null;
      root.removeAttribute("data-room");
    };
    canvas.addEventListener("webglcontextlost", lost);
    return () => {
      canvas.removeEventListener("webglcontextlost", lost);
      room.current = null;
      made?.dispose();
      canvas.remove();
    };
  }, []);

  useEffect(() => {
    if (width === 0) return;
    room.current?.resize(width, height, window.devicePixelRatio);
    tracks.forEach((track, slot) => room.current?.load(slot, coverSrc(track.coverUrl, ring.cover * 1.12, window.devicePixelRatio)));
    paintRef.current();
  }, [width, height, ring, tracks]);

  useEffect(
    () => () => {
      cancelAnimationFrame(frame.current);
    },
    [],
  );

  useEffect(
    () =>
      addLightObjects(() => {
        const frame = rootRef.current!.getBoundingClientRect();
        return placed.current.map(({ offset, spot }) => {
          const size = ring.cover * spot.scale;
          const wide = size * Math.cos((spot.turn * Math.PI) / 180);
          const away = Math.abs(offset);
          return {
            x: frame.x + spot.x - wide / 2,
            y: frame.y + spot.y - size / 2,
            width: wide,
            height: size,
            radius: 10,
            lift: 20 + away * 6,
            hero: away < 0.5,
          };
        });
      }),
    [ring],
  );

  useEffect(() => {
    const root = rootRef.current!;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(root);
    let settle = 0;
    const onWheel = (event: WheelEvent) => {
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      if (delta === 0) return;
      event.preventDefault();
      const unit = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 33 : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? WHEEL_PER_TRACK : 1;
      target.current += (delta * unit) / WHEEL_PER_TRACK;
      clearTimeout(settle);
      settle = window.setTimeout(() => {
        target.current = Math.round(target.current);
        runRef.current();
      }, WHEEL_SETTLE_MS);
      runRef.current();
    };
    root.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      observer.disconnect();
      clearTimeout(settle);
      root.removeEventListener("wheel", onWheel);
    };
  }, []);

  const turnTo = (index: number) => {
    target.current = Math.round(position.current + ringOffset(index, position.current, count));
    run();
  };

  const point = (event: PointerEvent<HTMLElement>) => {
    const box = buttons.current[centre]?.getBoundingClientRect();
    if (!box) return;
    const x = ((event.clientX - box.left) / box.width) * 2 - 1;
    const y = ((event.clientY - box.top) / box.height) * 2 - 1;
    const on = Math.abs(x) <= 1 && Math.abs(y) <= 1;
    if (!on && !hover.current.on) return;
    Object.assign(hover.current, on ? { x, y, on } : { on });
    run();
  };
  const onPointerLeave = () => {
    hover.current.on = false;
    run();
  };

  const onPointerDown = (event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    drag.current = { x: event.clientX, from: position.current, moved: false, lastX: event.clientX, lastAt: event.timeStamp, velocity: 0 };
  };
  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    const now = drag.current;
    if (!now?.moved) point(event);
    if (!now) return;
    const dx = event.clientX - now.x;
    if (!now.moved && Math.abs(dx) < DRAG_SLOP) return;
    if (!now.moved) {
      now.moved = true;
      rootRef.current?.setAttribute("data-dragging", "");
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    const perTrack = ring.radius * ring.step;
    const elapsed = Math.max(1, event.timeStamp - now.lastAt);
    now.velocity = (now.lastX - event.clientX) / perTrack / elapsed;
    now.lastX = event.clientX;
    now.lastAt = event.timeStamp;
    position.current = now.from - dx / perTrack;
    target.current = position.current;
    run();
  };
  const onPointerUp = () => {
    const now = drag.current;
    drag.current = null;
    rootRef.current?.removeAttribute("data-dragging");
    if (!now?.moved) return;
    swallowClick.current = true;
    target.current = Math.round(position.current + now.velocity * THROW_MS);
    run();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    target.current = Math.round(target.current) + step;
    buttons.current[wrap(target.current)]?.focus({ preventScroll: true });
    run();
  };

  const choose = (index: number) => {
    if (swallowClick.current) {
      swallowClick.current = false;
      return;
    }
    if (index !== centre) turnTo(index);
    playSongs(tracks, index % tracks.length, compact ? STARTER_CONTEXT : CONTEXT);
  };

  const current = slots[Math.min(centre, count - 1)];
  usePageBackdrop(slots[Math.min(settled, count - 1)].coverUrl, { scene: "room" });
  return (
    <section ref={rootRef} className={styles.arc} data-arc="" style={{ height }}>
      {compact ? null : <h1 className={`${look.pageTitle} ${styles.heading}`}>{title}</h1>}
      <div ref={stageRef} className={styles.room} aria-hidden="true" />
      <ul
        className={styles.ring}
        aria-label={title}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={onPointerLeave}
      >
        {slots.map((track, index) => (
          <li
            key={`${track.id}:${index}`}
            ref={(node) => {
              items.current[index] = node;
            }}
            className={styles.item}
            style={{ width: ring.cover, height: ring.cover }}
          >
            <button
              ref={(node) => {
                buttons.current[index] = node;
              }}
              type="button"
              className={styles.cover}
              aria-label={`${track.title}, ${track.artists}`}
              aria-current={index === centre ? "true" : undefined}
              tabIndex={index === centre ? 0 : -1}
              onClick={() => choose(index)}
            >
              <Cover src={track.coverUrl} size={ring.cover} radius={10} fetchPriority={index === centre ? "high" : "low"} />
            </button>
          </li>
        ))}
      </ul>
      <p className={styles.caption} style={{ top: floorOf(ring) + 20 }}>
        <span className={styles.title} aria-hidden="true">
          {current.title}
        </span>
        <span className={styles.artist}>
          <ArtistLinks track={current} focusable />
        </span>
      </p>
    </section>
  );
}
