import { useEffect, useRef, useState, type CSSProperties, type JSX, type KeyboardEvent, type PointerEvent } from "react";
import { useShallow } from "zustand/react/shallow";
import { Cover } from "../components/Cover";
import { Menu } from "../components/Menu";
import { MorphPlayIcon } from "../components/MorphPlayIcon";
import { Icon } from "../icons/Icon";
import type { IconName } from "../icons";
import { isEscapeGuarded } from "../ports/escape";
import { useTranslation } from "../ports/i18n";
import { useIsTrackLiked, useLikeTrack, useUnlikeTrack } from "../ports/library";
import { songMenuNotInterested } from "../recs/notInterested";
import { lyricsCommands, lyricsErrorText, useLyrics, versionLabel } from "../ports/lyrics";
import { canMinimizeWindow, closeWindow, minimizeWindow, toggleMaximizeWindow, useWindowState } from "../ports/navigation";
import { isRadioContext, nextRepeatMode, playerEngine, toVolumeGain, toVolumeLevel, usePlayerStore } from "../ports/player";
import { formatTime } from "../shell/island/Scrubber";
import { Backdrop } from "./backdrop/Backdrop";
import { layoutFor } from "./layout";
import { LyricsPane } from "./LyricsPane";
import { useRomanization } from "./romanization";
import { openLyricsTool } from "../screens/lyrics/lyricsTools";
import type { LyricsTrack } from "../ports/lyricsTools";
import { HIGHLIGHT_MODES, setHighlightMode, useHighlightMode, type HighlightMode } from "./highlightMode";
import { isLocalTiming, isRunning, setWordTiming, timeWords, useAutoWordTiming, useWordTiming } from "../ports/wordTiming";
import styles from "./Karaoke.module.css";

const MODE_TEXT: Record<HighlightMode, { label: string; hint: string }> = {
  line: { label: "ui.karaoke.highlight_line", hint: "ui.karaoke.highlight_line_hint" },
  word: { label: "ui.karaoke.highlight_word", hint: "ui.karaoke.highlight_word_hint" },
  fill: { label: "ui.karaoke.highlight_fill", hint: "ui.karaoke.highlight_fill_hint" },
  step: { label: "ui.karaoke.highlight_step", hint: "ui.karaoke.highlight_step_hint" },
};
const SEEK_STEP_MS = 5_000;
const VOLUME_STEP = 0.05;
const DEFAULT_VOLUME_LEVEL = 0.7;
const WIDE = layoutFor(1200);
const NARROW = layoutFor(1100);
// Column edges interpolate linearly between the measured 1100 px and 1200 px windows
const along = (wide: number, narrow: number, width: number) => narrow + ((wide - narrow) * (width - 1100)) / 100;

function useWindowWidth(): number {
  const [width, setWidth] = useState(() => window.innerWidth);
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return width;
}

interface GlyphButtonProps {
  icon: IconName;
  label: string;
  className?: string;
  onClick(): void;
  size?: 18 | 20 | 24;
  on?: boolean;
}

function GlyphButton({ icon, label, className, onClick, size = 20, on }: GlyphButtonProps): JSX.Element {
  return (
    <button type="button" aria-label={label} aria-pressed={on} data-on={on ? "" : undefined} className={className} onClick={onClick} data-no-window-drag>
      <Icon name={icon} size={size} />
    </button>
  );
}

interface BarProps {
  label: string;
  value: number;
  valueNow: number;
  valueMax: number;
  valueText: string;
  className: string;
  onChange(fraction: number, final: boolean): void;
  onStep(direction: 1 | -1): void;
}

