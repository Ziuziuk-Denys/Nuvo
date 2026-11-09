import { useEffect, useState, type JSX } from "react";
import { Button } from "../../components/Button";
import { TextField } from "../../components/TextField";
import { useTranslation } from "../../ports/i18n";
import {
  disconnectLastfm,
  finishLastfmAuth,
  lastfmErrorKey,
  readLastfm,
  saveLastfmKeys,
  setLastfmEnabled,
  startLastfmAuth,
  type LastfmStatus,
} from "../../ports/lastfm";
import { openExternal } from "../../ports/system";
import { SettingBlock, SettingGroup, SettingRow, Switch } from "./controls";
import { SectionIcon } from "./SectionIcon";
import styles from "./sections.module.css";

const KEY_PAGE = "https://www.last.fm/api/account/create";

export function LastfmSection(): JSX.Element {
  const { t } = useTranslation();
  const [status, setStatus] = useState<LastfmStatus | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    readLastfm().then(
      (value) => live && setStatus(value),
      (failure: unknown) => live && setErrorKey(lastfmErrorKey(failure)),
    );
    return () => {
      live = false;
    };
  }, []);

  const run = async (action: () => Promise<LastfmStatus>): Promise<boolean> => {
    setBusy(true);
    try {
      setStatus(await action());
      setErrorKey(null);
      return true;
    } catch (failure) {
      setErrorKey(lastfmErrorKey(failure));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const saveKeys = async () => {
    if (await run(() => saveLastfmKeys(apiKey.trim(), apiSecret.trim()))) {
      setApiKey("");
      setApiSecret("");
      setToken(null);
    }
  };

  const connect = async () => {
    setBusy(true);
    try {
      const next = await startLastfmAuth();
      setToken(next.token);
      setErrorKey(null);
      openExternal(next.authUrl);
    } catch (failure) {
      setErrorKey(lastfmErrorKey(failure));
    } finally {
      setBusy(false);
    }
  };

  const finish = async (pending: string) => {
    if (await run(() => finishLastfmAuth(pending))) setToken(null);
  };

  const connected = status?.connected === true;
  const state = status?.enabled ? t("settings.lastfm.scrobbling") : t("settings.lastfm.paused");
  const queue = status && status.queued > 0 ? ` · ${t("settings.lastfm.queued", { count: status.queued })}` : "";

  return (
    <div className={styles.lastfm}>
      <div className={styles.account}>
        <span className={styles.avatar} data-loading={status ? undefined : ""}>
          {status ? <SectionIcon id="Lastfm" /> : null}
        </span>
        <span className={styles.accountText}>
          {status ? (
            <>
              <span className={styles.accountName}>{connected ? (status.user ?? "") : t("settings.lastfm.signed_out_title")}</span>
              <span className={styles.accountSub}>
                {connected ? state + queue : t(token ? "settings.lastfm.approve_hint" : "settings.lastfm.signed_out_description")}
              </span>
            </>
          ) : (
            <>
              <span className={styles.skeleton} style={{ width: 110, height: 14 }} />
              <span className={styles.skeleton} style={{ width: 160, height: 11 }} />
            </>
          )}
        </span>
        {connected ? (
          <button type="button" className={styles.accountAction} data-quiet="" disabled={busy} onClick={() => void run(disconnectLastfm)}>
            {t("settings.lastfm.disconnect")}
          </button>
        ) : token ? (
          <button type="button" className={styles.accountAction} disabled={busy} onClick={() => void finish(token)}>
            {t("settings.lastfm.done")}
          </button>
        ) : (
          <button type="button" className={styles.accountAction} disabled={busy || !status?.hasCredentials} onClick={() => void connect()}>
            {t("settings.lastfm.connect")}
          </button>
        )}
      </div>
      {errorKey ? (
        <p className={styles.note} role="alert">
          {t(errorKey)}
        </p>
      ) : null}
      {status?.lastError ? (
        <p className={styles.note} role="status">
          {t("settings.lastfm.last_error", { message: status.lastError })}
        </p>
      ) : null}
      <SettingGroup>
        <SettingRow
          title={t("settings.lastfm.enabled.title")}
          description={t("settings.lastfm.enabled.description")}
          titleKey="settings.lastfm.enabled.title"
          descKey="settings.lastfm.enabled.description"
          explained
          control={
            <Switch
              label={t("settings.lastfm.enabled.title")}
              checked={status?.enabled === true}
              disabled={!connected || busy}
              onChange={(on) => void run(() => setLastfmEnabled(on))}
            />
          }
        />
        {connected ? null : (
          <SettingBlock
            title={t("settings.lastfm.keys.title")}
            description={t("settings.lastfm.keys.description")}
            titleKey="settings.lastfm.keys.title"
            descKey="settings.lastfm.keys.description"
          >
            <TextField
              value={apiKey}
              onChange={setApiKey}
              label={t("settings.lastfm.api_key")}
              placeholder={status?.hasCredentials ? t("settings.lastfm.saved") : t("settings.lastfm.api_key")}
              maxLength={64}
              onSubmit={() => void saveKeys()}
            />
            <TextField
              value={apiSecret}
              onChange={setApiSecret}
              label={t("settings.lastfm.api_secret")}
              placeholder={status?.hasCredentials ? t("settings.lastfm.saved") : t("settings.lastfm.api_secret")}
              type="password"
              maxLength={64}
              onSubmit={() => void saveKeys()}
            />
            <div className={styles.keyActions}>
              <Button size="s" variant="primary" disabled={busy || !apiKey.trim() || !apiSecret.trim()} onClick={() => void saveKeys()}>
                {t("settings.lastfm.save")}
              </Button>
              <Button size="s" onClick={() => openExternal(KEY_PAGE)}>
                {t("settings.lastfm.create_key")}
              </Button>
            </div>
          </SettingBlock>
        )}
      </SettingGroup>
    </div>
  );
}
