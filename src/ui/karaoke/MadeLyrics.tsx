import { useRef, useState, type CSSProperties, type JSX } from "react";
import { Menu } from "../components/Menu";
import { Icon } from "../icons/Icon";
import { useTranslation, type TFunction } from "../ports/i18n";
import { useLyrics } from "../ports/lyrics";
import { MODEL_MB, cancelMaking, madeBy, makeLyrics, makerOffer, useMadeLyrics, type LyricsHave, type MakerOffer } from "../ports/lyricsMaker";
import type { LyricsTrack } from "../ports/lyricsTools";
import { useAutoWordTiming, useWordTiming } from "../ports/wordTiming";
import { openLyricsTool } from "../screens/lyrics/lyricsTools";
import styles from "./Karaoke.module.css";

// lyrics files are a few kilobytes; anything far bigger is not one
const MAX_FILE_BYTES = 512 * 1024;

const FAILURE_TEXT: Record<string, string> = {
  no_synced_lines: "ui.karaoke.word_timing.no_lines",
  no_audio: "ui.karaoke.word_timing.no_audio",
  no_ffmpeg: "ui.karaoke.word_timing.no_ffmpeg",
  download_failed: "ui.karaoke.word_timing.download_failed",
  lyrics_mismatch: "ui.karaoke.word_timing.mismatch",
  too_long: "ui.karaoke.word_timing.too_long",
  no_vocals: "ui.karaoke.word_timing.no_vocals",
};

function failureText(offer: Extract<MakerOffer, { kind: "failed" }>, t: TFunction): string {
  const known = FAILURE_TEXT[offer.code];
  if (known) return t(known);
  return t(offer.task === "write" ? "ui.karaoke.make.write_failed" : "ui.karaoke.word_timing.failed");
}

function workingText(offer: Extract<MakerOffer, { kind: "working" }>, t: TFunction): string {
  if (offer.phase === "download") {
    const mb = MODEL_MB[offer.model];
    return offer.percent > 0 ? t("ui.karaoke.make.downloading_progress", { mb, percent: offer.percent }) : t("ui.karaoke.make.downloading", { mb });
  }
  if (offer.phase === "prepare") return t("ui.karaoke.word_timing.waiting");
  if (offer.task === "write") return t("ui.karaoke.make.writing", { percent: offer.percent });
  return t(offer.model === "whisper-small" ? "ui.karaoke.word_timing.improving" : "ui.karaoke.word_timing.running", { percent: offer.percent });
}

// a file opens the editor with its text, so nothing is saved unseen
function useLyricsSources(track: LyricsTrack) {
  const { t } = useTranslation();
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const read = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) return setError(t("ui.karaoke.make.file_too_big"));
    setError(null);
    openLyricsTool(track, "edit", await file.text());
  };
  const picker = (
    <input
      ref={input}
      type="file"
      accept=".lrc,.txt,text/plain"
      hidden
      onChange={(event) => {
        void read(event.currentTarget.files?.[0]);
        event.currentTarget.value = "";
      }}
    />
  );
  return { picker, error, paste: () => openLyricsTool(track, "edit", ""), pickFile: () => input.current?.click() };
}

function Working({ offer, trackId }: { offer: Extract<MakerOffer, { kind: "working" }>; trackId: string }): JSX.Element {
  const { t } = useTranslation();
  const known = offer.phase === "running" || (offer.phase === "download" && offer.percent > 0);
  return (
    <div className={styles.working} aria-live="polite">
      <p>{workingText(offer, t)}</p>
      <span
        role="progressbar"
        aria-label={workingText(offer, t)}
        aria-valuenow={known ? offer.percent : undefined}
        aria-valuemin={0}
        aria-valuemax={100}
        className={styles.meter}
        data-known={known ? "" : undefined}
        style={{ "--done": offer.percent / 100 } as CSSProperties}
      />
      <button type="button" className={styles.textButton} onClick={() => void cancelMaking(trackId, "none")}>
        {t("ui.karaoke.make.cancel")}
      </button>
    </div>
  );
}

