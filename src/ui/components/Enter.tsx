import { useEffect, useState, type AnimationEvent, type CSSProperties, type JSX, type ReactNode } from "react";
import { MAX_STAGGERED } from "../motion";

const visited = new Set<string>();

export function useFirstVisit(screen: string): boolean {
  // read in the initialiser and written in the effect, so a StrictMode double render keeps the answer
  const [first] = useState(() => !visited.has(screen));
  useEffect(() => {
    visited.add(screen);
  }, [screen]);
  return first;
}

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
