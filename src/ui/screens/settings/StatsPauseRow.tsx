import type { JSX } from "react";
import { useTranslation } from "../../ports/i18n";
import { useStatsPaused } from "../../ports/stats";
import { SettingRow, Switch } from "./controls";

const TITLE = "ui.settings.stats_pause.title";
const DESCRIPTION = "ui.settings.stats_pause.description";

export function StatsPauseRow(): JSX.Element {
  const { t } = useTranslation();
  const { paused, setPaused } = useStatsPaused();
  return (
    <SettingRow
      title={t(TITLE)}
      description={t(DESCRIPTION)}
      titleKey={TITLE}
      descKey={DESCRIPTION}
      explained
      control={<Switch checked={paused === true} label={t(TITLE)} onChange={setPaused} />}
    />
  );
}
