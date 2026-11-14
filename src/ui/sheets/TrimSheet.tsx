import { useId, useRef, useState, type CSSProperties, type JSX, type KeyboardEvent, type PointerEvent } from "react";
import { create } from "zustand";
import { Button } from "../components/Button";
import { Cover } from "../components/Cover";
import { useToastStore } from "../feedback/toastStore";
import { Icon } from "../icons/Icon";
import { useTranslation } from "../ports/i18n";
import { clearTrim, MIN_TRIM_MS, saveTrim, useTrims } from "../ports/library";
import type { Track } from "../ports/player";
import { formatDuration } from "../screens/entity/entityModel";
import { GlassSheet } from "./GlassSheet";
import glass from "./GlassSheet.module.css";
import styles from "./TrimSheet.module.css";

const STEP_MS = 1000;
const PAGE_MS = 10_000;

export const useTrimSheet = create<{ track: Track | null; open(track: Track): void; close(): void }>((set) => ({
  track: null,
  open: (track) => set({ track }),
  close: () => set({ track: null }),
}));

type Handle = "start" | "end";

export function placeHandle(range: { start: number; end: number }, handle: Handle, value: number, durationMs: number): { start: number; end: number } {
  const at = Math.round(Math.min(Math.max(value, 0), durationMs) / STEP_MS) * STEP_MS;
  return handle === "start"
    ? { start: Math.max(0, Math.min(at, range.end - MIN_TRIM_MS)), end: range.end }
    : { start: range.start, end: Math.min(durationMs, Math.max(at, range.start + MIN_TRIM_MS)) };
}

const clock = (ms: number) => formatDuration(ms) ?? "0:00";

function TrimRange({
  durationMs,
  value,
  onChange,
}: {
  durationMs: number;
  value: { start: number; end: number };
  onChange(next: { start: number; end: number }): void;
}): JSX.Element {
  const { t } = useTranslation();
  const dragging = useRef<Handle | null>(null);
  const percent = (ms: number) => `${(ms / durationMs) * 100}%`;
  const fromPointer = (event: PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    return box.width > 0 ? ((event.clientX - box.left) / box.width) * durationMs : 0;
  };
  const move = (handle: Handle, ms: number) => onChange(placeHandle(value, handle, ms, durationMs));
  const keys = (handle: Handle) => (event: KeyboardEvent<HTMLSpanElement>) => {
    const current = handle === "start" ? value.start : value.end;
    const moves: Record<string, number> = {
      ArrowRight: current + STEP_MS,
      ArrowUp: current + STEP_MS,
      ArrowLeft: current - STEP_MS,
      ArrowDown: current - STEP_MS,
      PageUp: current + PAGE_MS,
      PageDown: current - PAGE_MS,
      Home: 0,
      End: durationMs,
    };
    if (!(event.key in moves)) return;
    event.preventDefault();
    move(handle, moves[event.key]);
  };
  const knob = (handle: Handle, ms: number) => (
    <span
      role="slider"
      tabIndex={0}
      aria-label={t(handle === "start" ? "ui.trim.start" : "ui.trim.end")}
      aria-valuemin={0}
      aria-valuemax={durationMs}
      aria-valuenow={ms}
      aria-valuetext={clock(ms)}
      className={styles.knob}
      data-handle={handle}
      style={{ "--at": percent(ms) } as CSSProperties}
      onKeyDown={keys(handle)}
    />
  );
  return (
    <div
      className={styles.range}
      style={{ "--from": percent(value.start), "--to": percent(value.end) } as CSSProperties}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        const ms = fromPointer(event);
        dragging.current = Math.abs(ms - value.start) <= Math.abs(ms - value.end) ? "start" : "end";
        event.currentTarget.setPointerCapture(event.pointerId);
        move(dragging.current, ms);
      }}
      onPointerMove={(event) => {
        if (dragging.current) move(dragging.current, fromPointer(event));
      }}
      onPointerUp={() => (dragging.current = null)}
      onPointerCancel={() => (dragging.current = null)}
    >
      <span className={styles.track} />
      <span className={styles.window} />
      {knob("start", value.start)}
      {knob("end", value.end)}
    </div>
  );
}

function TrimEditor({ track, onClose }: { track: Track; onClose(): void }): JSX.Element {
  const { t } = useTranslation();
  const saved = useTrims((state) => state.byTrack[track.id]);
  const [range, setRange] = useState(() => ({ start: saved?.startMs ?? 0, end: saved?.endMs ?? track.durationMs }));
  const [pending, setPending] = useState(false);
  const titleId = useId();
  const run = async (action: () => Promise<void>) => {
    setPending(true);
    try {
      await action();
      onClose();
    } catch {
      useToastStore.getState().show({ message: t("ui.trim.failed"), variant: "error" });
    } finally {
      setPending(false);
    }
  };
  const whole = range.start === 0 && range.end === track.durationMs;
  return (
    <GlassSheet open onClose={onClose} labelledBy={titleId} width={440}>
      <div className={styles.head}>
        <Cover src={track.coverUrl ?? ""} size={48} radius={11} />
        <div className={styles.headText}>
          <h2 id={titleId} className={styles.eyebrow}>
            {t("ui.trim.title")}
          </h2>
          <p className={styles.songTitle}>{track.title}</p>
          <p className={styles.songMeta}>{track.artists}</p>
        </div>
      </div>
      <div className={styles.editor}>
        <TrimRange durationMs={track.durationMs} value={range} onChange={setRange} />
        <div className={styles.times} aria-live="polite">
          <span>{clock(range.start)}</span>
          <span className={styles.kept}>{t("ui.trim.kept", { time: clock(range.end - range.start) })}</span>
          <span>{clock(range.end)}</span>
        </div>
      </div>
      <p className={glass.caption}>{t("ui.trim.lead")}</p>
      <div className={glass.footer}>
        {saved ? (
          <button type="button" className={`${glass.quiet} ${glass.start}`} disabled={pending} onClick={() => void run(() => clearTrim(track.id))}>
            <Icon name="undo" size={16} />
            {t("ui.trim.reset")}
          </button>
        ) : null}
        <Button onClick={onClose}>{t("common.cancel")}</Button>
        <Button
          variant="primary"
          disabled={pending || (whole && !saved)}
          onClick={() => void run(() => (whole ? clearTrim(track.id) : saveTrim(track, range.start, range.end)))}
        >
          {t("ui.trim.save")}
        </Button>
      </div>
    </GlassSheet>
  );
}

export function TrimSheetHost(): JSX.Element | null {
  const track = useTrimSheet((state) => state.track);
  const close = useTrimSheet((state) => state.close);
  return track ? <TrimEditor key={track.id} track={track} onClose={close} /> : null;
}