function Bar({ label, value, valueNow, valueMax, valueText, className, onChange, onStep }: BarProps): JSX.Element {
  const [drag, setDrag] = useState<number | null>(null);
  const shown = Math.min(1, Math.max(0, drag ?? value));
  const at = (event: PointerEvent<HTMLElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    return box.width > 0 ? Math.min(1, Math.max(0, (event.clientX - box.left) / box.width)) : 0;
  };
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const direction = event.key === "ArrowRight" || event.key === "ArrowUp" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowDown" ? -1 : 0;
    if (direction === 0) return;
    event.preventDefault();
    onStep(direction);
  };
  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={valueMax}
      aria-valuenow={valueNow}
      aria-valuetext={valueText}
      className={`${styles.bar} ${className}`}
      style={{ "--fraction": shown } as CSSProperties}
      data-no-window-drag
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.currentTarget.setPointerCapture?.(event.pointerId);
        const next = at(event);
        setDrag(next);
        onChange(next, false);
      }}
      onPointerMove={(event) => {
        if (drag === null) return;
        const next = at(event);
        setDrag(next);
        onChange(next, false);
      }}
      onPointerUp={(event) => {
        if (drag === null) return;
        setDrag(null);
        onChange(at(event), true);
      }}
      onPointerCancel={() => setDrag(null)}
      onKeyDown={onKeyDown}
    >
      <span className={styles.fill} />
    </div>
  );
}

function NoLyricsGlyph(): JSX.Element {
  return (
    <svg
      width="48"
      height="48"
      viewBox="0 0 48 48"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="37" r="6" />
      <circle cx="36" cy="32.5" r="6" />
      <path d="M18 37V10.5L42 6.5V32.5" />
      <path d="M4 4.5L44.5 45" />
    </svg>
  );
}

function SpeakerGlyph(): JSX.Element {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
      <path
        fill="currentColor"
        stroke="none"
        d="M3 9.6c0-.9.7-1.6 1.6-1.6h2.6l4.3-3.3c.9-.7 2.2-.1 2.2 1.1v12.4c0 1.2-1.3 1.8-2.2 1.1L7.2 16H4.6c-.9 0-1.6-.7-1.6-1.6z"
      />
      <path d="M17 9.2c.8.8 1.2 1.8 1.2 2.8s-.4 2-1.2 2.8M19.6 7c1.3 1.4 2 3.1 2 5s-.7 3.6-2 5" />
    </svg>
  );
}

function VersionButton(): JSX.Element | null {
  const { t } = useTranslation();
  const versions = useLyrics((state) => state.versions);
  const active = useLyrics((state) => state.activeVersion);
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  if (versions.length < 2) return null;
  return (
    <>
      <button
        ref={setAnchor}
        type="button"
        aria-label={t("ui.karaoke.version")}
        aria-haspopup="menu"
        aria-expanded={open}
        className={styles.small}
        onClick={() => setOpen(true)}
        data-no-window-drag
      >
        <Icon name="lyrics" size={18} />
      </button>
      <Menu
        open={open}
        anchor={anchor}
        onClose={() => setOpen(false)}
        className={styles.versionMenu}
        items={versions.map((version) => ({
          label: versionLabel(version, t),
          icon: version.provider === active ? "check" : undefined,
          onSelect: () => lyricsCommands.chooseVersion(version.provider),
        }))}
      />
    </>
  );
}

const FAILURE_TEXT: Record<string, string> = {
  no_synced_lines: "ui.karaoke.word_timing.no_lines",
  no_audio: "ui.karaoke.word_timing.no_audio",
  no_ffmpeg: "ui.karaoke.word_timing.no_ffmpeg",
  download_failed: "ui.karaoke.word_timing.download_failed",
  lyrics_mismatch: "ui.karaoke.word_timing.mismatch",
  too_long: "ui.karaoke.word_timing.too_long",
};

