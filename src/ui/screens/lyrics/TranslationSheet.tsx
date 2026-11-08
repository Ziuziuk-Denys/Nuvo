import { useEffect, useState, type JSX } from "react";
import { Sheet } from "../../components/Sheet";
import { useTranslation } from "../../ports/i18n";
import { NoTranslatorError, translateTrack, type LyricsTrack } from "../../ports/lyricsTools";
import styles from "./Lyrics.module.css";

type View = { kind: "loading" } | { kind: "error"; key: string } | { kind: "done"; original: string[]; translated: string[] };

interface TranslationSheetProps {
  open: boolean;
  track: LyricsTrack;
  onClose(): void;
}

/** Each line with its translation from a local model under it. Nothing is sent off the machine. */
export function TranslationSheet({ open, track, onClose }: TranslationSheetProps): JSX.Element | null {
  const { t } = useTranslation();
  const [view, setView] = useState<View>({ kind: "loading" });

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setView({ kind: "loading" });
    void translateTrack(track, controller.signal).then(
      (result) => {
        if (controller.signal.aborted) return;
        setView(result.original.length === 0 ? { kind: "error", key: "ui.lyrics.translate_none" } : { kind: "done", ...result });
      },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        setView({ kind: "error", key: error instanceof NoTranslatorError ? "ui.lyrics.translate_no_model" : "ui.lyrics.translate_failed" });
      },
    );
    return () => controller.abort();
  }, [open, track]);

  return (
    <Sheet open={open} onClose={onClose} title={t("ui.lyrics.translate_title")} actions={[{ label: t("ui.lyrics.close"), primary: true, onClick: onClose }]}>
      {view.kind === "loading" ? <p className={styles.note}>{t("ui.lyrics.translating")}</p> : null}
      {view.kind === "error" ? (
        <p className={styles.note} role="alert">
          {t(view.key)}
        </p>
      ) : null}
      {view.kind === "done" ? (
        <ol className={styles.lines}>
          {view.original.map((line, index) => (
            <li key={index} className={styles.pair}>
              <span className={styles.original}>{line}</span>
              <span className={styles.translated}>{view.translated[index]}</span>
            </li>
          ))}
        </ol>
      ) : null}
    </Sheet>
  );
}
