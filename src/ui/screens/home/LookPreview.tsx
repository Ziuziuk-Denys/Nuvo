import { useEffect, useState, type JSX } from "react";
import { Lens } from "../../components/Lens";
import { useEffectsStore, useReducedEffects, useVisualQuality, type Look } from "../../effects";
import { usePageBackdropStore } from "../../ports/backdrop";
import { useTranslation } from "../../ports/i18n";
import { useTour } from "../../tour/tourStore";
import styles from "./LookPreview.module.css";

const LEAVE_MS = 320;
const VIEWS = ["visuals", "performance"] as const;

export function LookPreview(): JSX.Element | null {
  const asked = useEffectsStore((state) => state.lookAsked);
  const touring = useTour((state) => state.phase !== "off");
  const room = usePageBackdropStore(({ options }) => options.scene === "room");
  const reduced = useReducedEffects();
  if (asked || touring || !room || reduced) return null;
  return <Chooser />;
}

function Chooser(): JSX.Element {
  const { t } = useTranslation();
  const [before] = useState<Look>(() => useEffectsStore.getState().look);
  const view = useVisualQuality();
  const [leaving, setLeaving] = useState<"keep" | "later" | null>(null);
  const label = { visuals: t("ui.home.look.visuals"), performance: t("ui.home.look.performance") };
  const note = { visuals: t("ui.home.look.visuals_note"), performance: t("ui.home.look.performance_note") };

  useEffect(() => {
    if (!leaving) return;
    const timer = setTimeout(() => {
      const store = useEffectsStore.getState();
      if (leaving === "keep") store.setLook(view);
      else {
        store.previewLook(before);
        store.skipLook();
      }
    }, LEAVE_MS);
    return () => clearTimeout(timer);
  }, [leaving, view, before]);

  return (
    <div className={styles.root} role="group" aria-labelledby="look-preview-title" data-look-preview="" data-leaving={leaving ? "" : undefined}>
      <p className={styles.ask}>
        <b id="look-preview-title">{t("ui.home.look.title")}</b> {t("ui.home.look.hint")}
      </p>
      <div className={styles.controls}>
        <div
          className={styles.tray}
          role="radiogroup"
          aria-labelledby="look-preview-title"
          onKeyDown={(event) => {
            if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
            event.preventDefault();
            useEffectsStore.getState().previewLook(view === "visuals" ? "performance" : "visuals");
          }}
        >
          {VIEWS.map((item) => (
            <button
              key={item}
              type="button"
              role="radio"
              aria-checked={item === view}
              className={styles.item}
              disabled={leaving !== null}
              onClick={() => useEffectsStore.getState().previewLook(item)}
            >
              {item === view ? <Lens group="look-preview" value={view} radius={999} /> : null}
              {label[item]}
            </button>
          ))}
        </div>
        <button type="button" className={styles.keep} disabled={leaving !== null} onClick={() => setLeaving("keep")}>
          {t("ui.home.look.keep")}
        </button>
      </div>
      <p className={styles.foot}>
        <span aria-live="polite">{note[view]}</span>
        <button type="button" className={styles.later} disabled={leaving !== null} onClick={() => setLeaving("later")}>
          {t("ui.home.look.later")}
        </button>
      </p>
    </div>
  );
}