function WordTimingControl({ trackId, lineOnly }: { trackId: string | null; lineOnly: boolean }): JSX.Element | null {
  const { t } = useTranslation();
  const view = useWordTiming();
  const active = useLyrics((state) => state.activeVersion);
  useAutoWordTiming(trackId, lineOnly);
  const lineOnlyText = lineOnly ? <span className={styles.lineOnly}>{t("ui.karaoke.highlight_line_only")}</span> : null;
  if (!view || !trackId || (!lineOnly && !isLocalTiming(active))) return lineOnlyText;
  const job = view.job?.trackId === trackId ? view.job : undefined;
  const percent = Math.round((job?.progress ?? 0) * 100);
  let status: string | null = null;
  if (view.enabled && isRunning(job, trackId)) {
    const key =
      job.state === "waiting"
        ? "ui.karaoke.word_timing.waiting"
        : job.model === "whisper-small"
          ? "ui.karaoke.word_timing.improving"
          : "ui.karaoke.word_timing.running";
    status = t(key, { percent });
  } else if (view.enabled && lineOnly && job?.state === "failed") {
    status = t(FAILURE_TEXT[job.code ?? ""] ?? "ui.karaoke.word_timing.failed");
  }
  const canImprove = view.enabled && active === "whisper-base" && !isRunning(job, trackId);
  return (
    <>
      {status ? null : lineOnlyText}
      <button
        type="button"
        aria-pressed={view.enabled}
        data-on={view.enabled ? "" : undefined}
        title={t(view.enabled ? "ui.karaoke.word_timing.off_hint" : "ui.karaoke.word_timing.on_hint")}
        className={styles.words}
        onClick={() => void setWordTiming(!view.enabled).then(() => (view.enabled ? undefined : timeWords(trackId)))}
      >
        {t("ui.karaoke.word_timing.switch")}
      </button>
      {status ? (
        <span className={styles.lineOnly} role="status">
          {status}
        </span>
      ) : null}
      {canImprove ? (
        <button type="button" title={t("ui.karaoke.word_timing.improve_hint")} className={styles.words} onClick={() => void timeWords(trackId, true)}>
          {t("ui.karaoke.word_timing.improve")}
        </button>
      ) : null}
    </>
  );
}

function OffsetPill({ mode }: { mode: HighlightMode }): JSX.Element {
  const { t } = useTranslation();
  const offsetMs = useLyrics((state) => state.offsetMs);
  const { available, kanaOnly, on, toggle } = useRomanization();
  const synced = useLyrics((state) => state.synced);
  const wordTimed = useLyrics((state) => state.wordTimed);
  const trackId = useLyrics((state) => state.trackId);
  const busy = isRunning(useWordTiming()?.job, trackId);
  return (
    <div className={styles.sourceRow} data-busy={busy ? "" : undefined}>
      <div className={styles.pill} data-no-window-drag>
        <GlyphButton icon="remove" size={18} label={t("ui.karaoke.earlier")} className={styles.small} onClick={() => lyricsCommands.nudgeOffset(-100)} />
        <button type="button" aria-label={t("ui.karaoke.offset")} className={styles.offset} onClick={() => lyricsCommands.clearOffset()}>
          {`${(offsetMs / 1000).toFixed(1)}s`}
        </button>
        <GlyphButton icon="add" size={18} label={t("ui.karaoke.later")} className={styles.small} onClick={() => lyricsCommands.nudgeOffset(100)} />
        <VersionButton />
        {available ? (
          <button
            type="button"
            aria-label={t(kanaOnly ? "ui.karaoke.romanize_kana" : "ui.karaoke.romanize")}
            title={t(kanaOnly ? "ui.karaoke.romanize_kana" : "ui.karaoke.romanize")}
            aria-pressed={on}
            data-on={on ? "" : undefined}
            className={styles.romaji}
            onClick={toggle}
          >
            Aa
          </button>
        ) : null}
        {wordTimed ? (
          <div role="group" aria-label={t("ui.karaoke.highlight")} className={styles.modes}>
            {HIGHLIGHT_MODES.map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={option === mode}
                data-on={option === mode ? "" : undefined}
                title={t(MODE_TEXT[option].hint)}
                className={styles.words}
                onClick={() => setHighlightMode(option)}
              >
                {t(MODE_TEXT[option].label)}
              </button>
            ))}
          </div>
        ) : null}
        {synced ? <WordTimingControl trackId={trackId} lineOnly={!wordTimed} /> : null}
      </div>
    </div>
  );
}

function LyricsColumn({ track, mode }: { track: LyricsTrack | null; mode: HighlightMode }): JSX.Element | null {
  const { t } = useTranslation();
  const trackId = track?.id ?? null;
  const status = useLyrics((state) => (state.trackId === trackId ? state.status : "loading"));
  if (status === "ready") {
    return (
      <div className={styles.lines}>
        <LyricsPane onSeek={(ms) => void playerEngine.seek(ms)} layout={WIDE.lyrics} mode={mode} />
      </div>
    );
  }
  const text = status === "none" ? t("ui.karaoke.no_lyrics") : status === "instrumental" ? t("ui.karaoke.instrumental") : lyricsErrorText({ status }, t);
  if (!text) return null;
  return (
    <div className={styles.quiet}>
      {status === "error" ? null : <NoLyricsGlyph />}
      <p>{text}</p>
      {status === "none" && track ? (
        <button type="button" className={styles.addLyrics} data-add-lyrics="" onClick={() => openLyricsTool(track, "edit")}>
          {t("ui.karaoke.add_lyrics")}
        </button>
      ) : null}
    </div>
  );
}

