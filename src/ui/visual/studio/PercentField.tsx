import { useState, type JSX } from "react";
import styles from "./Inspector.module.css";

const toPercent = (value: number, min: number, max: number) => Math.round(((value - min) / (max - min)) * 100);

export function PercentField({
  value,
  min,
  max,
  label,
  limits = [0, 100],
  onCommit,
}: {
  value: number;
  min: number;
  max: number;
  label: string;
  limits?: [number, number];
  onCommit(next: number): void;
}): JSX.Element {
  const shown = String(toPercent(value, min, max));
  const [draft, setDraft] = useState<string | null>(null);

  const commit = () => {
    if (draft === null) return;
    const parsed = Number.parseInt(draft, 10);
    setDraft(null);
    if (Number.isNaN(parsed)) return;
    onCommit(min + (Math.min(limits[1], Math.max(limits[0], parsed)) / 100) * (max - min));
  };

  return (
    <input
      className={styles.number}
      inputMode="numeric"
      aria-label={label}
      value={draft ?? shown}
      onChange={(event) => setDraft(event.currentTarget.value.replace(/\D/g, "").slice(0, 3))}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") commit();
        if (event.key === "Escape") setDraft(null);
      }}
    />
  );
}
