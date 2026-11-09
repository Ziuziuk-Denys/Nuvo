import { useCallback, useEffect, useState } from "react";

export interface Selection {
  keys: ReadonlySet<string>;
  anchor: number | null;
}

export const emptySelection: Selection = { keys: new Set(), anchor: null };

interface Modifiers {
  shift?: boolean;
  ctrl?: boolean;
}

function range(order: readonly string[], from: number, to: number): string[] {
  return order.slice(Math.min(from, to), Math.max(from, to) + 1);
}

export function pickRow(selection: Selection, order: readonly string[], index: number, modifiers: Modifiers): Selection {
  const key = order[index];
  if (key === undefined) return selection;
  if (modifiers.shift) {
    const keys = new Set(modifiers.ctrl ? selection.keys : []);
    for (const item of range(order, selection.anchor ?? index, index)) keys.add(item);
    return { keys, anchor: selection.anchor ?? index };
  }
  if (modifiers.ctrl) {
    const keys = new Set(selection.keys);
    if (!keys.delete(key)) keys.add(key);
    return { keys, anchor: index };
  }
  if (selection.keys.size === 0) return selection;
  return { keys: new Set([key]), anchor: index };
}

export function stepSelection(selection: Selection, order: readonly string[], from: number, direction: 1 | -1): Selection {
  const to = Math.min(order.length - 1, Math.max(0, from + direction));
  const anchor = selection.anchor ?? from;
  return { keys: new Set(range(order, anchor, to)), anchor };
}

export function selectAll(order: readonly string[]): Selection {
  return { keys: new Set(order), anchor: order.length ? 0 : null };
}

export function dropMissing(selection: Selection, order: readonly string[]): Selection {
  if (selection.keys.size === 0) return selection;
  const present = new Set(order);
  const kept = [...selection.keys].filter((key) => present.has(key));
  return kept.length === selection.keys.size ? selection : { keys: new Set(kept), anchor: null };
}

export interface TrackSelection {
  keys: ReadonlySet<string>;
  onPick(index: number, modifiers: Modifiers): void;
  onStep(index: number, direction: 1 | -1): number;
  onAll(): void;
  clear(): void;
}

export function useTrackSelection(order: readonly string[]): TrackSelection {
  const [selection, setSelection] = useState<Selection>(emptySelection);
  const signature = order.join("\u0000");
  useEffect(() => setSelection((current) => dropMissing(current, order)), [signature]); // eslint-disable-line react-hooks/exhaustive-deps
  const onPick = useCallback((index: number, modifiers: Modifiers) => setSelection((current) => pickRow(current, order, index, modifiers)), [signature]); // eslint-disable-line react-hooks/exhaustive-deps
  const onStep = useCallback(
    (index: number, direction: 1 | -1) => {
      setSelection((current) => stepSelection(current, order, index, direction));
      return Math.min(order.length - 1, Math.max(0, index + direction));
    },
    [signature], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const onAll = useCallback(() => setSelection(selectAll(order)), [signature]); // eslint-disable-line react-hooks/exhaustive-deps
  const clear = useCallback(() => setSelection(emptySelection), []);
  return { keys: selection.keys, onPick, onStep, onAll, clear };
}