function Timeline({ fallbackMs }: { fallbackMs: number }): JSX.Element {
  const { t } = useTranslation();
  const playerDurationMs = usePlayerStore((state) => state.durationMs);
  const playerPositionMs = usePlayerStore((state) => state.positionMs);
  const durationMs = playerDurationMs > 0 ? playerDurationMs : fallbackMs;
  const positionMs = Math.min(playerPositionMs, durationMs);
  return (
    <>
      <Bar
        label={t("ui.karaoke.seek")}
        className={styles.seek}
        value={durationMs > 0 ? positionMs / durationMs : 0}
        valueNow={Math.round(positionMs / 1000)}
        valueMax={Math.round(durationMs / 1000)}
        valueText={`${formatTime(positionMs)} / ${formatTime(durationMs)}`}
        onChange={(fraction, final) => {
          if (final && durationMs > 0) void playerEngine.seek(Math.round(fraction * durationMs));
        }}
        onStep={(direction) => {
          if (durationMs > 0) void playerEngine.seek(Math.min(durationMs, Math.max(0, positionMs + direction * SEEK_STEP_MS)));
        }}
      />
      <div className={styles.times}>
        <span>{formatTime(positionMs)}</span>
        <span>{formatTime(durationMs)}</span>
      </div>
    </>
  );
}

