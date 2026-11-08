import { useEffect, useState, type JSX } from "react";
import { useTranslation } from "../../ports/i18n";
import { readCloseToTray, readMenuEntry, trayAvailable, writeCloseToTray, writeMenuEntry } from "../../ports/system";
import { SettingRow, Switch } from "./controls";

const TITLE = "ui.settings.close_to_tray.title";
const DESCRIPTION = "ui.settings.close_to_tray.description";

/** Shown only where a tray exists: without one, closing the window must quit. */
export function CloseToTrayRow(): JSX.Element | null {
  const { t } = useTranslation();
  const [on, setOn] = useState<boolean | null>(null);

  useEffect(() => {
    let live = true;
    void Promise.all([trayAvailable(), readCloseToTray()]).then(([available, value]) => {
      if (live && available && value !== null) setOn(value);
    });
    return () => {
      live = false;
    };
  }, []);

  if (on === null) return null;

  const change = (next: boolean) => {
    setOn(next);
    void writeCloseToTray(next).then((ok) => {
      if (!ok) setOn(!next);
    });
  };

  return (
    <SettingRow
      title={t(TITLE)}
      description={t(DESCRIPTION)}
      titleKey={TITLE}
      descKey={DESCRIPTION}
      explained
      control={<Switch checked={on} label={t(TITLE)} onChange={change} />}
    />
  );
}

const MENU_TITLE = "ui.settings.menu_entry.title";
const MENU_DESCRIPTION = "ui.settings.menu_entry.description";

/** Shown only in an AppImage on the real profile: other packages install their own menu entry. */
export function MenuEntryRow(): JSX.Element | null {
  const { t } = useTranslation();
  const [on, setOn] = useState<boolean | null>(null);

  useEffect(() => {
    let live = true;
    void readMenuEntry().then((value) => {
      if (live) setOn(value);
    });
    return () => {
      live = false;
    };
  }, []);

  if (on === null) return null;

  const change = (next: boolean) => {
    setOn(next);
    void writeMenuEntry(next).then((ok) => {
      if (!ok) setOn(!next);
    });
  };

  return (
    <SettingRow
      title={t(MENU_TITLE)}
      description={t(MENU_DESCRIPTION)}
      titleKey={MENU_TITLE}
      descKey={MENU_DESCRIPTION}
      explained
      control={<Switch checked={on} label={t(MENU_TITLE)} onChange={change} />}
    />
  );
}
