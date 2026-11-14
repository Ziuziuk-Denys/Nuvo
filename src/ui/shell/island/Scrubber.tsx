import { useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type JSX, type KeyboardEvent, type PointerEvent } from "react";
import { useTranslation } from "../../ports/i18n";
import { playerEngine } from "../../ports/player";
import { isWindowVisible, onWindowVisibilityChange } from "../../ports/window";
import styles from "./Scrubber.module.css";

const ARROW_MS = 5_000;
const PAGE_MS = 30_000;
const KEY_STEP: Record<string, number> = {
  ArrowRight: ARROW_MS,
  ArrowUp: ARROW_MS,
  ArrowLeft: -ARROW_MS,
  ArrowDown: -ARROW_MS,
  PageUp: PAGE_MS,
  PageDown: -PAGE_MS,
};

export function formatTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

interface ScrubberProps {
  positionMs: number;
  durationMs: number;
  tint: string;
  loop?: { a: number | null; b: number | null };
}

export function Scrubber({ positionMs, durationMs, tint, loop }: ScrubberProps): JSX.Element {
  const { t } = useTranslation();
  const [dragMs, setDragMs] = useState<number | null>(null);

  const duration = Math.max(0, durationMs);
  const position = dragMs ?? Math.min(positionMs, duration);
  const fraction = duration > 0 ? Math.min(1, Math.max(0, position / duration)) : 0;
  // Background throttling is off for playback, so a minimised window still draws: hold the line
  const visible = useSyncExternalStore(onWindowVisibilityChange, isWindowVisible);
  const shown = useRef(fraction);
  useLayoutEffect(() => {
    if (visible) shown.current = fraction;
  });
  const drawn = visible ? fraction : shown.current;
  const share = (ms: number) => `${Math.round(Math.min(1, Math.max(0, ms / duration)) * 10_000) / 100}%`;
  const loopA = duration > 0 ? (loop?.a ?? null) : null;
  const loopB = loopA !== null ? (loop?.b ?? null) : null;
  const loopText =
    loopA === null
      ? null
      : loopB === null
        ? t("ui.island.loop_start", { from: formatTime(loopA) })
        : t("ui.island.loop", { from: formatTime(loopA), to: formatTime(loopB) });

  const at = (event: PointerEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = rect.width > 0 ? (event.clientX - rect.left) / rect.width : 0;
    return Math.round(Math.min(1, Math.max(0, ratio)) * duration);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const step = KEY_STEP[event.key];
    if (step === undefined || duration <= 0) return;
    event.preventDefault();
    playerEngine.seek(Math.min(duration, Math.max(0, positionMs + step)));
  };

  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label={t("ui.island.seek")}
      aria-valuemin={0}
      aria-valuemax={Math.round(duration / 1000)}
      aria-valuenow={Math.round(position / 1000)}
      aria-valuetext={`${formatTime(position)} / ${formatTime(duration)}${loopText ? `, ${loopText}` : ""}`}
      className={styles.scrubber}
      data-dragging={dragMs !== null ? "" : undefined}
      onPointerDown={(event) => {
        if (duration <= 0 || event.button !== 0) return;
        event.currentTarget.setPointerCapture?.(event.pointerId);
        setDragMs(at(event));
      }}
      onPointerMove={(event) => {
        if (dragMs !== null) setDragMs(at(event));
      }}
      onPointerUp={(event) => {
        if (dragMs === null) return;
        setDragMs(null);
        playerEngine.seek(at(event));
      }}
      onPointerCancel={() => setDragMs(null)}
      onKeyDown={onKeyDown}
    >
      <span className={styles.fill} style={{ transform: `translateX(${(drawn - 1) * 100}%)`, "--tint": tint } as CSSProperties} />
      {loopA !== null ? (
        <span
          className={styles.loop}
          data-testid="ab-loop"
          title={loopText ?? undefined}
          style={{ left: share(loopA), width: loopB === null ? 0 : `calc(${share(loopB)} - ${share(loopA)})`, color: tint }}
        />
      ) : null}
    </div>
  );
}
