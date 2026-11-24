import { useEffect, useState, type JSX } from "react";
import { Sheet, type SheetAction } from "../../components/Sheet";
import { useTranslation } from "../../ports/i18n";
import { detectFormat, dropUserLyrics, isPlayingTrack, loadEditable, saveLyrics, startSync, type LyricsTrack, type SyncLine } from "../../ports/lyricsTools";
import styles from "./Lyrics.module.css";
import { LyricsFinder, useLyricsFinder } from "./LyricsFinder";
import { TimingStage } from "./TimingStage";

interface LyricsEditorProps {
  open: boolean;
  track: LyricsTrack;
  draft?: string | null;
  find?: boolean;
  onClose(): void;
}

export function LyricsEditor({ open, track, draft = null, find = false, onClose }: LyricsEditorProps): JSX.Element | null {
  const { t } = useTranslation();
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [sync, setSync] = useState<SyncLine[] | null>(null);
  const [kept, setKept] = useState<{ text: string; lines: SyncLine[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [finding, setFinding] = useState(false);
  const finder = useLyricsFinder(track);

  useEffect(() => {
    if (!open) return;
    setSync(null);
    setKept(null);
    setFinding(find);
    if (find) finder.start();
    if (draft !== null) {
      setText(draft);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    void loadEditable(track, controller.signal).then(
      (raw) => {
        setText(raw?.content ?? "");
        setLoading(false);
      },
      () => setLoading(false),
    );
    return () => controller.abort();
  }, [open, track, draft, find]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (action: () => Promise<void>) => {
    setError(null);
    try {
      await action();
      onClose();
    } catch {
      setError(t("ui.lyrics.save_failed"));
    }
  };

  const format = detectFormat(text);
  const closeFinder = () => {
    finder.stop();
    setFinding(false);
  };
  const actions: SheetAction[] = finding
    ? [
        { label: t("ui.lyrics.back"), onClick: closeFinder },
        { label: t("ui.lyrics.find_search"), primary: true, disabled: !finder.ready, onClick: finder.run },
      ]
    : [
        {
          label: t("ui.lyrics.find"),
          onClick: () => {
            setFinding(true);
            finder.start();
          },
        },
        { label: t("ui.lyrics.use_found"), onClick: () => void run(() => dropUserLyrics(track)) },
        {
          label: t("ui.lyrics.sync"),
          disabled: text.trim() === "" || !isPlayingTrack(track.id),
          onClick: () => setSync(kept?.text === text ? kept.lines : startSync(text)),
        },
        {
          label: t("ui.lyrics.save"),
          primary: true,
          disabled: text.trim() === "",
          onClick: () => void run(() => saveLyrics(track, { format, content: text })),
        },
      ];

  if (sync) {
    return (
      <TimingStage
        open={open}
        track={track}
        start={sync}
        onBack={(lines) => {
          setKept({ text, lines });
          setSync(null);
        }}
        onSave={async (content) => {
          await saveLyrics(track, { format: "lrc", content });
          onClose();
        }}
      />
    );
  }

  return (
    <Sheet open={open} onClose={onClose} title={t("ui.lyrics.edit_title")} actions={actions}>
      {finding ? (
        <LyricsFinder
          finder={finder}
          track={track}
          onPick={(picked) => {
            setText(picked);
            closeFinder();
          }}
        />
      ) : (
        <>
          <textarea
            className={styles.text}
            value={text}
            disabled={loading}
            aria-label={t("ui.lyrics.text")}
            placeholder={t("ui.lyrics.placeholder")}
            onChange={(event) => setText(event.currentTarget.value)}
          />
          <p className={styles.note}>{t(format === "lrc" ? "ui.lyrics.detected_synced" : "ui.lyrics.detected_plain")}</p>
        </>
      )}
      {error ? (
        <p className={styles.note} role="alert">
          {error}
        </p>
      ) : null}
    </Sheet>
  );
}
