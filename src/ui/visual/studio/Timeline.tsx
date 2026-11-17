import { useEffect, useRef, useState, type JSX, type PointerEvent, type WheelEvent } from "react";
import { Slider } from "../../components/Slider";
import { Icon } from "../../icons/Icon";
import { useTranslation } from "../../ports/i18n";
import { lyricsCommands, type Line } from "../../ports/lyrics";
import { playerEngine, usePlayerStore } from "../../ports/player";
import type { Aspect, Template } from "../../ports/visual";
import { formatTime } from "../../shell/island/Scrubber";
import theme from "./theme.module.css";
import { STRIP_HEIGHT, useFilmstrip, useWave } from "./timelineData";
import { clampView, follow, moveRange, resizeRange, zoomAround, type Range } from "./timelineMath";
import styles from "./Timeline.module.css";

export const MIN_CLIP_MS = 5_000;
export const MAX_CLIP_MS = 60_000;
const MIN_VIEW_MS = 10_000;
const ZOOM_STEPS = 20;
const TICK_STEPS_MS = [1_000, 2_000, 5_000, 10_000, 15_000, 30_000, 60_000];
const TARGET_TICK_PX = 90;
const RATIO: Record<Aspect, number> = { tall: 9 / 16, square: 1, wide: 16 / 9 };

type Drag =
  | { kind: "seek" }
  | { kind: "move"; startMs: number; range: Range }
  | { kind: "edge"; edge: "from" | "to" }
  | { kind: "pan"; startX: number; startFrom: number };

interface TimelineProps {
  track: { id: string; coverUrl?: string };
  template: Template;
  aspect: Aspect;
  lines: Line[];
  range: Range;
  onRange(next: Range): void;
  history: { canUndo: boolean; canRedo: boolean; undo(): void; redo(): void };
  onMarkIn(): void;
  onMarkOut(): void;
}

// zoom 0 shows the whole song; the steps are even on a log scale
const viewFor = (zoom: number, total: number) => Math.min(total, total * Math.pow(MIN_VIEW_MS / total, zoom / ZOOM_STEPS));

const tickStep = (view: number, width: number) => TICK_STEPS_MS.find((step) => (step / view) * width >= TARGET_TICK_PX) ?? TICK_STEPS_MS.at(-1)!;

