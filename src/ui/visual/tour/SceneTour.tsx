import { useEffect, useState, type CSSProperties, type JSX } from "react";
import { createPortal } from "react-dom";
import { Button } from "../../components/Button";
import { LAYER_ATTRIBUTE } from "../../components/layers";
import { useTranslation } from "../../ports/i18n";
import { Callout } from "../../tour/Callout";
import { holeClip, ringAround, type Box } from "../../tour/placement";
import { boxOf, sameBox } from "../../tour/targets";
import tour from "../../tour/tour.module.css";
import { SCENE_TOUR } from "./steps";
import styles from "./SceneTour.module.css";

const query = (target: string) => document.querySelector(`[data-tour="${target}"]`);

export function SceneTour({ onDone }: { onDone(): void }): JSX.Element {
  const { t } = useTranslation();
  const [index, setIndex] = useState(0);
  const [box, setBox] = useState<Box | null>(null);
  const [view, setView] = useState({ width: innerWidth, height: innerHeight });
  const step = SCENE_TOUR[index];
  const last = index === SCENE_TOUR.length - 1;
  const next = () => (last ? onDone() : setIndex(index + 1));

  // targets move with layout and the studio opens mid-tour, so the outline follows them every frame
  useEffect(() => {
    let frame = 0;
    const follow = () => {
      const element = step.target ? query(step.target) : null;
      const found = element ? boxOf(element) : null;
      setBox((previous) => (sameBox(previous, found) ? previous : found));
      setView((previous) => (previous.width === innerWidth && previous.height === innerHeight ? previous : { width: innerWidth, height: innerHeight }));
      frame = requestAnimationFrame(follow);
    };
    follow();
    return () => cancelAnimationFrame(frame);
  }, [step.target]);

  useEffect(() => {
    if (!step.press || !step.target) return;
    const target = step.target;
    const onPress = (event: MouseEvent) => {
      if (event.target instanceof Element && event.target.closest(`[data-tour="${target}"]`)) next();
    };
    window.addEventListener("click", onPress, true);
    return () => window.removeEventListener("click", onPress, true);
  });

  useEffect(() => {
    if (step.press) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Enter" && event.key !== "ArrowRight") return;
      event.preventDefault();
      next();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  const ring = box ? ringAround(box, view) : null;
  const text = t(`visual.tour.${step.text}`);
  const holeStyle: CSSProperties = ring
    ? { transform: `translate(${ring.x}px, ${ring.y}px)`, width: ring.width, height: ring.height, borderRadius: ring.radius }
    : { transform: `translate(${view.width / 2}px, ${view.height / 2}px)`, width: 0, height: 0 };

  return createPortal(
    <div className={tour.root} role="dialog" aria-modal="true" aria-label={t("visual.tour.label")} {...{ [LAYER_ATTRIBUTE]: "" }}>
      <div className={tour.blocker} style={ring && step.press ? { clipPath: holeClip(ring) } : undefined} />
      <div className={tour.hole} style={holeStyle} data-empty={ring ? undefined : ""} />
      {ring && box ? (
        <Callout ring={ring} panel={null} area={{ width: view.width, top: 0, bottom: view.height - 96 }} side={step.side} text={text} stepKey={String(index)} />
      ) : null}
      <div className={`${tour.card} ${styles.dock}`} data-intro={step.target ? undefined : ""}>
        {step.target ? null : <p className={styles.intro}>{text}</p>}
        <div className={styles.row}>
          <span className={styles.count}>{t("visual.tour.count", { step: String(index + 1), total: String(SCENE_TOUR.length) })}</span>
          {step.press ? (
            <span className={styles.press}>{t("visual.tour.press")}</span>
          ) : (
            <Button variant="primary" onClick={next}>
              {t(last ? "visual.tour.done" : "visual.tour.next")}
            </Button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
