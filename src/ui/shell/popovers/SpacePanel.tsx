import type { JSX } from "react";
import { useTranslation } from "../../ports/i18n";
import { MOVING_PRESETS, TURN_SECONDS, useSoundStore, type MovingPreset, type MovingSpeed } from "../../ports/sound";
import { PanelChip, Switch } from "./controls";
import styles from "./popovers.module.css";

const PATHS = Object.keys(MOVING_PRESETS) as MovingPreset[];
const SPEEDS = Object.keys(TURN_SECONDS) as MovingSpeed[];

export function SpaceHeader(): JSX.Element {
  const { t } = useTranslation();
  const on = useSoundStore((state) => state.moving.on);
  return <Switch label={t("sound.moving.title")} checked={on} onChange={(next) => useSoundStore.getState().setMoving({ on: next })} />;
}

export function SpacePanel(): JSX.Element {
  const { t } = useTranslation();
  const moving = useSoundStore((state) => state.moving);
  const choose = (change: { preset: MovingPreset } | { speed: MovingSpeed }) => useSoundStore.getState().setMoving({ ...change, on: true });

  return (
    <div className={styles.panel}>
      <div className={styles.chips} role="group" aria-label={t("sound.moving.path")}>
        {PATHS.map((key) => (
          <PanelChip key={key} pressed={moving.preset === key} onClick={() => choose({ preset: key })}>
            {key.toUpperCase()}
          </PanelChip>
        ))}
      </div>
      <p className={styles.note}>{t(`sound.moving.paths.${moving.preset}`)}</p>
      <div className={styles.options}>
        <div className={styles.chips} role="group" aria-label={t("sound.moving.speed")}>
          {SPEEDS.map((key) => (
            <PanelChip key={key} pressed={moving.speed === key} onClick={() => choose({ speed: key })}>
              {t(`sound.moving.speeds.${key}`)}
            </PanelChip>
          ))}
        </div>
      </div>
      <p className={styles.note}>{t("sound.moving.headphones")}</p>
    </div>
  );
}
