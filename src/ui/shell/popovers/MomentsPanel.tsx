import type { JSX } from "react";
import { IconButton } from "../../components/IconButton";
import { useTranslation } from "../../ports/i18n";
import { playerEngine, usePlayerStore } from "../../ports/player";
import { useSoundStore } from "../../ports/sound";
import { formatDuration } from "../../screens/entity/entityModel";
import { PanelChip } from "./controls";
import styles from "./popovers.module.css";

const NONE: never[] = [];
const clock = (ms: number) => formatDuration(ms) ?? "0:00";

export function MomentsPanel(): JSX.Element {
  const { t } = useTranslation();
  const trackId = usePlayerStore((state) => state.currentTrack?.id ?? null);
  const positionMs = usePlayerStore((state) => state.positionMs);
  const moments = useSoundStore((state) => (trackId ? (state.moments[trackId] ?? NONE) : NONE));
  const sorted = [...moments].sort((a, b) => a.positionMs - b.positionMs);

  const add = () => {
    if (!trackId) return;
    useSoundStore.getState().addMoment(trackId, Math.floor(positionMs), t("ui.sound.moments.label", { n: moments.length + 1 }));
  };

  return (
    <div className={styles.panel}>
      <div className={styles.customRow}>
        <button type="button" className={styles.plainChip} disabled={!trackId} onClick={add}>
          {t("ui.sound.moments.add", { time: clock(positionMs) })}
        </button>
      </div>
      {sorted.length === 0 ? (
        <p className={styles.note}>{t("ui.sound.moments.empty")}</p>
      ) : (
        <div className={styles.chips}>
          {sorted.map((moment) => (
            <span key={moment.id} className={styles.moment} data-moment="">
              <PanelChip pressed={false} onClick={() => playerEngine.seek(moment.positionMs)}>
                {`${clock(moment.positionMs)} · ${moment.label}`}
              </PanelChip>
              <IconButton
                icon="close"
                size="s"
                label={t("ui.sound.moments.remove", { name: moment.label })}
                onClick={() => trackId && useSoundStore.getState().removeMoment(trackId, moment.id)}
              />
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
