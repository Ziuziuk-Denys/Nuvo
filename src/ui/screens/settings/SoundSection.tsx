import type { JSX } from "react";
import { useTranslation } from "../../ports/i18n";
import { playerEngine, usePlayerStore } from "../../ports/player";
import { presetOf, TEMPO_PRESETS, useSoundStore, type TempoPresetKey } from "../../ports/sound";
import { CrossfadeBlock } from "./CrossfadeBlock";
import { OutputRow } from "./OutputRow";
import { Segmented, SettingBlock, SettingGroup, SettingRow, Switch } from "./controls";
import { rowText } from "./PlaybackSection";

const SPEED_LABELS: Record<TempoPresetKey, string> = {
  normal: "sound.tempo.normal",
  slowed: "sound.tempo.slowed",
  slowedReverb: "sound.tempo.slowed_reverb",
  spedUp: "sound.tempo.sped_up",
  nightcore: "sound.tempo.nightcore",
  daycore: "sound.tempo.daycore",
};

export function SoundSection(): JSX.Element {
  const { t } = useTranslation();
  const sound = useSoundStore();
  const keepSpeed = usePlayerStore((state) => state.keepSpeedAcrossTracks);
  const bestQuality = usePlayerStore((state) => state.bestQuality);
  const devicePause = usePlayerStore((state) => state.pauseOnDeviceChange);
  const setDevicePause = usePlayerStore((state) => state.setPauseOnDeviceChange);
  const devicePauseText = rowText(t, "settings.audio.pause_on_device_change");
  const setKeepSpeed = playerEngine.setKeepSpeedAcrossTracks;
  const speed = presetOf(sound.globalTempo) ?? "normal";
  const speeds = Object.keys(TEMPO_PRESETS) as TempoPresetKey[];

  return (
    <>
      <SettingGroup label={t("settings.page.output")}>
        <OutputRow />
        <SettingRow {...devicePauseText} explained control={<Switch checked={devicePause} label={devicePauseText.title} onChange={setDevicePause} />} />
        <SettingRow
          title={t("ui.settings.best_quality")}
          description={t("ui.settings.best_quality_desc")}
          titleKey="ui.settings.best_quality"
          descKey="ui.settings.best_quality_desc"
          explained
          control={<Switch label={t("ui.settings.best_quality")} checked={bestQuality} onChange={playerEngine.setBestQuality} />}
        />
      </SettingGroup>
      <SettingGroup label={t("settings.page.level")}>
        <SettingRow
          title={t("ui.sound.tab_eq")}
          description={t("ui.settings.eq_desc")}
          titleKey="ui.sound.tab_eq"
          descKey="ui.settings.eq_desc"
          explained
          control={<Switch label={t("ui.sound.tab_eq")} checked={sound.eqEnabled} onChange={sound.setEnabled} />}
        />
        <SettingRow
          title={t("sound.auto_gain")}
          description={t("ui.settings.auto_gain_desc")}
          titleKey="sound.auto_gain"
          descKey="ui.settings.auto_gain_desc"
          explained
          control={<Switch label={t("sound.auto_gain")} checked={sound.autoGain} onChange={sound.setAutoGain} />}
        />
        <SettingRow
          title={t("ui.settings.normalize")}
          description={t("ui.settings.normalize_desc")}
          titleKey="ui.settings.normalize"
          descKey="ui.settings.normalize_desc"
          explained
          control={
            <Switch
              label={t("ui.settings.normalize")}
              checked={sound.normalization !== "off"}
              onChange={(on) => sound.setNormalization(on ? "track" : "off")}
            />
          }
        />
      </SettingGroup>
      <SettingGroup label={t("settings.page.between")}>
        <CrossfadeBlock />
      </SettingGroup>
      <SettingGroup label={t("settings.page.speed")}>
        <SettingRow
          title={t("ui.settings.keep_speed")}
          description={t("player.keep_speed_hint")}
          titleKey="ui.settings.keep_speed"
          descKey="player.keep_speed_hint"
          explained
          control={<Switch label={t("ui.settings.keep_speed")} checked={keepSpeed} onChange={setKeepSpeed} />}
        />
        <SettingBlock
          title={t("ui.settings.default_speed")}
          description={t("ui.settings.default_speed_desc")}
          titleKey="ui.settings.default_speed"
          descKey="ui.settings.default_speed_desc"
        >
          <Segmented
            label={t("ui.settings.default_speed")}
            value={speed}
            onChange={(key) => sound.setGlobalTempo(TEMPO_PRESETS[key])}
            options={speeds.map((key) => ({ value: key, label: t(SPEED_LABELS[key]) }))}
          />
        </SettingBlock>
      </SettingGroup>
    </>
  );
}
