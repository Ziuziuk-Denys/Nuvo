import { useEffect, useState, type AnimationEvent, type CSSProperties, type JSX, type ReactNode } from "react";
import { MAX_STAGGERED } from "../motion";

/** Screens that have already played their entrance in this session. */
const visited = new Set<string>();

/**
 * True while this mount is the screen's first in the session. Sections that mount together share
 * the answer; the screen counts as visited once they have mounted, so a return renders plain.
 */
export function useFirstVisit(screen: string): boolean {
  // read in the initialiser and written in the effect, so a StrictMode double render keeps the answer
  const [first] = useState(() => !visited.has(screen));
  useEffect(() => {
    visited.add(screen);
  }, [screen]);
  return first;
}

/**
 * One section of a screen. On the first visit it rises and fades in, staggered by its index
 * (capped at the sixth); the class is dropped when the animation ends, so no layer stays promoted.
 */
export function Enter({ index, screen, children }: { index: number; screen: string; children: ReactNode }): JSX.Element {
  const first = useFirstVisit(screen);
  const [done, setDone] = useState(false);

  if (!first || done) return <div>{children}</div>;

  const style = { "--n-i": Math.min(Math.max(index, 0), MAX_STAGGERED - 1) } as CSSProperties;
  const onAnimationEnd = (event: AnimationEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) setDone(true);
  };

  return (
    <div className="n-enter" style={style} onAnimationEnd={onAnimationEnd}>
      {children}
    </div>
  );
}
