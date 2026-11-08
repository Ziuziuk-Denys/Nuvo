import { useEffect, useRef, useState, type JSX, type KeyboardEvent } from "react";
import { Sheet, type SheetAction } from "../../components/Sheet";
import { useTranslation } from "../../ports/i18n";
import {
  clearStamp,
  detectFormat,
  dropUserLyrics,
  formatStamp,
  isComplete,
  isPlayingTrack,
  loadEditable,
  markEnd,
  nudge,
  playbackPositionMs,
  saveLyrics,
  stamp,
  startSync,
  toLrc,
  type LyricsTrack,
  type SyncLine,
} from "../../ports/lyricsTools";
import styles from "./Lyrics.module.css";

interface LyricsEditorProps {
  open: boolean;
  track: LyricsTrack;
  onClose(): void;
}

/** Paste or fix lyrics; plain text can be synced with Space while the track plays. */
export function LyricsEditor({ open, track, onClose }: LyricsEditorProps): JSX.Element | null {
  const { t } = useTranslation();
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [sync, setSync] = useState<SyncLine[] | null>(null);
  const [index, setIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const list = useRef<HTMLOListElement>(null);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setLoading(true);
    setSync(null);
    void loadEditable(track, controller.signal).then(
      (raw) => {
        setText(raw?.content ?? "");
        setLoading(false);
      },
      () => setLoading(false),
    );
    return () => controller.abort();
  }, [open, track]);

  useEffect(() => {
    if (sync) list.current?.focus();
  }, [sync !== null]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (action: () => Promise<void>) => {
    setError(null);
    try {
      await action();
      onClose();
    } catch {
      setError(t("ui.lyrics.save_failed"));
    }
  };

  const onSyncKey = (event: KeyboardEvent<HTMLOListElement>) => {
    if (!sync) return;
    const step = event.shiftKey ? 1000 : 100;
    const keys: Record<string, () => void> = {
      " ": () => {
        const done = stamp(sync, index, playbackPositionMs());
        setSync(done.lines);
        setIndex(done.next);
      },
      Enter: () => {
        const done = markEnd(sync, index - 1, playbackPositionMs());
        setSync(done.lines);
        setIndex(done.next);
      },
      ArrowUp: () => setIndex(Math.max(0, index - 1)),
      ArrowDown: () => setIndex(Math.min(sync.length, index + 1)),
      ArrowLeft: () => setSync(nudge(sync, index, -step)),
      ArrowRight: () => setSync(nudge(sync, index, step)),
      Backspace: () => setSync(clearStamp(sync, index)),
    };
    const handle = keys[event.key];
    if (!handle) return;
    // Space must stamp, not reach the player's play/pause shortcut
    event.preventDefault();
    event.stopPropagation();
    handle();
  };

  const format = detectFormat(text);
  const actions: SheetAction[] = sync
    ? [
        { label: t("ui.lyrics.back"), onClick: () => setSync(null) },
        {
          label: t("ui.lyrics.save_synced"),
          primary: true,
          disabled: !isComplete(sync),
          onClick: () => void run(() => saveLyrics(track, { format: "lrc", content: toLrc(sync) })),
        },
      ]
    : [
        { label: t("ui.lyrics.use_found"), onClick: () => void run(() => dropUserLyrics(track)) },
        {
          label: t("ui.lyrics.sync"),
          disabled: format !== "plain" || text.trim() === "" || !isPlayingTrack(track.id),
          onClick: () => {
            setSync(startSync(text));
            setIndex(0);
          },
        },
        {
          label: t("ui.lyrics.save"),
          primary: true,
          disabled: text.trim() === "",
          onClick: () => void run(() => saveLyrics(track, { format, content: text })),
        },
      ];

  return (
    <Sheet open={open} onClose={onClose} title={t("ui.lyrics.edit_title")} actions={actions}>
      {sync ? (
        <>
          <ol ref={list} tabIndex={0} className={styles.lines} aria-label={t("ui.lyrics.sync_list")} onKeyDown={onSyncKey}>
            {sync.map((line, at) => (
              <li key={at} aria-current={at === index ? "true" : undefined}>
                <span className={styles.stamp}>{line.atMs === null ? "--:--.--" : formatStamp(line.atMs).slice(1, -1)}</span>
                {line.text}
              </li>
            ))}
          </ol>
          <p className={styles.note}>{t("ui.lyrics.sync_hint")}</p>
        </>
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
