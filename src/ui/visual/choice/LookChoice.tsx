import { useEffect, useMemo, useState, type CSSProperties, type JSX } from "react";
import { useTranslation } from "../../ports/i18n";
import type { Line } from "../../ports/lyrics";
import { templateFor, type Selection } from "../../ports/visual";
import { Stage } from "../Stage";
import { DEMO_LINE_MS, demoClock, demoLines } from "./demoLines";
import styles from "./LookChoice.module.css";

export type LookView = "scene" | "karaoke";

export const LEAVE_MS = 520;

const INK: [number, number, number] = [1, 1, 1];
const NIGHT: [number, number, number] = [0.02, 0.02, 0.03];
const DEMO_KEYS = ["visual.choice.demo_1", "visual.choice.demo_2", "visual.choice.demo_3"] as const;

export function exampleScene(light: boolean): Selection {
  return {
    background: "duo",
    atmosphere: [],
    centrepiece: null,
    lyrics: "kinetic",
    colors: light ? { a: INK, b: NIGHT } : { a: NIGHT, b: INK },
  };
}

interface LookChoiceProps {
  light: boolean;
  onChosen(view: LookView): void;
}

export function LookChoice({ light, onChosen }: LookChoiceProps): JSX.Element {
  const { t } = useTranslation();
  const lines = useMemo(() => demoLines(DEMO_KEYS.map((key) => t(key))), [t]);
  const [clock] = useState(() => demoClock(DEMO_KEYS.length));
  const template = useMemo(() => templateFor("own", "", true, exampleScene(light)), [light]);
  const [hot, setHot] = useState<LookView | null>(null);
  const [leaving, setLeaving] = useState<LookView | null>(null);

  useEffect(() => {
    if (!leaving) return;
    const timer = setTimeout(() => onChosen(leaving), LEAVE_MS);
    return () => clearTimeout(timer);
  }, [leaving, onChosen]);

  const option = (view: LookView, index: number, preview: JSX.Element) => (
    <button
      type="button"
      className={styles.option}
      style={{ "--i": index } as CSSProperties}
      disabled={leaving !== null}
      data-view={view}
      onPointerOver={() => setHot(view)}
      onFocus={() => setHot(view)}
      onBlur={() => setHot(null)}
      onClick={() => setLeaving(view)}
    >
      <span className={styles.preview} aria-hidden="true">
        {preview}
      </span>
      <span className={styles.label}>
        <b>{t(`visual.choice.${view}`)}</b>
        <span>{t(`visual.choice.${view}_note`)}</span>
      </span>
    </button>
  );

  return (
    <div
      className={styles.root}
      role="group"
      aria-labelledby="look-choice-title"
      data-hot={hot ?? undefined}
      data-leaving={leaving ?? undefined}
      onPointerLeave={() => setHot(null)}
    >
      <header className={styles.ask}>
        <h2 id="look-choice-title">{t("visual.choice.title")}</h2>
        <p>{t("visual.choice.later")}</p>
      </header>
      <div className={styles.options}>
        {option("scene", 0, <Stage className={styles.stage} template={template} aspect="wide" coverUrl="" lines={lines} clock={clock} />)}
        {option("karaoke", 1, <KaraokePreview lines={lines} clock={clock} />)}
      </div>
    </div>
  );
}

function KaraokePreview({ lines, clock }: { lines: Line[]; clock: () => { atMs: number } }): JSX.Element {
  const [active, setActive] = useState(() => Math.floor(clock().atMs / DEMO_LINE_MS));
  useEffect(() => {
    const timer = setInterval(() => setActive(Math.floor(clock().atMs / DEMO_LINE_MS)), 100);
    return () => clearInterval(timer);
  }, [clock]);

  return (
    <span className={styles.karaoke}>
      {lines.map((line, index) => (
        <span key={index} className={styles.line} data-active={index === active ? "" : undefined} style={{ "--d": index - active } as CSSProperties}>
          {line.text}
        </span>
      ))}
    </span>
  );
}
