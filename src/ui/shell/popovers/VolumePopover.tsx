import { useLayoutEffect, useRef, useState, type CSSProperties, type JSX, type KeyboardEvent, type PointerEvent, type WheelEvent } from "react";
import { createPortal } from "react-dom";
import { LAYER_ATTRIBUTE, useLayer, usePresence } from "../../components/layers";
import { POPOVER } from "../../geometry";
import { Icon } from "../../icons/Icon";
import { useTranslation } from "../../ports/i18n";
import { playerEngine, toVolumeGain, toVolumeLevel, usePlayerState } from "../../ports/player";
import styles from "./popovers.module.css";

const WHEEL_STEP = 5;
const KEY_STEP = 5;
const DEFAULT_RESTORE_PERCENT = 70;
const COLUMN_HEIGHT = 120;
const WIDTH_PX = 46;
let restorePercent = DEFAULT_RESTORE_PERCENT;

const percentOf = (gain: number) => Math.round(toVolumeLevel(gain) * 100);

function apply(next: number): void {
  const clamped = Math.round(Math.min(100, Math.max(0, next)));
  if (clamped > 0) restorePercent = clamped;
  playerEngine.setVolume(toVolumeGain(clamped / 100));
}

export function wheelVolume(gain: number, deltaY: number): void {
  apply(percentOf(gain) + (deltaY < 0 ? WHEEL_STEP : -WHEEL_STEP));
}

interface VolumePopoverProps {
  open: boolean;
  anchor: HTMLElement | null;
  onClose(): void;
  onWheel?(event: WheelEvent<HTMLDivElement>): void;
}

export function VolumePopover(props: VolumePopoverProps): JSX.Element | null {
  const phase = usePresence(props.open);
  return phase === null ? null : <VolumeColumn {...props} phase={phase} />;
}

function VolumeColumn({ open, anchor, onClose, onWheel, phase }: VolumePopoverProps & { phase: "in" | "out" }) {
  const { t } = useTranslation();
  const player = usePlayerState();
  const percent = percentOf(player.volume ?? 1);
  const panelRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const [place, setPlace] = useState<CSSProperties>({ visibility: "hidden" });

  useLayer(open, panelRef, { onEscape: onClose, returnTo: anchor, onOutside: onClose });

  useLayoutEffect(() => {
    if (!anchor) return;
    const update = () => {
      const box = anchor.getBoundingClientRect();
      const top = anchor.closest("[data-island]")?.getBoundingClientRect().top ?? box.top;
      setPlace({ left: box.left + box.width / 2 - WIDTH_PX / 2, bottom: window.innerHeight - top + POPOVER.islandGap });
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [anchor]);

  const levelAt = (clientY: number, track: HTMLElement) => {
    const box = track.getBoundingClientRect();
    return ((box.bottom - clientY) / box.height) * 100;
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
    apply(levelAt(event.clientY, event.currentTarget));
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (dragging) apply(levelAt(event.clientY, event.currentTarget));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const moves: Record<string, number> = {
      ArrowUp: percent + KEY_STEP,
      ArrowRight: percent + KEY_STEP,
      ArrowDown: percent - KEY_STEP,
      ArrowLeft: percent - KEY_STEP,
      Home: 0,
      End: 100,
    };
    if (!(event.key in moves)) return;
    event.preventDefault();
    apply(moves[event.key]);
  };

  const toggleMute = () => {
    if (percent > 0) {
      restorePercent = percent;
      playerEngine.setVolume(0);
    } else {
      apply(restorePercent);
    }
  };

  const icon = percent === 0 ? "volume-mute" : percent < 40 ? "volume-low" : "volume-high";

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label={t("ui.volume.title")}
      tabIndex={-1}
      className={styles.volumeShell}
      style={place}
      data-state={phase}
      onWheel={onWheel}
      {...{ [LAYER_ATTRIBUTE]: "" }}
    >
      <div
        role="slider"
        tabIndex={0}
        aria-label={t("ui.volume.title")}
        aria-orientation="vertical"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={`${percent} %`}
        className={styles.column}
        style={{ height: COLUMN_HEIGHT }}
        data-dragging={dragging ? "" : undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={() => setDragging(false)}
        onPointerCancel={() => setDragging(false)}
        onKeyDown={onKeyDown}
      >
        <div className={styles.fill} style={{ height: `${percent}%` }} />
        <div className={styles.face}>
          <button
            type="button"
            className={styles.mute}
            aria-label={percent === 0 ? t("ui.volume.unmute") : t("ui.volume.mute")}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={toggleMute}
          >
            <Icon name={icon} size={16} />
          </button>
          <span className={styles.percent}>{percent}%</span>
        </div>
        <div className={`${styles.face} ${styles.faceOnFill}`} style={{ clipPath: `inset(${100 - percent}% 0 0 0)` }} aria-hidden="true">
          <span className={styles.mute}>
            <Icon name={icon} size={16} />
          </span>
          <span className={styles.percent}>{percent}%</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
