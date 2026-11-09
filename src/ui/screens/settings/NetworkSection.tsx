import { useEffect, useState, type JSX } from "react";
import { Button } from "../../components/Button";
import { checkHeadline } from "../../feedback/connectionAdvice";
import { TextField } from "../../components/TextField";
import { useTranslation, type TFunction } from "../../ports/i18n";
import {
  appFacts,
  onNetworkChanged,
  readProxy,
  readTools,
  runNetworkCheck,
  saveProxy,
  systemReport,
  toolNotes,
  type NetCheck,
  type NetCheckRow,
  type ProxyMode,
  type ProxyView,
  type ToolsView,
} from "../../ports/system";
import { OfflineModeRow } from "./OfflineModeRow";
import { formatReport } from "./report";
import { Segmented, SettingBlock, SettingGroup, SettingRow } from "./controls";
import styles from "./sections.module.css";

const MODES: readonly ProxyMode[] = ["system", "none", "manual"];

function rowText(row: NetCheckRow, t: TFunction): string {
  const what = row.host ? `${row.check} ${row.host}` : row.check;
  const outcome = row.ok ? t("ui.settings.check_ok") : (row.code ?? t("ui.settings.check_fail"));
  return `${what} · ${outcome} · ${row.ms} ms`;
}

function proxyNote(proxy: ProxyView, t: TFunction): string {
  if (proxy.mode === "none") return t("ui.settings.proxy.none_desc");
  if (proxy.mode === "manual") return t("ui.settings.proxy.manual_desc");
  return proxy.inForce ? t("ui.settings.proxy.found", { proxy: proxy.inForce }) : t("ui.settings.proxy.not_found");
}

export function NetworkSection(): JSX.Element {
  const { t } = useTranslation();
  const [proxy, setProxy] = useState<ProxyView | null>(null);
  const [url, setUrl] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [check, setCheck] = useState<NetCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const [copied, setCopied] = useState(false);

  const [tools, setTools] = useState<ToolsView | null>(null);

  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const read = async () => {
      const value = await readTools();
      if (!live) return;
      setTools(value);
      if (value?.download && !value.download.failed) timer = setTimeout(() => void read(), 1000);
    };
    void read();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    let live = true;
    const read = (first: boolean) =>
      void readProxy().then((value) => {
        if (!live || !value) return;
        setProxy((current) => (first || !current ? value : { ...current, inForce: value.inForce }));
        if (!first) return;
        setUrl(value.url ?? "");
        setUsername(value.username ?? "");
      });
    read(true);
    const off = onNetworkChanged(() => read(false));
    return () => {
      live = false;
      off();
    };
  }, []);

  const save = async (next: ProxyView) => {
    const result = await saveProxy(next);
    if (result.ok) {
      setProxy((current) => ({ ...next, inForce: current?.inForce }));
      setError(null);
    } else {
      setError(t("ui.settings.proxy_refused"));
    }
  };

  const saveManual = () => void save({ mode: "manual", url: url.trim(), username: username.trim() || undefined, password: password || undefined });

  const chooseMode = (mode: ProxyMode) => {
    if (mode === "manual") setProxy({ mode, url });
    else void save({ mode });
  };

  const runCheck = async () => {
    setChecking(true);
    try {
      setCheck(await runNetworkCheck());
      setError(null);
    } catch {
      setCheck(null);
      setError(t("ui.settings.check_failed"));
    } finally {
      setChecking(false);
    }
  };

  const copyReport = async () => {
    const [app, daemon] = await Promise.all([appFacts(), systemReport()]);
    await navigator.clipboard.writeText(formatReport(app, daemon, new Date()));
    setCopied(true);
  };

  const headline = check ? checkHeadline(check) : null;

  return (
    <SettingGroup>
      <OfflineModeRow />
      {proxy ? (
        <SettingRow
          title={t("ui.settings.proxy.title")}
          description={proxyNote(proxy, t)}
          titleKey="ui.settings.proxy.title"
          explained
          control={
            <Segmented
              label={t("ui.settings.proxy.title")}
              options={MODES.map((mode) => ({ value: mode, label: t(`ui.settings.proxy.${mode}`) }))}
              value={proxy.mode}
              onChange={chooseMode}
            />
          }
        />
      ) : null}
      {proxy?.mode === "manual" ? (
        <SettingBlock
          title={t("ui.settings.proxy_url")}
          description={t("ui.settings.proxy_url_desc")}
          titleKey="ui.settings.proxy_url"
          descKey="ui.settings.proxy_url_desc"
        >
          <TextField
            value={url}
            onChange={setUrl}
            label={t("ui.settings.proxy_url")}
            placeholder="socks5://127.0.0.1:1080"
            maxLength={300}
            onSubmit={saveManual}
          />
          <TextField
            value={username}
            onChange={setUsername}
            label={t("ui.settings.proxy_username")}
            placeholder={t("ui.settings.proxy_username")}
            maxLength={256}
            onSubmit={saveManual}
          />
          <TextField
            value={password}
            onChange={setPassword}
            label={t("ui.settings.proxy_password")}
            placeholder={t("ui.settings.proxy_password")}
            type="password"
            maxLength={256}
            onSubmit={saveManual}
          />
          <Button size="s" variant="primary" onClick={saveManual}>
            {t("ui.settings.proxy_save")}
          </Button>
        </SettingBlock>
      ) : null}
      {error ? (
        <p className={styles.note} role="alert">
          {error}
        </p>
      ) : null}
      <SettingRow
        title={t("ui.settings.connection")}
        description={t("ui.settings.connection_desc")}
        titleKey="ui.settings.connection"
        descKey="ui.settings.connection_desc"
        explained
        control={
          <Button size="s" disabled={checking} onClick={() => void runCheck()}>
            {t(checking ? "ui.settings.checking" : "ui.settings.check")}
          </Button>
        }
      />
      {check ? (
        <SettingBlock title={t(headline!.key, headline!.vars)}>
          <ul className={styles.note}>
            {check.rows.map((row, index) => (
              <li key={`${row.check}-${row.host ?? ""}-${index}`}>{rowText(row, t)}</li>
            ))}
          </ul>
        </SettingBlock>
      ) : null}
      {tools && toolNotes(tools).length > 0 ? (
        <SettingBlock title={t("ui.settings.tools.title")}>
          <ul className={styles.note}>
            {toolNotes(tools).map((note) => (
              <li key={note.key}>{t(note.key, note.vars)}</li>
            ))}
          </ul>
        </SettingBlock>
      ) : null}
      <SettingRow
        title={t("ui.settings.report")}
        description={t("ui.settings.report_desc")}
        titleKey="ui.settings.report"
        descKey="ui.settings.report_desc"
        explained
        control={
          <Button size="s" onClick={() => void copyReport().catch(() => setError(t("ui.settings.report_failed")))}>
            {t(copied ? "ui.settings.report_copied" : "ui.settings.report_copy")}
          </Button>
        }
      />
    </SettingGroup>
  );
}
