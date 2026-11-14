import type { JSX } from "react";
import { IconButton } from "../../components/IconButton";
import { Icon } from "../../icons/Icon";
import { useTranslation } from "../../ports/i18n";
import { playerEngine, usePlayerStore } from "../../ports/player";
import { useSoundStore } from "../../ports/sound";
import { formatDuration } from "../../screens/entity/entityModel";
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
      <button type="button" className={styles.mark} disabled={!trackId} onClick={add}>
        <Icon name="moment" size={16} />
        {t("ui.sound.moments.add", { time: clock(positionMs) })}
      </button>
      {sorted.length === 0 ? (
        <p className={styles.note}>{t("ui.sound.moments.empty")}</p>
      ) : (
        <ul className={styles.moments}>
          {sorted.map((moment) => (
            <li key={moment.id} className={styles.moment} data-moment="">
              <button type="button" className={styles.momentJump} onClick={() => playerEngine.seek(moment.positionMs)}>
                <span className={styles.momentTime}>{clock(moment.positionMs)}</span>
                <span className={styles.momentLabel}>{moment.label}</span>
              </button>
              <IconButton
                icon="close"
                size="s"
                className={styles.momentForget}
                label={t("ui.sound.moments.remove", { name: moment.label })}
                onClick={() => trackId && useSoundStore.getState().removeMoment(trackId, moment.id)}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
