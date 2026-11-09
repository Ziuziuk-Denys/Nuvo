import { useState, type JSX } from "react";
import { Slider } from "../../components/Slider";
import { useTranslation } from "../../ports/i18n";
import { CROSSFADE_MAX_S, playerEngine } from "../../ports/player";
import { SettingBlock } from "./controls";

const TITLE = "ui.settings.crossfade";
const DESCRIPTION = "ui.settings.crossfade_desc";

export function CrossfadeBlock(): JSX.Element {
  const { t } = useTranslation();
  const [seconds, setSeconds] = useState(() => playerEngine.crossfadeSeconds());
  const change = (next: number) => {
    setSeconds(next);
    playerEngine.setCrossfade(next);
  };
  return (
    <SettingBlock title={t(TITLE)} description={t(DESCRIPTION)} titleKey={TITLE} descKey={DESCRIPTION}>
      <Slider
        value={seconds}
        min={0}
        max={CROSSFADE_MAX_S}
        step={1}
        label={t(TITLE)}
        format={(value) => (value === 0 ? t("ui.settings.crossfade_off") : t("ui.settings.crossfade_seconds", { value }))}
        onChange={change}
      />
    </SettingBlock>
  );
}
