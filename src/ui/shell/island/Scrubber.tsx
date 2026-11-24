import {
  memo,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type JSX,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { useTranslation } from "../../ports/i18n";
import { useLyrics, type Line } from "../../ports/lyrics";
import { playerEngine } from "../../ports/player";
import { useLoudnessShape } from "../../ports/sound";
import { isWindowVisible, onWindowVisibilityChange } from "../../ports/window";
import { GROOVE_HEIGHT, groovePath } from "./groovePath";
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

export function lineAt(lines: readonly Line[], ms: number): string {
  return lines.find((line) => !line.companion && line.fromMs <= ms && ms < line.toMs)?.text ?? "";
}

interface ScrubberProps {
  trackId: string;
  positionMs: number;
  durationMs: number;
  loop?: { a: number | null; b: number | null };
}

const Groove = memo(function Groove({ path }: { path: string }): JSX.Element {
  return (
    <>
      <span className={styles.hair} />
      {path ? (
        <svg className={styles.swell} viewBox={`0 0 1000 ${GROOVE_HEIGHT}`} preserveAspectRatio="none" aria-hidden="true">
          <path d={path} fill="currentColor" />
        </svg>
      ) : null}
    </>
  );
});

// the window moves and the line inside moves back, so a position update only recomposites
function Lit({ path, fraction, played = false }: { path: string; fraction: number; played?: boolean }): JSX.Element {
  return (
    <span
      className={`${styles.window} ${played ? styles.played : styles.ahead}`}
      data-played={played ? "" : undefined}
      style={{ transform: `translateX(${(fraction - 1) * 100}%)` }}
    >
      <span className={styles.still} style={{ transform: `translateX(${(1 - fraction) * 100}%)` }}>
        <Groove path={path} />
      </span>
    </span>
  );
}

export function Scrubber({ trackId, positionMs, durationMs, loop }: ScrubberProps): JSX.Element {
  const { t } = useTranslation();
  const [dragMs, setDragMs] = useState<number | null>(null);
  const [hover, setHover] = useState<{ ms: number; x: number; width: number } | null>(null);
  const lines = useLyrics((state) => (state.trackId === trackId && state.synced ? state.lines : null));

  const duration = Math.max(0, durationMs);
  const position = dragMs ?? Math.min(positionMs, duration);
  const fraction = duration > 0 ? Math.min(1, Math.max(0, position / duration)) : 0;
  // Background throttling is off for playback, so a minimised window still draws: hold the line
  const visible = useSyncExternalStore(onWindowVisibilityChange, isWindowVisible);
  const shape = useLoudnessShape(trackId, visible);
  const path = useMemo(() => groovePath(shape ?? []), [shape]);
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

  const read = (event: PointerEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = Math.min(rect.width, Math.max(0, event.clientX - rect.left));
    return { ms: rect.width > 0 ? Math.round((x / rect.width) * duration) : 0, x, width: rect.width };
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const step = KEY_STEP[event.key];
    if (step === undefined || duration <= 0) return;
    event.preventDefault();
    playerEngine.seek(Math.min(duration, Math.max(0, positionMs + step)));
  };

  const spoken = hover && lines ? lineAt(lines, hover.ms) : "";

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
      data-groove=""
      data-dragging={dragMs !== null ? "" : undefined}
      onPointerDown={(event) => {
        if (duration <= 0 || event.button !== 0) return;
        event.currentTarget.setPointerCapture?.(event.pointerId);
        setDragMs(read(event).ms);
      }}
      onPointerMove={(event) => {
        if (duration <= 0) return;
        const at = read(event);
        setHover(at);
        if (dragMs !== null) setDragMs(at.ms);
      }}
      onPointerLeave={() => setHover(null)}
      onPointerUp={(event) => {
        if (dragMs === null) return;
        setDragMs(null);
        playerEngine.seek(read(event).ms);
      }}
      onPointerCancel={() => setDragMs(null)}
      onKeyDown={onKeyDown}
    >
      <span className={styles.line} data-cut={path ? "" : undefined}>
        <span className={styles.rest}>
          <Groove path={path} />
        </span>
        {hover && dragMs === null ? <Lit path={path} fraction={hover.ms / duration} /> : null}
        <Lit path={path} fraction={drawn} played />
      </span>
      <span className={styles.track} style={{ transform: `translateX(${drawn * 100}%)` }}>
        <span className={styles.needle} />
      </span>
      {loopA !== null ? (
        <span
          className={styles.loop}
          data-testid="ab-loop"
          title={loopText ?? undefined}
          style={{ left: share(loopA), width: loopB === null ? 0 : `calc(${share(loopB)} - ${share(loopA)})` }}
        />
      ) : null}
      {hover ? (
        <span className={styles.tip} style={{ "--x": `${hover.x}px`, "--far": `${hover.width}px` } as CSSProperties} aria-hidden="true">
          <span className={styles.time}>{formatTime(hover.ms)}</span>
          {spoken ? <span className={styles.lyric}>{spoken}</span> : null}
        </span>
      ) : null}
    </div>
  );
}
