import { useEffect, useState, type KeyboardEvent, type PointerEvent } from "react";
import { useTranslation } from "@/i18n";
import { formatTime, positionAt, type PositionSample } from "@/notch/lib/playback";

const KEY_STEP_MS = 5000;
const TICK_MS = 250;

export function Seek({ sample, live, onSeek }: { sample: PositionSample; live: boolean; onSeek: (positionMs: number) => void }) {
  const { t } = useTranslation();
  const [now, setNow] = useState(() => Date.now());
  const [drag, setDrag] = useState<{ ms: number; sample: PositionSample; held: boolean } | null>(null);
  const duration = sample.durationMs;

  useEffect(() => {
    if (!live) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, [live]);

  const dragged = drag && (drag.held || drag.sample === sample) ? drag.ms : null;
  const position = dragged ?? positionAt(sample, Math.max(sample.sampledAt, now));
  const part = duration > 0 ? Math.min(1, Math.max(0, position / duration)) : 0;

  const at = (event: PointerEvent<HTMLElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    return Math.round(Math.min(1, Math.max(0, (event.clientX - box.left) / Math.max(1, box.width))) * duration);
  };

  return (
    <div className="seek-row">
      <span className="seek-time">{formatTime(position)}</span>
      <div
        className="seek"
        role="slider"
        tabIndex={0}
        aria-label={t("ui.pocket.position")}
        aria-valuemin={0}
        aria-valuemax={Math.round(duration / 1000)}
        aria-valuenow={Math.round(position / 1000)}
        aria-valuetext={formatTime(position)}
        data-held={drag?.held || undefined}
        onKeyDown={(event: KeyboardEvent) => {
          const step = { ArrowLeft: -KEY_STEP_MS, ArrowRight: KEY_STEP_MS }[event.key];
          if (!step || duration <= 0) return;
          event.preventDefault();
          event.stopPropagation();
          onSeek(Math.min(duration, Math.max(0, position + step)));
        }}
        onPointerDown={(event) => {
          if (duration <= 0 || event.button !== 0) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          setDrag({ ms: at(event), sample, held: true });
        }}
        onPointerMove={(event) => {
          if (drag?.held) setDrag({ ms: at(event), sample, held: true });
        }}
        onPointerUp={(event) => {
          if (!drag?.held) return;
          const ms = at(event);
          setDrag({ ms, sample, held: false });
          onSeek(ms);
        }}
        onPointerCancel={() => setDrag(null)}
      >
        <span className="seek-line">
          <span className="seek-played" style={{ transform: `scaleX(${part})` }} />
        </span>
      </div>
      <span className="seek-time">−{formatTime(Math.max(0, duration - position))}</span>
    </div>
  );
}
