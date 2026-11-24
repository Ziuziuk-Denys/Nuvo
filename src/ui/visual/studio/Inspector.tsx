import { useCallback, useState, type JSX } from "react";
import { Popover } from "../../components/Popover";
import { Slider } from "../../components/Slider";
import { Icon } from "../../icons/Icon";
import { useTranslation } from "../../ports/i18n";
import { controlsOf, TEXT_SIZE, thumbnailOf, WEIGHT_BUDGET, type Media, type Part, type Scene, type Selection, type TextLook } from "../../ports/visual";
import { Segmented } from "../../screens/settings/controls";
import { ColorPicker } from "../../screens/settings/ColorPicker";
import { PercentField } from "./PercentField";
import theme from "./theme.module.css";
import type { Rgb } from "./types";
import { usePreview } from "./usePreview";
import styles from "./Inspector.module.css";

const DEFAULT_COLOURS: [Rgb, Rgb] = [
  [0, 0.88, 1],
  [0.04, 0.06, 0.19],
];

const toHex = (rgb: Rgb) =>
  `#${rgb
    .map((c) =>
      Math.round(c * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
const toRgb = (hex: string): Rgb => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as Rgb;

interface InspectorProps {
  scene: Scene;
  parts: Part[];
  coverUrl: string;
  media: Media | null;
  onChange(next: Selection): void;
}

function Swatch({ colour, label, onChange }: { colour: Rgb; label: string; onChange(next: Rgb): void }): JSX.Element {
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <button ref={setAnchor} type="button" className={styles.swatch} onClick={() => setOpen(true)}>
        <i style={{ background: toHex(colour) }} />
        <span>{label}</span>
        <code>{toHex(colour).toUpperCase()}</code>
      </button>
      <Popover open={open} anchor={anchor} onClose={() => setOpen(false)} title={label} width={300} className={theme.dark}>
        <ColorPicker value={toHex(colour)} translucent={false} label={label} onInput={(hex) => onChange(toRgb(hex))} onCommit={(hex) => onChange(toRgb(hex))} />
      </Popover>
    </>
  );
}

const INKS: Rgb[] = [
  [1, 1, 1],
  [0.96, 0.92, 0.84],
  [0.86, 0.76, 0.53],
  [1, 0.62, 0.52],
  [0.56, 0.8, 1],
  [0.64, 0.9, 0.76],
];
const PLAIN: TextLook = { size: 1, ink: "auto" };

function TextRows({ part, selection, onChange }: { part: Part; selection: Selection; onChange(next: Selection): void }): JSX.Element {
  const { t } = useTranslation();
  const look = selection.text ?? PLAIN;
  const mode = look.ink === "auto" || look.ink === "cover" ? look.ink : "custom";
  const set = (next: Partial<TextLook>) => onChange({ ...selection, text: { ...look, ...next } });
  const sizeLabel = t("visual.text.size");
  return (
    <>
      {part.id === "wipe" ? null : (
        <div className={styles.row}>
          <span className={styles.label}>{t("visual.text.colour")}</span>
          <Segmented
            label={t("visual.text.colour")}
            options={[
              { value: "auto", label: t("visual.text.auto") },
              { value: "cover", label: t("visual.text.cover") },
              { value: "custom", label: t("visual.text.custom") },
            ]}
            value={mode}
            onChange={(next) => set({ ink: next === "custom" ? INKS[0] : next })}
          />
          {typeof look.ink === "object" ? (
            <div className={styles.inks}>
              {INKS.map((rgb) => (
                <button
                  key={toHex(rgb)}
                  type="button"
                  data-ink-swatch=""
                  className={styles.ink}
                  style={{ background: toHex(rgb) }}
                  aria-label={toHex(rgb).toUpperCase()}
                  aria-pressed={toHex(rgb) === toHex(look.ink as Rgb)}
                  onClick={() => set({ ink: rgb })}
                />
              ))}
              <Swatch colour={look.ink} label={t("visual.text.own")} onChange={(rgb) => set({ ink: rgb })} />
            </div>
          ) : null}
        </div>
      )}
      <div className={styles.row}>
        <span className={styles.label}>{sizeLabel}</span>
        <div className={styles.input}>
          <Slider value={look.size} min={TEXT_SIZE.min} max={TEXT_SIZE.max} step={0.01} label={sizeLabel} hideValue onChange={(size) => set({ size })} />
          <PercentField
            value={look.size}
            min={0}
            max={1}
            limits={[TEXT_SIZE.min * 100, TEXT_SIZE.max * 100]}
            label={sizeLabel}
            onCommit={(size) => set({ size })}
          />
        </div>
      </div>
    </>
  );
}

function Thumb({ part, coverUrl, media }: { part: Part; coverUrl: string; media: Media | null }): JSX.Element {
  const src = usePreview(useCallback(() => thumbnailOf(part, coverUrl, media), [part, coverUrl, media]));
  return <span className={styles.thumb}>{src ? <img src={src} alt="" /> : null}</span>;
}

export function Inspector({ scene, parts, coverUrl, media, onChange }: InspectorProps): JSX.Element {
  const { t } = useTranslation();
  const selection = scene.selection;
  const editable = parts.filter((part) => controlsOf(part, selection).length > 0 || part.id === "duo" || part.slot === "lyrics");
  const [openId, setOpenId] = useState<string | null>(null);
  const open = editable.some((part) => part.id === openId) ? openId : (editable[0]?.id ?? null);
  const colours: [Rgb, Rgb] = selection.colors ? [selection.colors.a, selection.colors.b] : DEFAULT_COLOURS;
  const mood = scene.weight <= 3 ? "calm" : scene.weight <= 5 ? "full" : "busy";

  const setParam = (part: Part, key: string, value: number) =>
    onChange({ ...selection, params: { ...selection.params, [part.id]: { ...selection.params?.[part.id], [key]: value } } });
  const reset = (part: Part) => {
    const params = { ...selection.params };
    delete params[part.id];
    if (part.id === "duo") onChange({ ...selection, params, colors: undefined });
    else if (part.slot === "lyrics") onChange({ ...selection, params, text: undefined });
    else onChange({ ...selection, params });
  };
  const changed = (part: Part) =>
    Boolean(selection.params?.[part.id]) || (part.id === "duo" && Boolean(selection.colors)) || (part.slot === "lyrics" && Boolean(selection.text));
  const setColour = (index: 0 | 1, next: Rgb) => {
    const pair: [Rgb, Rgb] = [...colours];
    pair[index] = next;
    onChange({ ...selection, colors: { a: pair[0], b: pair[1] } });
  };

  return (
    <section className={theme.panel} data-tour="studio-inspector">
      <div className={`${styles.list} n-scroll`}>
        {editable.length === 0 ? <p className={`${theme.hint} ${styles.empty}`}>{t("visual.studio.nothing_to_tune")}</p> : null}
        {editable.map((part) => {
          const expanded = part.id === open;
          const title = t(`visual.part.${part.id}.title`);
          return (
            <section key={part.id} className={styles.part} data-open={expanded ? "" : undefined}>
              <div className={styles.partHead}>
                <button type="button" className={styles.toggle} aria-expanded={expanded} onClick={() => setOpenId(expanded ? "" : part.id)}>
                  <Thumb part={part} coverUrl={coverUrl} media={media} />
                  <b>{title}</b>
                  <Icon name="chevron-down" size={16} className={styles.chevron} />
                </button>
                {changed(part) ? (
                  <button type="button" className={theme.icon} onClick={() => reset(part)} aria-label={t("visual.studio.reset_part", { name: title })}>
                    <Icon name="undo" size={14} />
                  </button>
                ) : null}
              </div>
              <div className={styles.collapse} data-open={expanded ? "" : undefined} inert={!expanded}>
                <div className={styles.body}>
                  {part.slot === "lyrics" ? <TextRows part={part} selection={selection} onChange={onChange} /> : null}
                  {controlsOf(part, selection).map((control) => {
                    const label = t(`visual.param.${control.name}`);
                    return (
                      <div key={control.key} className={styles.row}>
                        <span className={styles.label}>{label}</span>
                        <div className={styles.input}>
                          <Slider
                            value={control.value}
                            min={control.min}
                            max={control.max}
                            step={control.step}
                            label={label}
                            hideValue
                            onChange={(value) => setParam(part, control.key, value)}
                          />
                          <PercentField
                            value={control.value}
                            min={control.min}
                            max={control.max}
                            label={label}
                            onCommit={(value) => setParam(part, control.key, value)}
                          />
                        </div>
                      </div>
                    );
                  })}
                  {part.id === "duo" ? (
                    <div className={styles.swatches}>
                      <Swatch colour={colours[0]} label={t("visual.editor.colour_a")} onChange={(next) => setColour(0, next)} />
                      <Swatch colour={colours[1]} label={t("visual.editor.colour_b")} onChange={(next) => setColour(1, next)} />
                    </div>
                  ) : null}
                </div>
              </div>
            </section>
          );
        })}
      </div>
      <footer className={styles.balance}>
        <div className={styles.balanceHead}>
          <span>{t("visual.editor.balance")}</span>
          <span className={theme.hint}>{t(`visual.editor.${mood}`)}</span>
        </div>
        <div
          className={styles.meter}
          role="meter"
          aria-valuemin={0}
          aria-valuemax={WEIGHT_BUDGET}
          aria-valuenow={scene.weight}
          aria-label={t("visual.editor.balance")}
        >
          {Array.from({ length: WEIGHT_BUDGET }, (_, i) => (
            <i key={i} data-on={i < scene.weight ? "" : undefined} />
          ))}
        </div>
        {scene.issues.map((issue) => (
          <p key={issue} className={theme.hint}>
            {t(`visual.editor.${issue}_note`)}
          </p>
        ))}
      </footer>
    </section>
  );
}
