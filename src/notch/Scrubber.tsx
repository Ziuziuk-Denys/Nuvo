import { useEffect, useState, type PointerEvent } from "react";
import { formatTime, positionAt, type PositionSample } from "./lib/playback";

interface ScrubberProps {
  sample: PositionSample;
  live: boolean;
  accent: string;
  onSeek: (positionMs: number) => void;
  onHold: (holding: boolean) => void;
}

export function Scrubber({ sample, live, accent, onSeek, onHold }: ScrubberProps) {
  const [now, setNow] = useState(() => Date.now());
  const [drag, setDrag] = useState<{ ms: number; sample: PositionSample } | null>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (!live) return;
    let frame = requestAnimationFrame(function tick() {
      setNow(Date.now());
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [live]);

  const duration = sample.durationMs;
  const dragMs = drag && (dragging || drag.sample === sample) ? drag.ms : null;
  const position = dragMs ?? positionAt(sample, live ? now : sample.sampledAt);
  const fraction = duration > 0 ? Math.min(1, Math.max(0, position / duration)) : 0;

  const positionFrom = (event: PointerEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = rect.width > 0 ? (event.clientX - rect.left) / rect.width : 0;
    return Math.round(Math.min(1, Math.max(0, ratio)) * duration);
  };

  const release = (event: PointerEvent<HTMLElement>, commit: boolean) => {
    if (!dragging) return;
    setDragging(false);
    if (commit) {
      const target = positionFrom(event);
      setDrag({ ms: target, sample });
      onSeek(target);
    } else {
      setDrag(null);
    }
    onHold(false);
  };

  return (
    <div className="scrubber">
      <span className="scrubber-time">{formatTime(position)}</span>
      <div
        className="scrubber-track"
        data-control
        data-dragging={dragging}
        role="slider"
        aria-label="Position"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration / 1000)}
        aria-valuenow={Math.round(position / 1000)}
        aria-valuetext={formatTime(position)}
        onPointerDown={(event) => {
          if (duration <= 0) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          setDragging(true);
          setDrag({ ms: positionFrom(event), sample });
          onHold(true);
        }}
        onPointerMove={(event) => {
          if (dragging) setDrag({ ms: positionFrom(event), sample });
        }}
        onPointerUp={(event) => release(event, true)}
        onPointerCancel={(event) => release(event, false)}
      >
        <span className="scrubber-rail">
          <span className="scrubber-fill" style={{ transform: `scaleX(${fraction})`, backgroundColor: accent }} />
        </span>
      </div>
      <span className="scrubber-time">−{formatTime(Math.max(0, duration - position))}</span>
    </div>
  );
}
