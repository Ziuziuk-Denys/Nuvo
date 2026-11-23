import { useEffect, useLayoutEffect, useMemo, useRef, useState, type JSX, type KeyboardEvent, type PointerEvent, type RefObject } from "react";
import { Cover } from "../../../components/Cover";
import { useReducedEffects } from "../../../effects";
import { moveSky } from "../../../field/Sky";
import { usePageBackdrop } from "../../../ports/backdrop";
import { playSongs } from "../../../ports/homeShelves";
import { useTranslation } from "../../../ports/i18n";
import type { Track } from "../../../ports/recs";
import { ShelfHeading } from "../ShelfHeading";
import { PERSPECTIVE, place, ringFor, ringOffset, ringSlots } from "./ring";
import { ArtistLinks } from "../../../shell/ArtistLinks";
import styles from "./DiscoverArc.module.css";

const HEIGHT = 460;
const CLEAR_TOP = 64;
const SETTLE_MS = 110;
const WHEEL_PER_TRACK = 100;
const WHEEL_SETTLE_MS = 140;
const DRAG_SLOP = 4;
const INERTIA_MS = 220;
const CONTEXT = "home:discover";

interface Drag {
  x: number;
  from: number;
  moved: boolean;
  lastX: number;
  lastAt: number;
  velocity: number;
}

function useWindowFocused(): boolean {
  const [focused, setFocused] = useState(() => document.hasFocus());
  useEffect(() => {
    const on = () => setFocused(true);
    const off = () => setFocused(false);
    window.addEventListener("focus", on);
    window.addEventListener("blur", off);
    return () => {
      window.removeEventListener("focus", on);
      window.removeEventListener("blur", off);
    };
  }, []);
  return focused;
}

function useOnScreen(target: RefObject<HTMLElement | null>): boolean {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const node = target.current;
    if (!node) return;
    const observer = new IntersectionObserver(([entry]) => setShown(entry.isIntersecting));
    observer.observe(node);
    return () => observer.disconnect();
  }, [target]);
  return shown;
}

function scrollParent(node: HTMLElement): HTMLElement | null {
  let parent = node.parentElement;
  while (parent && !/(auto|scroll)/.test(getComputedStyle(parent).overflowY)) parent = parent.parentElement;
  return parent;
}

export function DiscoverArc({ tracks }: { tracks: Track[] }): JSX.Element {
  const { t } = useTranslation();
  const reduced = useReducedEffects();
  const rootRef = useRef<HTMLElement>(null);
  const items = useRef<Array<HTMLLIElement | null>>([]);
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const position = useRef(0);
  const target = useRef(0);
  const frame = useRef(0);
  const drag = useRef<Drag | null>(null);
  const swallowClick = useRef(false);
  const [width, setWidth] = useState(0);
  const [centre, setCentre] = useState(0);
  const [settled, setSettled] = useState(0);
  const onScreen = useOnScreen(rootRef);
  const focused = useWindowFocused();
  const count = ringSlots(tracks.length);
  const slots = useMemo(() => Array.from({ length: count }, (_, slot) => tracks[slot % tracks.length]), [count, tracks]);
  const ring = useMemo(() => ringFor(width, HEIGHT, CLEAR_TOP), [width]);
  const wrap = (index: number) => ((index % count) + count) % count;

  const paint = () => {
    items.current.forEach((item, index) => {
      if (!item) return;
      const offset = ringOffset(index, position.current, count);
      const spot = width > 0 ? place(ring, offset) : null;
      item.style.visibility = spot ? "" : "hidden";
      if (!spot) return;
      item.style.zIndex = String(100 - Math.round(Math.abs(offset) * 4));
      item.style.transform = `translate(${spot.x - ring.cover / 2}px, ${spot.y - ring.cover / 2}px) scale(${spot.scale}) perspective(${PERSPECTIVE}px) rotateY(${spot.turn}deg) rotateZ(${spot.tilt}rad)`;
    });
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
      const gap = target.current - position.current;
      position.current = reduced || Math.abs(gap) < 0.001 ? target.current : position.current + gap * (1 - Math.exp(-(now - last) / SETTLE_MS));
      last = now;
      paintRef.current();
      setCentre(wrap(Math.round(position.current)));
      const resting = position.current === target.current && !drag.current?.moved;
      if (resting) setSettled(wrap(target.current));
      frame.current = resting ? 0 : requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
  };
  const runRef = useRef(run);
  useLayoutEffect(() => {
    runRef.current = run;
  });

  useEffect(
    () => () => {
      cancelAnimationFrame(frame.current);
    },
    [],
  );

  useEffect(() => {
    const root = rootRef.current!;
    const scroller = scrollParent(root);
    const sync = () => {
      const rect = root.getBoundingClientRect();
      moveSky(rect.bottom, rect.bottom + (scroller?.scrollTop ?? 0));
    };
    sync();
    (scroller ?? window).addEventListener("scroll", sync, { passive: true });
    window.addEventListener("resize", sync);
    // the entrance lifts the section, so its edge settles only when the animation ends
    document.addEventListener("animationend", sync, true);
    return () => {
      (scroller ?? window).removeEventListener("scroll", sync);
      window.removeEventListener("resize", sync);
      document.removeEventListener("animationend", sync, true);
    };
  }, []);

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

  const onPointerDown = (event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    drag.current = { x: event.clientX, from: position.current, moved: false, lastX: event.clientX, lastAt: event.timeStamp, velocity: 0 };
  };
  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    const now = drag.current;
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
    target.current = Math.round(position.current + now.velocity * INERTIA_MS);
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
    playSongs(tracks, index % tracks.length, CONTEXT);
  };

  const current = slots[Math.min(centre, count - 1)];
  usePageBackdrop(slots[Math.min(settled, count - 1)].coverUrl, { sky: onScreen && focused ? "live" : "still" });
  const title = t("ui.recs.home.discover");
  return (
    <section ref={rootRef} className={styles.arc} data-arc="" style={{ height: HEIGHT }}>
      <div className={styles.heading}>
        <ShelfHeading icon="radio" title={title} />
      </div>
      <ul
        className={styles.ring}
        aria-label={title}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
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
      <p className={styles.caption} style={{ top: ring.centreY + (ring.cover / 2) * 1.12 + 14 }}>
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
