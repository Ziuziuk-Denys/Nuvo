import { useState, type CSSProperties, type JSX, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { Tooltip } from "../../components/Tooltip";
import { Icon } from "../../icons/Icon";
import { useTranslation } from "../../ports/i18n";
import styles from "./controls.module.css";

export function PanelChip({
  pressed,
  disabled,
  onClick,
  className,
  children,
}: {
  pressed: boolean;
  disabled?: boolean;
  onClick?: () => void;
  className?: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <button type="button" aria-pressed={pressed} disabled={disabled} className={[styles.chip, className].filter(Boolean).join(" ")} onClick={onClick}>
      {children}
    </button>
  );
}

export function Switch({
  checked,
  label,
  disabled,
  onChange,
  "aria-describedby": describedBy,
}: {
  checked: boolean;
  label: string;
  disabled?: boolean;
  onChange(checked: boolean): void;
  "aria-describedby"?: string;
}): JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-describedby={describedBy}
      disabled={disabled}
      className={styles.switch}
      onClick={() => onChange(!checked)}
    >
      <span className={styles.knob} />
    </button>
  );
}

export function LabeledSwitch({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange(checked: boolean): void;
}): JSX.Element {
  return (
    <label className={styles.labeled} data-disabled={disabled ? "" : undefined}>
      <Switch checked={checked} label={label} disabled={disabled} onChange={onChange} />
      <span aria-hidden="true">{label}</span>
    </label>
  );
}

export function OptionRow({
  title,
  hint,
  checked,
  label,
  onChange,
}: {
  title: ReactNode;
  hint: string;
  checked: boolean;
  label: string;
  onChange(checked: boolean): void;
}): JSX.Element {
  return (
    <div className={styles.option}>
      <Tooltip text={hint}>
        <span className={styles.optionTitle}>{title}</span>
      </Tooltip>
      <Tooltip text={hint}>
        <Switch checked={checked} label={label} onChange={onChange} />
      </Tooltip>
    </div>
  );
}

const OVERHANG = 24;
// Distance between bar centres; must match bar width plus gap in controls.module.css
const PITCH_PX = 8;
const MARK_EVERY = 5;

const NUDGE: Partial<Record<string, 1 | -1>> = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 };

interface RulerProps {
  label: string;
  value: number;
  min: number;
  step: number;
  max: number;
  neutral?: number;
  format(value: number): string;
  onChange(value: number): void;
}

type Grab = { pointerX: number; notch: number };

export function Ruler({ label, value, min, max, step, neutral, format, onChange }: RulerProps): JSX.Element {
  const { t } = useTranslation();
  const notchAt = (setting: number) => (setting - min) / step;
  const lastNotch = Math.round(notchAt(max));
  const current = Math.round(notchAt(value));
  const [grab, setGrab] = useState<Grab | null>(null);
  const shown = format(value);
  const barCount = lastNotch + 1 + 2 * OVERHANG;
  const anchor = Math.round(notchAt(neutral ?? 0));

  const goTo = (notch: number) => {
    const bounded = Math.min(lastNotch, Math.max(0, Math.round(notch)));
    const setting = Math.min(Math.round((min + bounded * step) * 1000) / 1000, max);
    if (setting !== value) onChange(setting);
  };

  const startDrag = (press: PointerEvent<HTMLDivElement>) => {
    if (press.button) return;
    setGrab({ pointerX: press.clientX, notch: notchAt(value) });
    press.currentTarget.setPointerCapture(press.pointerId);
    press.preventDefault();
  };

  const nudge = (key: KeyboardEvent<HTMLDivElement>) => {
    const direction = NUDGE[key.key];
    if (direction !== undefined) {
      key.preventDefault();
      goTo(current + direction);
    }
  };

  const release = () => setGrab(null);

  return (
    <section className={styles.ruler}>
      <div className={styles.rulerHead}>
        <span className={styles.rulerLabel}>{label}</span>
        <div className={styles.stepper}>
          <button type="button" className={styles.step} aria-label={t("player.decrease")} disabled={value <= min} onClick={() => goTo(current - 1)}>
            <Icon name="remove" size={14} />
          </button>
          <button type="button" className={styles.value} disabled={neutral === undefined} onClick={() => neutral !== undefined && onChange(neutral)}>
            {shown}
          </button>
          <button type="button" className={styles.step} aria-label={t("player.increase")} disabled={value >= max} onClick={() => goTo(current + 1)}>
            <Icon name="add" size={14} />
          </button>
        </div>
      </div>
      <div
        className={styles.ticks}
        role="slider"
        aria-label={label}
        aria-valuetext={shown}
        aria-valuenow={value}
        aria-valuemin={min}
        aria-valuemax={max}
        tabIndex={0}
        data-dragging={grab ? "" : undefined}
        onPointerDown={startDrag}
        onPointerMove={(move) => grab && goTo(grab.notch + (grab.pointerX - move.clientX) / PITCH_PX)}
        onPointerUp={release}
        onPointerCancel={release}
        onWheel={(wheel) => goTo(wheel.deltaY < 0 ? current + 1 : current - 1)}
        onKeyDown={nudge}
      >
        <div className={styles.tickStrip} style={{ "--notch": current + OVERHANG } as CSSProperties}>
          {[...Array(barCount).keys()].map((bar) => {
            const notch = bar - OVERHANG;
            return (
              <span
                key={bar}
                className={styles.tick}
                data-on={notch === current ? "" : undefined}
                data-mark={(notch - anchor) % MARK_EVERY === 0 ? "" : undefined}
                data-out={notch < 0 || notch > lastNotch ? "" : undefined}
              />
            );
          })}
        </div>
      </div>
    </section>
  );
}
