import { useEffect, useState, type JSX } from "react";
import { useTranslation } from "../../ports/i18n";
import { readDiscord, readDiscordStatus, writeDiscord, type DiscordState } from "../../ports/system";
import { SettingGroup, SettingRow, Switch } from "./controls";
import styles from "./sections.module.css";

const TITLE = "settings.discord.enabled.title";
const DESCRIPTION = "settings.discord.enabled.description";
/** Main has no push for the connection, so the line asks again while the switch is on. */
export const STATUS_POLL_MS = 2000;

const STATUS_TEXT: Record<Exclude<DiscordState, "off">, string> = {
  connecting: "settings.discord.status.connecting",
  connected: "settings.discord.status.connected",
  no_client: "settings.discord.status.no_client",
  error: "settings.discord.status.error",
};

export function DiscordSection(): JSX.Element {
  const { t } = useTranslation();
  const [on, setOn] = useState<boolean | null>(null);
  const [status, setStatus] = useState<{ state: DiscordState; message?: string } | null>(null);

  useEffect(() => {
    let live = true;
    void readDiscord().then((value) => live && setOn(value));
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (!on) return;
    let live = true;
    const read = () => void readDiscordStatus().then((next) => live && setStatus(next));
    read();
    const timer = window.setInterval(read, STATUS_POLL_MS);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, [on]);

  const statusText =
    !on || status === null
      ? null
      : status.state === "off"
        ? status.message
          ? t("settings.discord.status.unavailable")
          : null
        : t(STATUS_TEXT[status.state], { message: status.message ?? "" });

  const change = (next: boolean) => {
    setOn(next);
    void writeDiscord(next).then((ok) => {
      if (!ok) setOn(!next);
    });
  };

  return (
    <SettingGroup>
      <SettingRow
        title={t(TITLE)}
        description={t(DESCRIPTION)}
        titleKey={TITLE}
        descKey={DESCRIPTION}
        explained
        control={<Switch checked={on === true} disabled={on === null} label={t(TITLE)} onChange={change} />}
      />
      {statusText ? (
        <p className={styles.note} role="status" data-testid="discord-status" data-state={status?.state}>
          {statusText}
        </p>
      ) : null}
    </SettingGroup>
  );
}
