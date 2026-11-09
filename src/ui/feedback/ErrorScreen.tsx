import { useId, useMemo, useState, type JSX } from "react";
import { Button } from "../components/Button";
import { Icon } from "../icons/Icon";
import { APP_VERSION } from "../ports/feedback";
import { useTranslation } from "../ports/i18n";
import styles from "./ErrorScreen.module.css";
import { StateCard } from "./StateCard";

interface ErrorScreenProps {
  error: Error;
  componentStack: string | null;
  onReload: () => void;
}

function report(error: Error, componentStack: string | null): string {
  const lines = [
    `Nuvo ${APP_VERSION}`,
    `Time: ${new Date().toISOString()}`,
    `URL: ${window.location.href}`,
    "",
    error.stack ?? `${error.name}: ${error.message}`,
  ];
  if (componentStack) lines.push("", "Component stack:", componentStack.trim());
  return lines.join("\n");
}

export function ErrorScreen({ error, componentStack, onReload }: ErrorScreenProps): JSX.Element {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState(false);
  const detailsId = useId();
  const details = useMemo(() => report(error, componentStack), [error, componentStack]);

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
    <div className={styles.window}>
      <div className={styles.panel} />
      <StateCard role="alertdialog" title={t("ui.error.title")} line={t("ui.error.line")} glyph={<Icon name="warning" size={24} />}>
        <Button variant="primary" className={styles.reload} onClick={onReload}>
          <Icon name="refresh" size={16} />
          {t("ui.error.reload")}
        </Button>
        <Button variant="text" size="s" className={styles.toggle} aria-expanded={open} aria-controls={detailsId} onClick={() => setOpen((value) => !value)}>
          {t("ui.error.details")}
          <Icon name="chevron-down" size={14} className={styles.chevron} />
        </Button>
        <div id={detailsId} className={styles.more} hidden={!open}>
          {open ? (
            <>
              <pre className={styles.details}>{details}</pre>
              <Button variant="text" size="s" className={styles.copy} onClick={() => void copy()}>
                <Icon name={copied ? "check" : "copy"} size={14} />
                {t(copied ? "ui.error.copied" : "ui.error.copy")}
              </Button>
            </>
          ) : null}
        </div>
      </StateCard>
    </div>
  );
}
