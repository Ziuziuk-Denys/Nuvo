import { useEffect, useState, type CSSProperties, type JSX } from "react";
import { Button } from "../../components/Button";
import { useTranslation } from "../../ports/i18n";
import { useAppVersion } from "../../ports/settings";
import {
  checkForUpdate,
  installUpdate,
  openReleasePage,
  readUpdate,
  readUpdateSetting,
  watchUpdate,
  writeUpdateSetting,
  type UpdateSetting,
  type UpdateView,
} from "../../ports/system";
import { SettingBlock, SettingRow, Switch } from "./controls";
import styles from "./sections.module.css";

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
  const current = useAppVersion();
  if (!view || view.mode === "off") return null;
  const version = { version: view.version ?? "" };

  if (view.phase === "downloading") {
    const percent = Math.round(view.percent ?? 0);
    const title = t("ui.settings.update_downloading", { ...version, percent: String(percent) });
    return (
      <SettingBlock title={title} titleKey="ui.settings.update_downloading">
        <span className={styles.progress} role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label={title}>
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
  if (view.phase === "available") {
    const notify = view.mode === "notify";
    return (
      <SettingRow
        title={t("ui.settings.update_available", version)}
        description={t(notify ? "ui.settings.update_available_desc" : "ui.settings.update_download_desc")}
        titleKey="ui.settings.update_available"
        explained
        control={
          <Button size="s" variant="primary" onClick={() => void (notify ? openReleasePage() : installUpdate())}>
            {t(notify ? "ui.settings.update_open" : "ui.settings.update_now")}
          </Button>
        }
      />
    );
  }

  const checking = view.phase === "checking";
  const [titleKey, actionKey] =
    view.phase === "latest"
      ? ["ui.settings.update_latest", "ui.settings.update_check_again"]
      : view.phase === "error"
        ? ["ui.settings.update_error", "ui.settings.update_retry"]
        : checking
          ? ["ui.settings.update_checking", "ui.settings.update_check_now"]
          : ["ui.settings.update_check", "ui.settings.update_check_now"];
  return (
    <SettingRow
      title={t(titleKey, { version: current })}
      description={view.phase === "error" ? t("ui.settings.update_error_desc") : t("ui.settings.update_check_desc", { version: current })}
      titleKey={titleKey}
      explained={view.phase !== "latest"}
      control={
        <Button size="s" disabled={checking} aria-busy={checking} onClick={() => void checkForUpdate()}>
          {t(actionKey)}
        </Button>
      }
    />
  );
}

export function AutoUpdateRow(): JSX.Element | null {
  return <UpdateSwitchRow setting="autoUpdate" base="ui.settings.auto_update" />;
}

export function UpdateCheckRow(): JSX.Element | null {
  return <UpdateSwitchRow setting="updateCheck" base="ui.settings.launch_check" />;
}

function UpdateSwitchRow({ setting, base }: { setting: UpdateSetting; base: string }): JSX.Element | null {
  const { t } = useTranslation();
  const [on, setOn] = useState<boolean | null>(null);
  const [mode, setMode] = useState<UpdateView["mode"]>("off");

  useEffect(() => {
    let live = true;
    void Promise.all([readUpdate(), readUpdateSetting(setting)]).then(([view, value]) => {
      if (!live) return;
      setMode(view?.mode ?? "off");
      setOn(value);
    });
    return () => {
      live = false;
    };
  }, [setting]);

  if (mode === "off" || on === null) return null;
  const title = `${base}.title`;
  const description = mode === "notify" && setting === "autoUpdate" ? `${base}.description_notify` : `${base}.description`;

  const change = (next: boolean) => {
    setOn(next);
    void writeUpdateSetting(setting, next).then((ok) => {
      if (!ok) setOn(!next);
    });
  };

  return (
    <SettingRow
      title={t(title)}
      description={t(description)}
      titleKey={title}
      descKey={description}
      explained
      control={<Switch checked={on} label={t(title)} onChange={change} />}
    />
  );
}