export function Karaoke({ onClose }: { onClose(): void }): JSX.Element {
  const { t } = useTranslation();
  // everything but the position: the timeline re-renders on its own as the song plays
  const player = usePlayerStore(
    useShallow((state) => ({
      currentTrack: state.currentTrack,
      status: state.status,
      volume: state.volume,
      shuffle: state.shuffle,
      repeat: state.repeat,
      playbackContext: state.playbackContext,
    })),
  );
  const track = player.currentTrack;
  const width = useWindowWidth();
  const liked = useIsTrackLiked(track?.id);
  const like = useLikeTrack();
  const unlike = useUnlikeTrack();
  const { isFullScreen, isMaximized } = useWindowState();
  const lyricsReady = useLyrics((state) => state.status === "ready" && state.trackId === (track?.id ?? null));
  const wordTimed = useLyrics((state) => state.wordTimed);
  const chosenMode = useHighlightMode();
  const mode = wordTimed ? chosenMode : "line";
  const restoreLevel = useRef(DEFAULT_VOLUME_LEVEL);

  // the engine drops a repeat for the same track
  useEffect(() => {
    if (track) lyricsCommands.follow(track);
  }, [track]);

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      // the app's shortcut layer closes the view first and marks the key handled
      const typing = event.target instanceof HTMLElement && event.target.closest("input, textarea, [contenteditable]");
      if (event.defaultPrevented || typing || isEscapeGuarded()) return;
      if (event.key === "Escape" || event.key === "f" || event.key === "F") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const playing = player.status === "playing" || player.status === "loading";
  const level = toVolumeLevel(player.volume ?? 1);
  const setLevel = (next: number) => {
    const clamped = Math.min(1, Math.max(0, next));
    if (clamped > 0) restoreLevel.current = clamped;
    playerEngine.setVolume(toVolumeGain(clamped));
  };

  const vars = {
    "--k-left": `${Math.max(24, along(WIDE.cover.x, NARROW.cover.x, width))}px`,
    "--k-lyrics": `${along(WIDE.lyrics.x, NARROW.lyrics.x, width)}px`,
    "--k-lines": `${WIDE.lyrics.width}px`,
  } as CSSProperties;
  const maximized = isMaximized || isFullScreen;

  return (
    <div className={styles.root} style={vars} data-theme="dark">
      <Backdrop cover={track?.coverUrl ?? ""} open />

      <header className={styles.top} data-window-drag>
        <div className={`${styles.pill} ${styles.closePill}`}>
          <GlyphButton icon="chevron-down" size={18} label={t("ui.karaoke.close")} className={styles.close} onClick={onClose} />
        </div>
        {lyricsReady ? <OffsetPill mode={mode} /> : null}
        <div className={`${styles.pill} ${styles.windowPill}`} data-window-controls>
          <GlyphButton
            icon="window-minimize"
            label={t("ui.window.minimize")}
            className={styles.window}
            onClick={() => canMinimizeWindow() && minimizeWindow()}
          />
          <GlyphButton
            icon={maximized ? "window-restore" : "window-maximize"}
            label={t(maximized ? "ui.window.restore" : "ui.window.maximize")}
            className={styles.window}
            onClick={toggleMaximizeWindow}
          />
          <GlyphButton icon="window-close" label={t("ui.window.close")} className={`${styles.window} ${styles.quit}`} onClick={closeWindow} />
        </div>
      </header>

      <section className={styles.left}>
        <Cover src={track?.coverUrl ?? ""} size={340} radius={12} />
        <h1 className={styles.title}>{track?.title ?? ""}</h1>
        <p className={styles.artist}>{track?.artists ?? ""}</p>
        {track ? (
          <GlyphButton
            icon={liked ? "check" : "add"}
            label={t(liked ? "ui.karaoke.unlike" : "ui.karaoke.like")}
            className={styles.like}
            onClick={() => (liked ? unlike.mutate(track.id) : like.mutate(track))}
          />
        ) : null}
        {track ? (
          <GlyphButton
            icon="dislike"
            size={18}
            label={t("ui.recs.dislike")}
            className={`${styles.like} ${styles.dislike}`}
            onClick={() => songMenuNotInterested?.(track, "exact")}
          />
        ) : null}
        <Timeline fallbackMs={track?.durationMs ?? 0} />
        <div className={styles.transport}>
          <GlyphButton
            icon="shuffle"
            size={24}
            label={t(player.shuffle ? "ui.karaoke.shuffle_on" : "ui.karaoke.shuffle_off")}
            className={`${styles.side} ${styles.mode}`}
            on={player.shuffle}
            onClick={() => playerEngine.setShuffle(!player.shuffle)}
          />
          <GlyphButton icon="previous" label={t("ui.karaoke.previous")} className={styles.side} onClick={() => void playerEngine.skipPrevious()} />
          <button
            type="button"
            className={styles.play}
            aria-label={t(playing ? "ui.karaoke.pause" : "ui.karaoke.play")}
            onClick={() => void playerEngine.togglePlayPause()}
          >
            <MorphPlayIcon playing={playing} size={44} />
          </button>
          <GlyphButton icon="next" label={t("ui.karaoke.next")} className={styles.side} onClick={() => void playerEngine.skipNext()} />
          <GlyphButton
            icon={player.repeat === "one" ? "repeat-one" : "repeat"}
            size={24}
            label={t(`ui.karaoke.repeat_${player.repeat}`)}
            className={`${styles.side} ${styles.mode}`}
            on={player.repeat !== "off"}
            onClick={() => playerEngine.setRepeat(nextRepeatMode(player.repeat, isRadioContext(player.playbackContext)))}
          />
        </div>
        <div className={styles.volume}>
          <button
            type="button"
            aria-label={t(level > 0 ? "ui.karaoke.mute" : "ui.karaoke.unmute")}
            className={styles.mute}
            data-no-window-drag
            onClick={() => {
              if (level === 0) return setLevel(restoreLevel.current);
              restoreLevel.current = level;
              playerEngine.setVolume(toVolumeGain(0));
            }}
          >
            {level > 0 ? <SpeakerGlyph /> : <Icon name="volume-mute" size={20} />}
          </button>
          <Bar
            label={t("ui.karaoke.volume")}
            className={styles.level}
            value={level}
            valueNow={Math.round(level * 100)}
            valueMax={100}
            valueText={`${Math.round(level * 100)}%`}
            onChange={(fraction) => setLevel(fraction)}
            onStep={(direction) => setLevel(level + direction * VOLUME_STEP)}
          />
        </div>
      </section>

      <LyricsColumn track={track} mode={mode} />
    </div>
  );
}
