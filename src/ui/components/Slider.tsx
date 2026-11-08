import { useRef, type CSSProperties, type JSX, type KeyboardEvent, type PointerEvent } from "react";
import styles from "./Slider.module.css";

export interface SliderProps {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  /** The accessible name. */
  label: string;
  /** The numeral at the right and aria-valuetext. */
  format?: (value: number) => string;
}

const KNOB_PX = 14;
const PAGE_STEPS = 10;

/**
 * A 4 px track with a 14 px knob that stays inside it. The fill and the knob move by transform only,
 * so a drag repaints two layers and lays out nothing.
 */
export function Slider({ value, min, max, step, onChange, label, format }: SliderProps): JSX.Element {
  const dragging = useRef(false);
  const span = max - min;
  const progress = span > 0 ? (clamp(value, min, max) - min) / span : 0;
  const text = format ? format(value) : String(value);

  const commit = (next: number) => {
    const snapped = snap(clamp(next, min, max), min, step);
    if (snapped !== value) onChange(snapped);
  };

  const fromPointer = (event: PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const usable = box.width - KNOB_PX;
    const ratio = usable > 0 ? (event.clientX - box.left - KNOB_PX / 2) / usable : 0;
    commit(min + clamp(ratio, 0, 1) * span);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const moves: Record<string, number> = {
      ArrowRight: value + step,
      ArrowUp: value + step,
      ArrowLeft: value - step,
      ArrowDown: value - step,
      PageUp: value + step * PAGE_STEPS,
      PageDown: value - step * PAGE_STEPS,
      Home: min,
      End: max,
    };
    if (!(event.key in moves)) return;
    event.preventDefault();
    commit(moves[event.key]);
  };

  return (
    <div className={styles.slider}>
      <div
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={text}
        className={styles.control}
        style={{ "--p": progress } as CSSProperties}
        onKeyDown={onKeyDown}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          dragging.current = true;
          event.currentTarget.setPointerCapture(event.pointerId);
          fromPointer(event);
        }}
        onPointerMove={(event) => {
          if (dragging.current) fromPointer(event);
        }}
        onPointerUp={() => {
          dragging.current = false;
        }}
        onPointerCancel={() => {
          dragging.current = false;
        }}
      >
        <span className={styles.track}>
          <span className={styles.rail}>
            <span className={styles.fill} />
          </span>
        </span>
        <span className={styles.rail}>
          <span className={styles.knob} />
        </span>
      </div>
      <span className={styles.value}>{text}</span>
    </div>
  );
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}

// rounds to the step grid and drops float noise (0.1 + 0.2), keeping as many decimals as the step has
function snap(value: number, min: number, step: number): number {
  if (step <= 0) return value;
  const decimals = (String(step).split(".")[1] ?? "").length;
  return Number((min + Math.round((value - min) / step) * step).toFixed(decimals));
}
