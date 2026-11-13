import type { JSX } from "react";
import { useTranslation } from "../../ports/i18n";
import { setWordTiming, useWordTiming } from "../../ports/wordTiming";
import { SettingRow, Switch } from "./controls";

const TITLE = "settings.word_timing.title";
const DESCRIPTION = "settings.word_timing.description";

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
