import { useState, type JSX } from "react";
import { useTranslation } from "../../ports/i18n";
import { armSleepTimer, cancelSleepTimer, formatSleepClock, useSleepTimer, type SleepTarget } from "../../ports/sound";
import { PanelChip } from "./controls";
import styles from "./popovers.module.css";

const PRESET_MINUTES = [15, 30, 45, 60, 90];
const MAX_CUSTOM_MINUTES = 720;

function isSame(a: SleepTarget | null, b: SleepTarget): boolean {
  if (!a || a.kind !== b.kind) return false;
  return a.kind !== "minutes" || (b.kind === "minutes" && a.minutes === b.minutes);
}

export function SleepStatus(): JSX.Element | null {
  const { t } = useTranslation();
  const { target, remainingMs } = useSleepTimer();
  if (target === null) return null;
  return (
    <span role="status" className={styles.status}>
      {remainingMs === null ? t("sound.sleep.stops_after_queue") : t("sound.sleep.stops_in", { time: formatSleepClock(remainingMs) })}
    </span>
  );
}

export function SleepPanel(): JSX.Element {
  const { t } = useTranslation();
  const { target } = useSleepTimer();
  const [custom, setCustom] = useState("");

  const customMinutes = /^\d+$/.test(custom.trim()) ? Number(custom.trim()) : 0;
  const customValid = customMinutes >= 1 && customMinutes <= MAX_CUSTOM_MINUTES;

  const lengths: { target: SleepTarget; label: string }[] = PRESET_MINUTES.map((minutes) => ({
    target: { kind: "minutes", minutes },
    label: t("sound.sleep.minutes", { minutes }),
  }));
  const ends: { target: SleepTarget; label: string }[] = [
    { target: { kind: "end_of_track" }, label: t("sound.sleep.end_of_track") },
    { target: { kind: "end_of_queue" }, label: t("sound.sleep.end_of_queue") },
  ];
  const segments = (choices: { target: SleepTarget; label: string }[]) => (
    <div className={styles.segments}>
      {choices.map((choice) => (
        <PanelChip key={choice.label} className={styles.segmentChip} pressed={isSame(target, choice.target)} onClick={() => armSleepTimer(choice.target)}>
          {choice.label}
        </PanelChip>
      ))}
    </div>
  );

  return (
    <div className={styles.panel}>
      {segments(lengths)}
      {segments(ends)}
      <form
        className={styles.customRow}
        onSubmit={(event) => {
          event.preventDefault();
          if (!customValid) return;
          armSleepTimer({ kind: "minutes", minutes: customMinutes });
          setCustom("");
        }}
      >
        <input
          className={styles.minutes}
          inputMode="numeric"
          value={custom}
          placeholder={t("sound.sleep.custom_placeholder")}
          aria-label={t("sound.sleep.custom_label")}
          onChange={(event) => setCustom(event.target.value)}
        />
        <button type="submit" disabled={!customValid} className={styles.plainChip}>
          {t("sound.sleep.start")}
        </button>
        {target !== null ? (
          <button type="button" className={`${styles.plainChip} ${styles.end}`} onClick={cancelSleepTimer}>
            {t("sound.sleep.cancel")}
          </button>
        ) : null}
      </form>
    </div>
  );
}
