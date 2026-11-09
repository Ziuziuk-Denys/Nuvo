import { useEffect, useState, type JSX } from "react";
import { create } from "zustand";
import { Sheet } from "../../components/Sheet";
import { Toggle } from "../../components/Toggle";
import { Icon } from "../../icons/Icon";
import { useTranslation } from "../../ports/i18n";
import { notesFor, takeWhatsNew, useAppVersion } from "../../ports/settings";
import { appFacts, openExternal, systemReport } from "../../ports/system";
import { useTour } from "../../tour/tourStore";
import { formatReport, issueUrl } from "./report";
import styles from "./HelpSheets.module.css";
import sections from "./sections.module.css";

type HelpSheet = "news" | "report";

export const useHelpSheet = create<{ open: HelpSheet | null; show(sheet: HelpSheet): void; close(): void }>((set) => ({
  open: null,
  show: (open) => set({ open }),
  close: () => set({ open: null }),
}));

export function HelpSheets(): JSX.Element {
  const version = useAppVersion();
  const open = useHelpSheet((state) => state.open);
  const close = useHelpSheet((state) => state.close);
  useEffect(() => {
    if (takeWhatsNew(version, notesFor(version).length > 0)) useHelpSheet.getState().show("news");
  }, [version]);
  return (
    <>
      <WhatsNewSheet open={open === "news"} version={version} onClose={close} />
      {open === "report" ? <ReportSheet version={version} onClose={close} /> : null}
    </>
  );
}

function WhatsNewSheet({ open, version, onClose }: { open: boolean; version: string; onClose(): void }): JSX.Element {
  const { t } = useTranslation();
  const notes = notesFor(version).filter((line) => line.trim());
  const items = notes.filter((line) => line.startsWith("- ")).map((line) => line.slice(2));
  const lines = notes.filter((line) => !line.startsWith("- "));
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t("ui.settings.whats_new.title", { version })}
      actions={[{ label: t("common.close"), primary: true, onClick: onClose }]}
    >
      <div className={styles.body}>
        {lines.map((line, index) => (
          <p key={index} className={styles.line}>
            {line}
          </p>
        ))}
        {items.length > 0 ? (
          <ul className={styles.notes}>
            {items.map((item, index) => (
              <li key={index}>{item}</li>
            ))}
          </ul>
        ) : null}
        {notes.length === 0 ? <p className={styles.line}>{t("ui.settings.whats_new.none")}</p> : null}
      </div>
    </Sheet>
  );
}

// Nothing is sent from the app: the browser opens a prefilled GitHub issue for the user
function ReportSheet({ version, onClose }: { version: string; onClose(): void }): JSX.Element {
  const { t } = useTranslation();
  const [withDiagnostics, setWithDiagnostics] = useState(false);
  const [diagnostics, setDiagnostics] = useState<string | null>(null);
  const [system, setSystem] = useState("");
  useEffect(() => {
    let live = true;
    void Promise.all([appFacts(), systemReport()]).then(([app, daemon]) => {
      if (!live) return;
      setSystem(app ? [app.platform, app.compositor].filter((part) => part && part !== "unknown").join(", ") : navigator.platform);
      setDiagnostics(formatReport(app, daemon, new Date()));
    });
    return () => {
      live = false;
    };
  }, []);
  const send = () => {
    openExternal(issueUrl(version, system || navigator.platform, withDiagnostics ? diagnostics : null));
    onClose();
  };
  return (
    <Sheet
      open
      onClose={onClose}
      title={t("ui.settings.problem.title")}
      actions={[
        { label: t("common.cancel"), onClick: onClose },
        { label: t("ui.settings.problem.open"), primary: true, onClick: send },
      ]}
    >
      <div className={styles.body}>
        <p className={styles.line}>{t("ui.settings.problem.line", { version, system: system || "…" })}</p>
        <Toggle checked={withDiagnostics} onChange={setWithDiagnostics} label={t("ui.settings.problem.diagnostics")} />
        {withDiagnostics ? (
          <textarea className={`${styles.diagnostics} n-scroll`} readOnly value={diagnostics ?? ""} aria-label={t("ui.settings.problem.diagnostics")} />
        ) : null}
      </div>
    </Sheet>
  );
}

export function HelpLinks(): JSX.Element {
  const { t } = useTranslation();
  const show = useHelpSheet((state) => state.show);
  return (
    <>
      <button type="button" className={sections.support} onClick={() => show("news")}>
        {t("ui.settings.whats_new.link")}
      </button>
      <button type="button" className={sections.support} onClick={() => useTour.getState().replay()}>
        {t("ui.settings.tour_again")}
      </button>
      <button type="button" className={sections.support} onClick={() => show("report")}>
        {t("ui.settings.problem.title")}
        <Icon name="external" size={14} className={sections.supportArrow} />
      </button>
    </>
  );
}
