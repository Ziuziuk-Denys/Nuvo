import { useContext, useEffect, useState, type JSX } from "react";
import { create } from "zustand";
import { Sheet } from "../../components/Sheet";
import { Toggle } from "../../components/Toggle";
import { Icon } from "../../icons/Icon";
import { useTranslation } from "../../ports/i18n";
import { notesFor, takeWhatsNew, useAppVersion } from "../../ports/settings";
import { appFacts, openExternal, systemReport } from "../../ports/system";
import { useTour } from "../../tour/tourStore";
import { SearchQuery } from "./controls";
import { Markdown } from "./markdown";
import { formatReport, issueUrl } from "./report";
import { matchesQuery } from "./sections";
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
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t("ui.settings.whats_new.title", { version })}
      actions={[{ label: t("common.close"), primary: true, onClick: onClose }]}
    >
      <ReleaseNotes version={version} className={`${styles.news} n-scroll`} />
    </Sheet>
  );
}

export function ReleaseNotes({ version, className }: { version: string; className?: string }): JSX.Element {
  const { t } = useTranslation();
  const notes = notesFor(version).join("\n");
  return notes.trim() ? <Markdown text={notes} className={className} tracks /> : <p className={styles.line}>{t("ui.settings.whats_new.none")}</p>;
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
  const query = useContext(SearchQuery);
  const links = [
    { key: "ui.settings.tour_again", icon: "forward", run: () => useTour.getState().replay() },
    { key: "ui.settings.problem.title", icon: "external", run: () => show("report") },
  ] as const;
  return (
    <>
      {links
        .filter((link) => matchesQuery(query, [link.key]))
        .map((link) => (
          <button key={link.key} type="button" className={sections.action} onClick={link.run}>
            {t(link.key)}
            <Icon name={link.icon} size={16} className={sections.actionIcon} />
          </button>
        ))}
    </>
  );
}
