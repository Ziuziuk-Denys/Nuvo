import type { JSX } from "react";
import { useTranslation } from "../../ports/i18n";
import { MODEL_CHOICES, setModelChoice, setWordTiming, useModelChoice, useWordTiming } from "../../ports/wordTiming";
import { Segmented, SettingRow, Switch } from "./controls";

const TITLE = "settings.word_timing.title";
const DESCRIPTION = "settings.word_timing.description";
const MODEL_TITLE = "settings.lyrics_model.title";
const MODEL_DESCRIPTION = "settings.lyrics_model.description";

export function WordTimingRow(): JSX.Element {
  const { t } = useTranslation();
  const view = useWordTiming();
  return (
    <SettingRow
      title={t(TITLE)}
      description={t(DESCRIPTION)}
      titleKey={TITLE}
      descKey={DESCRIPTION}
      explained
      control={<Switch checked={view?.enabled === true} label={t(TITLE)} onChange={(enabled) => void setWordTiming(enabled)} />}
    />
  );
}

export function LyricsModelRow(): JSX.Element {
  const { t } = useTranslation();
  const choice = useModelChoice();
  return (
    <SettingRow
      title={t(MODEL_TITLE)}
      description={t(MODEL_DESCRIPTION)}
      titleKey={MODEL_TITLE}
      descKey={MODEL_DESCRIPTION}
      control={
        <Segmented
          label={t(MODEL_TITLE)}
          value={choice}
          onChange={setModelChoice}
          options={MODEL_CHOICES.map((value) => ({ value, label: t(`settings.lyrics_model.${value}`) }))}
        />
      }
    />
  );
}
