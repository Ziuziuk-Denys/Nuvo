import type { JSX } from "react";
import { useTranslation } from "../../ports/i18n";
import { setOfflineMode, useOfflineMode } from "../../ports/network";
import { SettingRow, Switch } from "./controls";

const TITLE = "ui.settings.offline_mode.title";
const DESCRIPTION = "ui.settings.offline_mode.description";

export function OfflineModeRow(): JSX.Element {
  const { t } = useTranslation();
  const on = useOfflineMode();
  return (
    <SettingRow
      title={t(TITLE)}
      description={t(on ? "ui.settings.offline_mode.on" : DESCRIPTION)}
      titleKey={TITLE}
      descKey={DESCRIPTION}
      explained
      control={<Switch checked={on} label={t(TITLE)} onChange={setOfflineMode} />}
    />
  );
}
