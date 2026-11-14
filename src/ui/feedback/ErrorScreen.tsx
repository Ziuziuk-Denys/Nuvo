import { useId, useLayoutEffect, useMemo, useState, type JSX } from "react";
import { Button } from "../components/Button";
import { Icon } from "../icons/Icon";
import { APP_VERSION, recentLog } from "../ports/feedback";
import { useTranslation } from "../ports/i18n";
import { applySavedLook } from "../ports/theme";
import styles from "./ErrorScreen.module.css";
import { StateCard } from "./StateCard";

interface ErrorScreenProps {
  error: Error;
  componentStack: string | null;
  onReload: () => void;
}

const LOG_LINES = 20;

// The route says where it broke; file URLs and home folders are cut so a pasted report names no one
export function report(error: Error, componentStack: string | null, log: string[]): string {
  const lines = [
    `Nuvo ${APP_VERSION}`,
    `Time: ${new Date().toISOString()}`,
    `Page: ${window.location.hash || "#/"}`,
    "",
    error.stack ?? `${error.name}: ${error.message}`,
  ];
  if (componentStack) lines.push("", "Component stack:", componentStack.trim());
  if (log.length > 0) lines.push("", "Log:", ...log.slice(-LOG_LINES));
  return lines
    .join("\n")
    .replace(/file:\/\/\S*?\/([^/\s()]+:\d+:\d+)/g, "$1")
    .replace(/\/(?:home|Users)\/[^/\s"']+/g, "~");
}

export function ErrorScreen({ error, componentStack, onReload }: ErrorScreenProps): JSX.Element {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState(false);
  const detailsId = useId();
  const details = useMemo(() => report(error, componentStack, recentLog()), [error, componentStack]);

  useLayoutEffect(applySavedLook, []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(details);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // the clipboard refused; the details stay selectable in the box
    }
  };

  return (
    <StateCard role="alertdialog" title={t("ui.error.title")} line={t("ui.error.line")}>
      <div className={styles.actions}>
        <Button variant="primary" className={styles.action} onClick={onReload}>
          <Icon name="refresh" size={16} />
          {t("ui.error.reload")}
        </Button>
        <Button className={styles.action} onClick={() => void copy()}>
          <Icon name={copied ? "check" : "copy"} size={16} />
          {t(copied ? "ui.error.copied" : "ui.error.copy")}
        </Button>
      </div>
      <Button variant="text" size="s" className={styles.toggle} aria-expanded={open} aria-controls={detailsId} onClick={() => setOpen((value) => !value)}>
        {t("ui.error.details")}
        <Icon name="chevron-down" size={14} className={styles.chevron} />
      </Button>
      <div id={detailsId} className={styles.more} hidden={!open}>
        {open ? <pre className={styles.details}>{details}</pre> : null}
      </div>
    </StateCard>
  );
}
