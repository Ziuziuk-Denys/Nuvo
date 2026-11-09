import { useRef, useState, type CSSProperties, type JSX, type KeyboardEvent, type PointerEvent } from "react";
import { Slider } from "../../components/Slider";
import { TextField } from "../../components/TextField";
import { Icon } from "../../icons/Icon";
import { hslToRgb, normalizeColour, parseColor, rgbToHsl, toHex } from "../../ports/appearance";
import { useTranslation } from "../../ports/i18n";
import styles from "./look.module.css";

interface Hsla {
  h: number;
  s: number;
  l: number;
  a: number;
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

function toHsla(colour: string): Hsla {
  const { r, g, b, a } = parseColor(colour);
  const [h, s, l] = rgbToHsl(r, g, b);
  return { h: h / 360, s, l, a };
}

export function fromHsla({ h, s, l, a }: Hsla): string {
  const [r, g, b] = hslToRgb(h * 360, s, l);
  return a >= 1 ? toHex({ r, g, b, a: 1 }) : `rgba(${r}, ${g}, ${b}, ${Math.round(a * 100) / 100})`;
}

type EyeDropperCtor = new () => { open(): Promise<{ sRGBHex: string }> };
const eyeDropper = () => (window as unknown as { EyeDropper?: EyeDropperCtor }).EyeDropper;

export interface ColorPickerProps {
  value: string;
  translucent: boolean;
  label: string;
  onInput: (value: string) => void;
  onCommit: (value: string) => void;
}

export function ColorPicker({ value, translucent, label, onInput, onCommit }: ColorPickerProps): JSX.Element {
  const { t } = useTranslation();
  const [hsla, setHsla] = useState(() => toHsla(value));
  const [code, setCode] = useState(value);
  const latest = useRef(hsla);
  const pressed = useRef(false);

  const show = (next: Hsla, commit: boolean) => {
    latest.current = next;
    setHsla(next);
    const colour = fromHsla(next);
    // the code text changes only on commit: new text in a field means layout, and a drag must not lay out
    if (commit) setCode(colour);
    (commit ? onCommit : onInput)(colour);
  };

  const fromPointer = (event: PointerEvent<HTMLDivElement>, commit: boolean) => {
    const box = event.currentTarget.getBoundingClientRect();
    show({ ...latest.current, s: clamp01((event.clientX - box.left) / box.width), l: 1 - clamp01((event.clientY - box.top) / box.height) }, commit);
  };

  const onAreaKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 0.1 : 0.01;
    const moves: Record<string, Partial<Hsla>> = {
      ArrowLeft: { s: clamp01(hsla.s - step) },
      ArrowRight: { s: clamp01(hsla.s + step) },
      ArrowDown: { l: clamp01(hsla.l - step) },
      ArrowUp: { l: clamp01(hsla.l + step) },
    };
    if (!(event.key in moves)) return;
    event.preventDefault();
    show({ ...hsla, ...moves[event.key] }, true);
  };

  const area = { "--hue": `${hsla.h * 360}`, "--x": `${hsla.s * 100}%`, "--y": `${(1 - hsla.l) * 100}%` } as CSSProperties;
  const Dropper = eyeDropper();

  return (
    <div className={styles.picker}>
      <div
        className={styles.area}
        style={area}
        role="slider"
        tabIndex={0}
        aria-label={t("appearance.picker.area", { role: label })}
        aria-valuetext={t("appearance.picker.area_value", { s: Math.round(hsla.s * 100), l: Math.round(hsla.l * 100) })}
        onKeyDown={onAreaKey}
        onPointerDown={(event) => {
          pressed.current = true;
          event.currentTarget.setPointerCapture(event.pointerId);
          fromPointer(event, false);
        }}
        onPointerMove={(event) => {
          if (pressed.current) fromPointer(event, false);
        }}
        onPointerUp={(event) => {
          pressed.current = false;
          fromPointer(event, true);
        }}
      >
        <span className={styles.knobTrack}>
          <span className={styles.knob} />
        </span>
      </div>
      <label className={styles.pickerField}>
        <span>{t("appearance.picker.hue")}</span>
        <Slider
          label={t("appearance.picker.hue")}
          min={0}
          max={360}
          step={1}
          value={Math.round(hsla.h * 360)}
          format={(v) => `${v}°`}
          onChange={(v) => show({ ...hsla, h: v / 360 }, true)}
        />
      </label>
      {translucent ? (
        <label className={styles.pickerField}>
          <span>{t("appearance.picker.opacity")}</span>
          <Slider
            label={t("appearance.picker.opacity")}
            min={0}
            max={100}
            step={1}
            value={Math.round(hsla.a * 100)}
            format={(v) => `${v}%`}
            onChange={(v) => show({ ...hsla, a: v / 100 }, true)}
          />
        </label>
      ) : null}
      <div className={styles.pickerRow}>
        <TextField
          label={t("appearance.picker.hex")}
          value={code}
          onChange={(text) => {
            setCode(text);
            const colour = normalizeColour(text);
            if (colour && (translucent || parseColor(colour).a === 1)) show(toHsla(colour), true);
          }}
        />
        {Dropper ? (
          <button
            type="button"
            className={styles.iconAction}
            title={t("appearance.picker.eyedropper")}
            aria-label={t("appearance.picker.eyedropper")}
            onClick={() =>
              void new Dropper()
                .open()
                .then((picked) => show({ ...toHsla(picked.sRGBHex), a: hsla.a }, true))
                .catch(() => undefined)
            }
          >
            <Icon name="palette" size={16} />
          </button>
        ) : null}
      </div>
    </div>
  );
}
