import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type JSX } from "react";
import { Lens } from "../../components/Lens";
import { useTranslation } from "../../ports/i18n";
import type { Line } from "../../ports/lyrics";
import { templateFor, type Selection, type Template } from "../../ports/visual";
import { Stage } from "../Stage";
import { DEMO_LINE_MS, demoClock, demoLines } from "./demoLines";
import styles from "./LookChoice.module.css";

export type LookView = "scene" | "karaoke";

export const LEAVE_MS = 420;

const VIEWS: LookView[] = ["scene", "karaoke"];
const INK: [number, number, number] = [1, 1, 1];
const NIGHT: [number, number, number] = [0.02, 0.02, 0.03];
const TOP_PX = 62;
const GAP_PX = 32;
type LyricBox = Template["layouts"]["wide"]["lyricBox"];
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

export function choiceBox(height: number, barTop: number): LyricBox {
  const top = Math.ceil((TOP_PX / height) * 100) / 100;
  const bottom = Math.floor(((barTop - GAP_PX) / height) * 100) / 100;
  return [0.08, top, 0.84, Math.max(0.1, bottom - top)];
}

interface LookChoiceProps {
  light: boolean;
  onChosen(view: LookView): void;
}

export function LookChoice({ light, onChosen }: LookChoiceProps): JSX.Element {
  const { t } = useTranslation();
  const lines = useMemo(() => demoLines(DEMO_KEYS.map((key) => t(key))), [t]);
  const [clock] = useState(() => demoClock(DEMO_KEYS.length));
  const rootRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<LyricBox | null>(null);
  const template = useMemo(() => {
    const base = templateFor("own", "", true, exampleScene(light));
    return box ? { ...base, layouts: { ...base.layouts, wide: { ...base.layouts.wide, lyricBox: box } } } : base;
  }, [light, box]);

  useLayoutEffect(() => {
    const root = rootRef.current;
    const bar = barRef.current;
    if (!root || !bar) return;
    const measure = () => {
      if (!root.clientHeight) return;
      const next = choiceBox(root.clientHeight, bar.offsetTop);
      setBox((current) => (current?.join() === next.join() ? current : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    observer.observe(bar);
    return () => observer.disconnect();
  }, []);
  const [view, setView] = useState<LookView>("scene");
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    if (!leaving) return;
    const timer = setTimeout(() => onChosen(view), LEAVE_MS);
    return () => clearTimeout(timer);
  }, [leaving, view, onChosen]);

  return (
    <div
      ref={rootRef}
      className={styles.root}
      role="group"
      aria-labelledby="look-choice-title"
      data-view={view}
      data-tone={view === "scene" && light ? "light" : undefined}
      data-light={light ? "" : undefined}
      data-leaving={leaving ? "" : undefined}
    >
      <div className={styles.scene} aria-hidden="true">
        {box ? <Stage className={styles.stage} template={template} aspect="wide" coverUrl="" lines={lines} clock={clock} /> : null}
      </div>
      <KaraokePreview lines={lines} clock={clock} />
      <div ref={barRef} className={styles.bar}>
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
