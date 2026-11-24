import { useEffect, useState, type JSX } from "react";
import { useTranslation } from "../../ports/i18n";
import { getPocketStatus, pocketOnTop, setPocketOnTop, type PocketStatus } from "../../ports/pocket";
import { SettingRow, Switch } from "./controls";

const TITLE = "ui.settings.pocket_on_top";

export function PocketRow(): JSX.Element | null {
  const { t } = useTranslation();
  const [status, setStatus] = useState<PocketStatus | null>(null);
  const [on, setOn] = useState(true);

  useEffect(() => {
    let live = true;
    void Promise.all([getPocketStatus(), pocketOnTop()]).then(([found, top]) => {
      if (!live || !found) return;
      setStatus(found);
      setOn(top);
    });
    return () => {
      live = false;
    };
  }, []);

  if (!status) return null;

  const able = status.top === "app";
  const change = (next: boolean) => {
    setOn(next);
    void setPocketOnTop(next).then((ok) => {
      if (!ok) setOn(!next);
    });
  };

  return (
    <SettingRow
      title={t(TITLE)}
      description={`${t(`ui.settings.pocket_top_${status.top}`)}. ${t(status.remembersPlace ? "ui.settings.pocket_place_kept" : "ui.settings.pocket_size_kept")}. ${t("ui.settings.pocket_window_back")}`}
      titleKey={TITLE}
      explained
      control={<Switch label={t(TITLE)} checked={on && able} disabled={!able} onChange={change} />}
    />
  );
}