export function AddLyrics({ track }: { track: LyricsTrack }): JSX.Element {
  const { t } = useTranslation();
  const timing = useWordTiming();
  const offer = makerOffer(timing, useMadeLyrics(), track.id, "none");
  const sources = useLyricsSources(track);
  if (offer.kind === "working") {
    return (
      <div className={styles.quiet}>
        <Working offer={offer} trackId={track.id} />
      </div>
    );
  }
  return (
    <div className={styles.quiet}>
      <p>{offer.kind === "failed" ? failureText(offer, t) : t("ui.karaoke.no_lyrics")}</p>
      {offer.kind !== "none" ? (
        <div className={styles.maker}>
          <button type="button" className={styles.addLyrics} data-add-lyrics="" onClick={() => void makeLyrics(timing, track.id, "none")}>
            {t("ui.karaoke.make.write")}
          </button>
          <p className={styles.makerNote}>
            {t("ui.karaoke.make.write_note")}
            {offer.kind === "offer" && offer.downloadMb ? <span>{t("ui.karaoke.make.download", { mb: offer.downloadMb })}</span> : null}
          </p>
        </div>
      ) : null}
      <div className={styles.sources}>
        <button type="button" className={offer.kind === "none" ? styles.addLyrics : styles.textButton} data-add-lyrics="" onClick={sources.paste}>
          {t("ui.karaoke.make.paste")}
        </button>
        <button type="button" className={offer.kind === "none" ? styles.addLyrics : styles.textButton} onClick={sources.pickFile}>
          {t("ui.karaoke.make.file")}
        </button>
      </div>
      {sources.error ? <p role="alert">{sources.error}</p> : null}
      {sources.picker}
    </div>
  );
}

export function TimeWords({ trackId, have }: { trackId: string | null; have: LyricsHave }): JSX.Element | null {
  const { t } = useTranslation();
  const timing = useWordTiming();
  const made = useMadeLyrics();
  useAutoWordTiming(trackId, have === "lines");
  const offer = makerOffer(timing, made, trackId, have);
  const note = have === "lines" ? <span className={styles.lineOnly}>{t("ui.karaoke.highlight_line_only")}</span> : null;
  if (offer.kind === "working" && trackId) {
    return (
      <>
        <span className={styles.lineOnly} aria-live="polite">
          {workingText(offer, t)}
        </span>
        <button
          type="button"
          aria-label={t("ui.karaoke.make.cancel")}
          title={t("ui.karaoke.make.cancel")}
          className={styles.small}
          onClick={() => void cancelMaking(trackId, have)}
        >
          <Icon name="close" size={16} />
        </button>
      </>
    );
  }
  if (offer.kind === "failed") return <span className={styles.lineOnly}>{failureText(offer, t)}</span>;
  if (offer.kind === "none" || !trackId) return note;
  const hint =
    t(have === "plain" ? "ui.karaoke.make.time_hint_plain" : "ui.karaoke.make.time_hint") +
    (offer.kind === "offer" && offer.downloadMb ? " " + t("ui.karaoke.make.download", { mb: offer.downloadMb }) : "");
  return (
    <>
      {note}
      <button type="button" title={hint} className={styles.words} onClick={() => void makeLyrics(timing, trackId, have)}>
        {t("ui.karaoke.make.time")}
      </button>
    </>
  );
}

export function MadeMark({ track }: { track: LyricsTrack }): JSX.Element | null {
  const { t } = useTranslation();
  const made = madeBy(useLyrics((state) => state.versions.find((version) => version.provider === state.activeVersion)?.made));
  const sources = useLyricsSources(track);
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  if (!made) return null;
  return (
    <div className={styles.made} data-no-window-drag>
      <span>{t(made === "written" ? "ui.karaoke.make.written" : "ui.karaoke.make.timed")}</span>
      <button type="button" className={styles.textButton} onClick={() => openLyricsTool(track, "edit")}>
        {t("ui.karaoke.make.edit")}
      </button>
      <button
        type="button"
        className={styles.textButton}
        aria-haspopup="menu"
        aria-expanded={anchor !== null}
        onClick={(event) => setAnchor(event.currentTarget)}
      >
        {t("ui.karaoke.make.replace")}
      </button>
      <Menu
        open={anchor !== null}
        anchor={anchor}
        onClose={() => setAnchor(null)}
        className={styles.versionMenu}
        items={[
          { label: t("ui.karaoke.make.paste"), onSelect: sources.paste },
          { label: t("ui.karaoke.make.file"), onSelect: sources.pickFile },
        ]}
      />
      {sources.error ? <span role="alert">{sources.error}</span> : null}
      {sources.picker}
    </div>
  );
}
