import { useEffect, useMemo, useState, type CSSProperties, type JSX } from "react";
import { Lens } from "../../components/Lens";
import { useTranslation } from "../../ports/i18n";
import type { Line } from "../../ports/lyrics";
import { templateFor, type Selection } from "../../ports/visual";
import { Stage } from "../Stage";
import { DEMO_LINE_MS, demoClock, demoLines } from "./demoLines";
import styles from "./LookChoice.module.css";

export type LookView = "scene" | "karaoke";

export const LEAVE_MS = 420;

const VIEWS: LookView[] = ["scene", "karaoke"];
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
  const [view, setView] = useState<LookView>("scene");
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    if (!leaving) return;
    const timer = setTimeout(() => onChosen(view), LEAVE_MS);
    return () => clearTimeout(timer);
  }, [leaving, view, onChosen]);

  return (
    <div
      className={styles.root}
      role="group"
      aria-labelledby="look-choice-title"
      data-view={view}
      data-tone={view === "scene" && light ? "light" : undefined}
      data-light={light ? "" : undefined}
      data-leaving={leaving ? "" : undefined}
    >
      <div className={styles.scene} aria-hidden="true">
        <Stage className={styles.stage} template={template} aspect="wide" coverUrl="" lines={lines} clock={clock} />
      </div>
      <KaraokePreview lines={lines} clock={clock} />
      <div className={styles.bar}>
        <p className={styles.ask}>
          <b id="look-choice-title">{t("visual.choice.title")}</b> {t("visual.choice.later")}
        </p>
        <div className={styles.controls}>
          <div
            className={styles.tray}
            role="radiogroup"
            aria-labelledby="look-choice-title"
            onKeyDown={(event) => {
              if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
              event.preventDefault();
              setView((current) => (current === "scene" ? "karaoke" : "scene"));
            }}
          >
            {VIEWS.map((item) => (
              <button
                key={item}
                type="button"
                role="radio"
                aria-checked={item === view}
                className={styles.item}
                disabled={leaving}
                onClick={() => setView(item)}
              >
                {item === view ? <Lens group="look-choice" value={view} radius={999} /> : null}
                {t(`visual.choice.${item}`)}
              </button>
            ))}
          </div>
          <button type="button" className={styles.use} disabled={leaving} onClick={() => setLeaving(true)}>
            {t(`visual.choice.use_${view}`)}
          </button>
        </div>
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
    <div className={styles.karaoke} aria-hidden="true">
      {lines.map((line, index) => (
        <span key={index} className={styles.line} data-active={index === active ? "" : undefined} style={{ "--d": index - active } as CSSProperties}>
          {line.text}
        </span>
      ))}
    </div>
  );
}
