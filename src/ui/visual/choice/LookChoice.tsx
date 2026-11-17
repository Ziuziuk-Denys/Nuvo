import { useEffect, useMemo, useState, type JSX } from "react";
import type { Line } from "../../ports/lyrics";
import { useTranslation } from "../../ports/i18n";
import { SCENES, templateFor, type Selection } from "../../ports/visual";
import { Stage } from "../Stage";
import styles from "./LookChoice.module.css";

export type LookView = "scene" | "karaoke";

export const LEAVE_MS = 520;

const EMBLEM = SCENES.find((scene) => scene.id === "emblem")!.selection;
const ICE_ON_WHITE: Selection = {
  background: "duo",
  atmosphere: [],
  centrepiece: null,
  lyrics: "kinetic",
  colors: { a: [1, 1, 1], b: [0.02, 0.02, 0.03] },
};

export function exampleScene(hasLyrics: boolean): Selection {
  return hasLyrics ? ICE_ON_WHITE : EMBLEM;
}

interface LookChoiceProps {
  trackKey: string;
  coverUrl: string;
  lines: Line[];
  onChosen(view: LookView, scene: Selection): void;
}

// the scene half is live; the karaoke half is a window onto the real karaoke view underneath
export function LookChoice({ trackKey, coverUrl, lines, onChosen }: LookChoiceProps): JSX.Element {
  const { t } = useTranslation();
  const hasLyrics = lines.length > 0;
  const template = useMemo(() => templateFor("own", trackKey, hasLyrics, exampleScene(hasLyrics)), [trackKey, hasLyrics]);
  const [hot, setHot] = useState<LookView | null>(null);
  const [leaving, setLeaving] = useState<LookView | null>(null);

  useEffect(() => {
    if (!leaving) return;
    const timer = setTimeout(() => onChosen(leaving, exampleScene(hasLyrics)), LEAVE_MS);
    return () => clearTimeout(timer);
  }, [leaving, onChosen, hasLyrics]);

  const pick = (view: LookView) => (
    <button
      type="button"
      className={styles.pick}
      disabled={leaving !== null}
      onPointerOver={() => setHot(view)}
      onFocus={() => setHot(view)}
      onClick={() => setLeaving(view)}
    >
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
      <div className={styles.prompt}>
        <h2 id="look-choice-title">{t("visual.choice.title")}</h2>
        <p>{t("visual.choice.later")}</p>
      </div>
      <section className={`${styles.half} ${styles.scene}`}>
        <Stage className={styles.stage} template={template} aspect="tall" coverUrl={coverUrl} lines={lines} />
        {pick("scene")}
      </section>
      <section className={`${styles.half} ${styles.karaoke}`}>{pick("karaoke")}</section>
    </div>
  );
}
