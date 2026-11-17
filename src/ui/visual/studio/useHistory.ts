import { useState } from "react";

const DEPTH = 50;

export function useHistory<T>(current: T, apply: (value: T) => void) {
  const [past, setPast] = useState<T[]>([]);
  const [future, setFuture] = useState<T[]>([]);
  return {
    canUndo: past.length > 0,
    canRedo: future.length > 0,
    commit(next: T) {
      setPast((list) => [...list, current].slice(-DEPTH));
      setFuture([]);
      apply(next);
    },
    undo() {
      const previous = past.at(-1);
      if (previous === undefined) return;
      setPast(past.slice(0, -1));
      setFuture([current, ...future]);
      apply(previous);
    },
    redo() {
      const next = future[0];
      if (next === undefined) return;
      setFuture(future.slice(1));
      setPast([...past, current]);
      apply(next);
    },
  };
}