export function Timeline({ track, template, aspect, lines, range, onRange, history, onMarkIn, onMarkOut }: TimelineProps): JSX.Element {
  const { t } = useTranslation();
  const durationMs = usePlayerStore((state) => state.durationMs);
  const total = Math.max(durationMs, range[1], MIN_VIEW_MS);
  const [zoom, setZoom] = useState(ZOOM_STEPS / 2);
  const view = viewFor(zoom, total);
  const [viewFrom, setViewFrom] = useState(() => clampView((range[0] + range[1]) / 2 - view / 2, view, total));
  const [width, setWidth] = useState(0);
  const [hoverMs, setHoverMs] = useState<number | null>(null);
  const area = useRef<HTMLDivElement>(null);
  const playhead = useRef<HTMLDivElement>(null);
  const stamp = useRef<HTMLSpanElement>(null);
  const drag = useRef<Drag | null>(null);
  const wave = useWave(track.id);
  const from = clampView(viewFrom, view, total);
  const to = from + view;
  const frames = useFilmstrip({
    trackId: track.id,
    template,
    aspect,
    coverUrl: track.coverUrl ?? "",
    lines,
    fromMs: Math.round(from),
    toMs: Math.round(to),
    count: width > 0 ? Math.max(4, Math.min(24, Math.round(width / (STRIP_HEIGHT * RATIO[aspect])))) : 0,
  });

  useEffect(() => {
    const element = area.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // the playhead follows the audio clock every frame without re-rendering the timeline
  useEffect(() => {
    let frame = 0;
    const tick = () => {
      const { atMs, playing } = lyricsCommands.clock();
      const x = ((atMs - from) / view) * width;
      const shown = x >= -1 && x <= width + 1;
      if (playhead.current) {
        playhead.current.style.transform = `translateX(${x}px)`;
        playhead.current.style.opacity = shown ? "1" : "0";
      }
      if (stamp.current) stamp.current.textContent = formatTime(atMs);
      if (playing && !drag.current) {
        const next = follow(from, view, atMs, total);
        if (next !== from) setViewFrom(next);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [from, view, width, total]);

  const msAt = (clientX: number) => {
    const box = area.current!.getBoundingClientRect();
    return Math.max(0, Math.min(total, from + ((clientX - box.left) / box.width) * view));
  };
  const at = (ms: number) => `${((ms - from) / view) * 100}%`;
  const span = (start: number, end: number) => ({
    left: at(Math.max(start, from)),
    width: `${Math.max(0, ((Math.min(end, to) - Math.max(start, from)) / view) * 100)}%`,
  });
  const limits = { min: MIN_CLIP_MS, max: MAX_CLIP_MS, total };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button === 1) {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = { kind: "pan", startX: event.clientX, startFrom: from };
      return;
    }
    if (event.button !== 0) return;
    const role = (event.target as HTMLElement).dataset.role;
    event.currentTarget.setPointerCapture(event.pointerId);
    const ms = msAt(event.clientX);
    if (role === "from" || role === "to") drag.current = { kind: "edge", edge: role };
    else if (role === "range") drag.current = { kind: "move", startMs: ms, range };
    else {
      drag.current = { kind: "seek" };
      void playerEngine.seek(Math.round(ms));
    }
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const ms = msAt(event.clientX);
    setHoverMs(drag.current?.kind === "pan" ? null : ms);
    const current = drag.current;
    if (!current) return;
    if (current.kind === "pan") {
      setViewFrom(clampView(current.startFrom - ((event.clientX - current.startX) / Math.max(1, width)) * view, view, total));
      return;
    }
    if (current.kind === "seek") void playerEngine.seek(Math.round(ms));
    else if (current.kind === "edge") onRange(resizeRange(range, current.edge, Math.round(ms), limits).map(Math.round) as Range);
    else onRange(moveRange(current.range, Math.round(ms - current.startMs), limits));
  };
  const endDrag = () => {
    drag.current = null;
  };
  const onWheel = (event: WheelEvent<HTMLDivElement>) => {
    if (event.ctrlKey || event.metaKey) {
      const next = Math.max(0, Math.min(ZOOM_STEPS, zoom + (event.deltaY < 0 ? 1 : -1)));
      setViewFrom(zoomAround(from, view, total, msAt(event.clientX), viewFor(next, total)));
      setZoom(next);
      return;
    }
    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    setViewFrom(clampView(from + (delta / Math.max(1, width)) * view, view, total));
  };
  const zoomTo = (next: number) => {
    const { atMs } = lyricsCommands.clock();
    const anchor = atMs >= from && atMs <= to ? atMs : (from + to) / 2;
    setViewFrom(zoomAround(from, view, total, anchor, viewFor(next, total)));
    setZoom(next);
  };

  const step = tickStep(view, width || 1);
  const ticks: number[] = [];
  for (let tick = Math.ceil(from / step) * step; tick <= to; tick += step) ticks.push(tick);
  const shownWave = wave.slice(Math.floor((from / total) * wave.length), Math.ceil((to / total) * wave.length));

  return (
    <section className={`${theme.panel} ${styles.timeline}`} data-tour="studio-timeline">
      <div className={styles.tools}>
        <button
          type="button"
          className={theme.icon}
          onClick={history.undo}
          disabled={!history.canUndo}
          aria-label={t("visual.studio.undo")}
          title={`${t("visual.studio.undo")}  Ctrl+Z`}
        >
          <Icon name="undo" size={16} />
        </button>
        <button
          type="button"
          className={`${theme.icon} ${styles.redo}`}
          onClick={history.redo}
          disabled={!history.canRedo}
          aria-label={t("visual.studio.redo")}
          title={`${t("visual.studio.redo")}  Ctrl+Shift+Z`}
        >
          <Icon name="undo" size={16} />
        </button>
        <button type="button" className={theme.icon} onClick={onMarkIn} aria-label={t("visual.studio.mark_in")} title={`${t("visual.studio.mark_in")}  I`}>
          <Icon name="studio-in" size={16} />
        </button>
        <button type="button" className={theme.icon} onClick={onMarkOut} aria-label={t("visual.studio.mark_out")} title={`${t("visual.studio.mark_out")}  O`}>
          <Icon name="studio-out" size={16} />
        </button>
      </div>
      <div className={styles.gutter}>
        <span className={styles.laneIcon}>
          <Icon name="studio-text" size={14} />
        </span>
        <span className={styles.laneIcon}>
          <Icon name="studio-scenes" size={14} />
        </span>
        <span className={styles.laneIcon}>
          <Icon name="volume-high" size={14} />
        </span>
      </div>
      <div className={styles.lanes}>
        <div
          ref={area}
          className={styles.area}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onPointerLeave={() => setHoverMs(null)}
          onWheel={onWheel}
          onAuxClick={(event) => event.preventDefault()}
        >
          <div className={styles.ruler}>
            {ticks.map((tick) => (
              <span key={tick} style={{ left: at(tick) }}>
                {formatTime(tick)}
              </span>
            ))}
          </div>
          <div className={styles.text}>
            {lines
              .filter((line) => line.toMs > from && line.fromMs < to && line.text.trim())
              .map((line) => (
                <span key={line.fromMs} className={styles.line} style={span(line.fromMs, line.toMs)}>
                  {line.text}
                </span>
              ))}
          </div>
          <div className={styles.strip}>
            {frames.map((tile) => (
              <span key={tile.startMs} className={styles.tile} style={span(tile.startMs, tile.endMs)}>
                {tile.url ? <img src={tile.url} alt="" draggable={false} /> : null}
              </span>
            ))}
          </div>
          <div className={styles.wave}>
            {shownWave.map((peak, i) => (
              <i key={i} style={{ height: `${12 + peak * 80}%` }} />
            ))}
          </div>

          <div className={styles.range} style={span(range[0], range[1])} data-role="range">
            <span className={styles.rangeLabel} data-role="range">
              {t("visual.studio.clip", { length: formatTime(range[1] - range[0]) })}
            </span>
            <span className={styles.edge} data-edge="from" data-role="from" />
            <span className={styles.edge} data-edge="to" data-role="to" />
          </div>
          {hoverMs !== null ? (
            <div className={styles.hover} style={{ left: at(hoverMs) }}>
              <span>{formatTime(hoverMs)}</span>
            </div>
          ) : null}
          <div ref={playhead} className={styles.playhead}>
            <span ref={stamp} className={styles.stamp} />
          </div>
        </div>
      </div>
      <div className={styles.zoom}>
        <button type="button" className={theme.icon} onClick={() => zoomTo(0)} aria-label={t("visual.studio.fit")} title={t("visual.studio.fit")}>
          <Icon name="expand" size={14} />
        </button>
        <Slider value={zoom} min={0} max={ZOOM_STEPS} step={1} label={t("visual.studio.zoom")} hideValue onChange={zoomTo} />
      </div>
    </section>
  );
}
