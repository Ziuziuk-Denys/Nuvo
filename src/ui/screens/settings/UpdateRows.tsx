import { useEffect, useState, type JSX } from "react";
import { useTranslation } from "../../ports/i18n";
import { installUpdate, openReleasePage, readAutoUpdate, readUpdate, watchUpdate, writeAutoUpdate, type UpdateView } from "../../ports/system";
import { SettingRow, Switch } from "./controls";
import styles from "./sections.module.css";

const TITLE = "ui.settings.auto_update.title";
const DESCRIPTION = "ui.settings.auto_update.description";

function useUpdateView(): UpdateView | null {
  const [view, setView] = useState<UpdateView | null>(null);
  useEffect(() => {
    let live = true;
    void readUpdate().then((first) => live && setView((current) => current ?? first));
    const off = watchUpdate(setView);
    return () => {
      live = false;
      off();
    };
  }, []);
  return view;
}

/** One quiet line in the About card: nothing until an update is downloaded (or, where it cannot install, found). */
export function UpdateNotice(): JSX.Element | null {
  const { t } = useTranslation();
  const view = useUpdateView();
  if (!view?.version) return null;
  if (view.phase === "ready" && view.mode === "install") {
    return (
      <button type="button" className={styles.update} onClick={() => void installUpdate()}>
        {t("ui.settings.update_restart")}
      </button>
    );
  }
  if (view.phase === "available" && view.mode === "notify") {
    return (
      <button type="button" className={styles.update} onClick={() => void openReleasePage()}>
        {t("ui.settings.update_available", { version: view.version })}
      </button>
    );
  }
  return null;
}

/** Hidden where updates do not exist (a development run) or main does not answer. */
export function AutoUpdateRow(): JSX.Element | null {
  const { t } = useTranslation();
  const [on, setOn] = useState<boolean | null>(null);
  const [supported, setSupported] = useState(false);

  useEffect(() => {
    let live = true;
    void Promise.all([readUpdate(), readAutoUpdate()]).then(([view, value]) => {
      if (!live) return;
      setSupported(view !== null && view.mode !== "off");
      setOn(value);
    });
    return () => {
      live = false;
    };
  }, []);

  if (!supported || on === null) return null;

  const change = (next: boolean) => {
    setOn(next);
    void writeAutoUpdate(next).then((ok) => {
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
