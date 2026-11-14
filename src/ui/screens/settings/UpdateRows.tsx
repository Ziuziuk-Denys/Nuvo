import { useEffect, useState, type CSSProperties, type JSX } from "react";
import { Button } from "../../components/Button";
import { useTranslation } from "../../ports/i18n";
import { installUpdate, openReleasePage, readAutoUpdate, readUpdate, watchUpdate, writeAutoUpdate, type UpdateView } from "../../ports/system";
import { SettingBlock, SettingRow, Switch } from "./controls";
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

export function UpdateStatus(): JSX.Element | null {
  const { t } = useTranslation();
  const view = useUpdateView();
  if (!view?.version) return null;
  const version = { version: view.version };

  if (view.phase === "downloading") {
    const percent = Math.round(view.percent ?? 0);
    return (
      <SettingBlock title={t("ui.settings.update_downloading", version)} titleKey="ui.settings.update_downloading">
        <span
          className={styles.progress}
          role="progressbar"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={t("ui.settings.update_downloading", version)}
        >
          <span style={{ "--done": `${percent}%` } as CSSProperties} />
        </span>
      </SettingBlock>
    );
  }
  if (view.phase === "ready" && view.mode === "install") {
    return (
      <SettingRow
        title={t("ui.settings.update_ready", version)}
        description={t("ui.settings.update_ready_desc")}
        titleKey="ui.settings.update_ready"
        explained
        control={
          <Button size="s" variant="primary" onClick={() => void installUpdate()}>
            {t("ui.settings.update_restart")}
          </Button>
        }
      />
    );
  }
  if (view.phase === "available" && view.mode === "notify") {
    return (
      <SettingRow
        title={t("ui.settings.update_available", version)}
        description={t("ui.settings.update_available_desc")}
        titleKey="ui.settings.update_available"
        explained
        control={
          <Button size="s" variant="primary" onClick={() => void openReleasePage()}>
            {t("ui.settings.update_open")}
          </Button>
        }
      />
    );
  }
  return null;
}

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
