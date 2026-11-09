import { useRef, useState, type CSSProperties, type JSX, type KeyboardEvent, type PointerEvent } from "react";
import { create } from "zustand";
import { Sheet } from "../components/Sheet";
import { useToastStore } from "../feedback/toastStore";
import { useTranslation } from "../ports/i18n";
import { clearTrim, MIN_TRIM_MS, saveTrim, useTrims } from "../ports/library";
import type { Track } from "../ports/player";
import { formatDuration } from "../screens/entity/entityModel";
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
      <span className={styles.kept} />
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
    <Sheet
      open
      onClose={onClose}
      title={t("ui.trim.title")}
      actions={[
        ...(saved ? [{ label: t("ui.trim.reset"), onClick: () => void run(() => clearTrim(track.id)), disabled: pending }] : []),
        { label: t("common.cancel"), onClick: onClose },
        {
          label: t("ui.trim.save"),
          primary: true,
          disabled: pending || (whole && !saved),
          onClick: () => void run(() => (whole ? clearTrim(track.id) : saveTrim(track, range.start, range.end))),
        },
      ]}
    >
      <p className={styles.lead}>{t("ui.trim.lead", { title: track.title })}</p>
      <TrimRange durationMs={track.durationMs} value={range} onChange={setRange} />
      <div className={styles.times} aria-live="polite">
        <span>{clock(range.start)}</span>
        <span>{t("ui.trim.kept", { time: clock(range.end - range.start) })}</span>
        <span>{clock(range.end)}</span>
      </div>
    </Sheet>
  );
}

export function TrimSheetHost(): JSX.Element | null {
  const track = useTrimSheet((state) => state.track);
  const close = useTrimSheet((state) => state.close);
  return track ? <TrimEditor key={track.id} track={track} onClose={close} /> : null;
}
