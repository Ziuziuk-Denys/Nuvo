import { useState, type JSX } from "react";
import { useEffectsStore, useVisualQuality, type Look } from "../../../effects";
import { useTranslation } from "../../../ports/i18n";
import { useTour } from "../../../tour/tourStore";
import styles from "./LookChoice.module.css";

export function LookChoice(): JSX.Element | null {
  const { t } = useTranslation();
  const asked = useEffectsStore((state) => state.lookAsked);
  const touring = useTour((state) => state.phase !== "off");
  const current = useVisualQuality();
  const [leaving, setLeaving] = useState<Look | "later" | null>(null);
  if (asked || touring) return null;

  const commit = () => {
    if (leaving === "later") useEffectsStore.getState().skipLook();
    else if (leaving) useEffectsStore.getState().setLook(leaving);
  };
  const options = [
    { look: "visuals" as const, title: t("ui.home.look.visuals"), note: t("ui.home.look.visuals_note") },
    { look: "performance" as const, title: t("ui.home.look.performance"), note: t("ui.home.look.performance_note") },
  ];

  return (
    <div className={styles.choice} data-look-choice="" data-leaving={leaving ? "" : undefined} onTransitionEnd={commit}>
      <div className={styles.options} role="group" aria-label={t("ui.home.look.label")}>
        {options.map((option) => (
          <button
            key={option.look}
            type="button"
            className={styles.option}
            aria-pressed={(leaving ?? current) === option.look}
            onClick={() => setLeaving(option.look)}
          >
            <span className={styles.title}>{option.title}</span>
            <span className={styles.note}>{option.note}</span>
          </button>
        ))}
      </div>
      <button type="button" className={styles.later} onClick={() => setLeaving("later")}>
        {t("ui.home.look.later")}
      </button>
    </div>
  );
}
