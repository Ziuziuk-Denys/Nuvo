import { memo, useEffect, useId, useLayoutEffect, useRef, useState, type JSX, type KeyboardEvent, type PointerEvent } from "react";
import { Button } from "../../components/Button";
import { IconButton } from "../../components/IconButton";
import { Menu } from "../../components/Menu";
import { ModalPanel } from "../../components/ModalPanel";
import { useTranslation } from "../../ports/i18n";
import {
  endLine,
  firstOpen,
  formatDuration,
  formatStamp,
  isComplete,
  nudge,
  playbackPositionMs,
  saveTimedFile,
  seekPlayback,
  setPlaybackSpeed,
  soundingAt,
  tap,
  timedCount,
  togglePlayback,
  toLrc,
  toTtml,
  untap,
  useIsCurrentTrack,
  useIsPlaying,
  usePlaybackSpeed,
  type LyricsTrack,
  type SyncCursor,
  type SyncLine,
  type SyncUnit,
} from "../../ports/lyricsTools";
import { Segmented } from "../settings/controls";
import styles from "./TimingStage.module.css";

type Mode = "tap" | "check";

const LEAD_IN_MS = 1500;
const HOLD_MS = 450;
const STEP = { line: [100, 1000], word: [20, 100] } as const;
const SPEEDS = [1, 0.75, 0.5];

interface TimingStageProps {
  track: LyricsTrack;
  start: SyncLine[];
  open: boolean;
  onBack(lines: SyncLine[]): void;
  onSave(lrc: string): Promise<void>;
}

export function TimingStage({ track, start, open, onBack, onSave }: TimingStageProps): JSX.Element {
  const { t } = useTranslation();
  const titleId = useId();
  const playing = useIsPlaying();
  const here = useIsCurrentTrack(track.id);
  const speed = usePlaybackSpeed();
  const [lines, setLines] = useState(start);
  const [unit, setUnit] = useState<SyncUnit>("word");
  const [mode, setMode] = useState<Mode>("tap");
  const [cursor, setCursor] = useState<SyncCursor>(() => firstOpen(start, "word"));
  const [sounding, setSounding] = useState<SyncCursor | null>(null);
  const [pressed, setPressed] = useState(false);
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const pressedAt = useRef<number | null>(null);
  const list = useRef<HTMLOListElement>(null);
  const clockText = useRef<HTMLSpanElement>(null);
  const played = useRef<HTMLSpanElement>(null);
  const speedBefore = useRef(speed);

  useEffect(() => {
    if (!open) return;
    const before = speedBefore.current;
    list.current?.focus();
    const from = lines[cursor.line]?.atMs ?? lines[cursor.line - 1]?.atMs;
    seekPlayback(from === null || from === undefined ? 0 : from - LEAD_IN_MS);
    return () => setPlaybackSpeed(before);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
    let frame = requestAnimationFrame(function tick() {
      const ms = playbackPositionMs();
      if (clockText.current) clockText.current.textContent = formatDuration(ms);
      if (played.current) played.current.style.transform = `scaleX(${track.durationMs > 0 ? Math.min(1, ms / track.durationMs) : 0})`;
      const now = soundingAt(lines, ms);
      setSounding((last) => (last?.line === now?.line && last?.word === now?.word ? last : now));
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [open, lines, track.durationMs]);

  const focusLine = mode === "check" ? (sounding?.line ?? Math.min(cursor.line, lines.length - 1)) : Math.min(cursor.line, lines.length - 1);

  useLayoutEffect(() => {
    const row = list.current?.children[focusLine] as HTMLElement | undefined;
    const box = list.current;
    if (!row || !box) return;
    box.style.setProperty("--lead", `${Math.max(0, box.clientHeight / 2 - row.offsetHeight / 2)}px`);
    box.scrollTop = row.offsetTop - box.clientHeight / 2 + row.offsetHeight / 2;
  }, [focusLine]);

  const press = () => {
    if (mode === "check" || !here || pressedAt.current !== null) return;
    setPressed(true);
    if (!playing) {
      togglePlayback();
      return;
    }
    const ms = playbackPositionMs();
    pressedAt.current = ms;
    const step = tap(lines, cursor, ms, unit);
    setLines(step.lines);
    setCursor(step.cursor);
  };

  const release = () => {
    setPressed(false);
    const from = pressedAt.current;
    pressedAt.current = null;
    if (from === null) return;
    const ms = playbackPositionMs();
    const lineDone = cursor.word === 0;
    if (lineDone && ms - from >= HOLD_MS) setLines(endLine(lines, cursor, ms));
  };

  const replay = () => {
    const at = lines[focusLine]?.atMs ?? lines.slice(0, focusLine).reduce((last, line) => line.atMs ?? last, 0);
    seekPlayback(at - LEAD_IN_MS);
    if (!playing) togglePlayback();
  };

  const select = (next: SyncCursor) => {
    setCursor(next);
    const line = lines[next.line];
    const at = line?.words[next.word]?.atMs ?? line?.atMs;
    if (at !== null && at !== undefined) seekPlayback(at - LEAD_IN_MS);
    list.current?.focus();
  };

  // in tap mode the cursor waits on the next word, so a nudge means the one just tapped
  const target = (): SyncCursor => {
    if (mode === "check") return cursor;
    const at = lines[cursor.line]?.words[cursor.word]?.atMs ?? null;
    if (at !== null) return cursor;
    if (cursor.word > 0) return { line: cursor.line, word: cursor.word - 1 };
    const line = Math.max(0, cursor.line - 1);
    return { line, word: Math.max(0, (lines[line]?.words.length ?? 1) - 1) };
  };

  const step = (by: -1 | 1) => setCursor({ line: Math.max(0, Math.min(lines.length - 1, cursor.line + by)), word: 0 });

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const [small, large] = STEP[unit];
    const by = event.shiftKey ? large : small;
    const onControl = event.target !== list.current && (event.target as Element).closest("button");
    const keys: Record<string, () => void> = {
      ...(onControl ? {} : { Space: () => !event.repeat && press(), Enter: () => setLines(endLine(lines, cursor, playbackPositionMs())) }),
      ArrowUp: () => step(-1),
      ArrowDown: () => step(1),
      ArrowLeft: () => setLines(nudge(lines, target(), -by, unit)),
      ArrowRight: () => setLines(nudge(lines, target(), by, unit)),
      Backspace: () => {
        const undone = untap(lines, cursor, unit);
        setLines(undone.lines);
        setCursor(undone.cursor);
      },
      KeyR: replay,
      KeyP: togglePlayback,
    };
    const run = keys[event.code];
    if (!run) return;
    // Space must stamp, not reach the player's play/pause shortcut
    event.preventDefault();
    event.stopPropagation();
    run();
  };

  const changeUnit = (next: SyncUnit) => {
    setUnit(next);
    setCursor(firstOpen(lines, next));
  };

  const save = async () => {
    setFailed(false);
    setSaving(true);
    try {
      await onSave(toLrc(lines));
    } catch {
      setFailed(true);
    }
    setSaving(false);
  };

  const seekTo = (event: PointerEvent<HTMLElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    seekPlayback(((event.clientX - box.left) / Math.max(1, box.width)) * track.durationMs);
  };

  const count = timedCount(lines, unit);
  const finished = cursor.line >= lines.length;
  const padText = !here
    ? t("ui.lyrics.timing_other_song")
    : finished
      ? t("ui.lyrics.timing_done")
      : !playing
        ? t("ui.lyrics.timing_start")
        : t(unit === "word" ? "ui.lyrics.timing_every_word" : "ui.lyrics.timing_every_line");

  return (
    <ModalPanel open={open} onClose={() => onBack(lines)} labelledBy={titleId} classes={styles}>
      <div
        className={styles.stage}
        onKeyDown={onKeyDown}
        onKeyUp={(event) => {
          if (event.code === "Space" && event.target === list.current) release();
        }}
      >
        <header className={styles.head}>
          <div className={styles.names}>
            <h2 id={titleId}>{track.title}</h2>
            <p>{track.artists}</p>
          </div>
          <Segmented
            label={t("ui.lyrics.timing_unit")}
            value={unit}
            onChange={changeUnit}
            options={[
              { value: "word", label: t("ui.lyrics.timing_words") },
              { value: "line", label: t("ui.lyrics.timing_lines") },
            ]}
          />
          <Segmented
            label={t("ui.lyrics.timing_mode")}
            value={mode}
            onChange={setMode}
            options={[
              { value: "tap", label: t("ui.lyrics.timing_tap") },
              { value: "check", label: t("ui.lyrics.timing_check") },
            ]}
          />
        </header>

        <ol ref={list} tabIndex={0} className={`${styles.lines} n-scroll`} data-mode={mode} data-unit={unit} aria-label={t("ui.lyrics.sync_list")}>
          {lines.map((line, at) => (
            <Row
              key={at}
              line={line}
              at={at}
              current={at === focusLine}
              near={Math.abs(at - focusLine) === 1}
              word={mode === "tap" && at === cursor.line ? cursor.word : -1}
              picked={mode === "check" && at === cursor.line ? cursor.word : -1}
              sung={sounding?.line === at ? sounding.word : -1}
              tapping={mode === "tap"}
              wordly={unit === "word"}
              onSelect={select}
            />
          ))}
        </ol>

        <div className={styles.transport}>
          <IconButton icon={playing ? "pause" : "play"} label={t(playing ? "ui.island.pause" : "ui.island.play")} onClick={togglePlayback} />
          <IconButton icon="replay" label={t("ui.lyrics.timing_replay")} onClick={replay} />
          <span ref={clockText} className={styles.clock}>
            0:00
          </span>
          <div className={styles.track} onPointerDown={seekTo} role="presentation">
            <span className={styles.rail}>
              <span ref={played} className={styles.played} />
              {lines.map((line, at) =>
                line.atMs !== null && track.durationMs > 0 ? <i key={at} style={{ left: `${Math.min(100, (line.atMs / track.durationMs) * 100)}%` }} /> : null,
              )}
            </span>
          </div>
          <span className={styles.clock}>{formatDuration(track.durationMs)}</span>
          <Segmented
            label={t("ui.lyrics.timing_speed")}
            value={String(speed)}
            onChange={(next) => setPlaybackSpeed(Number(next))}
            options={SPEEDS.map((value) => ({ value: String(value), label: `${value}×` }))}
          />
        </div>

        {mode === "tap" ? (
          <button
            type="button"
            tabIndex={-1}
            className={styles.pad}
            data-pressed={pressed || undefined}
            disabled={finished || !here}
            onPointerDown={(event) => {
              event.preventDefault();
              press();
            }}
            onPointerUp={release}
            onPointerLeave={release}
          >
            {padText}
          </button>
        ) : null}

        <footer className={styles.foot}>
          <p className={styles.note} role={failed ? "alert" : undefined}>
            {failed ? t("ui.lyrics.save_failed") : mode === "tap" ? t("ui.lyrics.timing_keys") : t("ui.lyrics.timing_check_keys")}
          </p>
          <span className={styles.count}>{t("ui.lyrics.timing_progress", { done: count.done, total: count.total })}</span>
          <Button variant="secondary" onClick={() => onBack(lines)}>
            {t("ui.lyrics.back")}
          </Button>
          <Button variant="secondary" disabled={!isComplete(lines)} aria-haspopup="menu" onClick={(event) => setMenu(event.currentTarget)}>
            {t("ui.lyrics.timing_export")}
          </Button>
          <Button variant="primary" disabled={!isComplete(lines) || saving} onClick={() => void save()}>
            {t("ui.lyrics.save_synced")}
          </Button>
        </footer>
        <Menu
          open={menu !== null}
          anchor={menu}
          onClose={() => setMenu(null)}
          items={[
            { label: t("ui.lyrics.timing_export_lrc"), onSelect: () => void saveTimedFile(track, "lrc", toLrc(lines)) },
            { label: t("ui.lyrics.timing_export_ttml"), onSelect: () => void saveTimedFile(track, "ttml", toTtml(lines, track.durationMs)) },
          ]}
        />
      </div>
    </ModalPanel>
  );
}

interface RowProps {
  line: SyncLine;
  at: number;
  current: boolean;
  near: boolean;
  word: number;
  picked: number;
  sung: number;
  tapping: boolean;
  wordly: boolean;
  onSelect(cursor: SyncCursor): void;
}

const Row = memo(
  function Row({ line, at, current, near, word, picked, sung, tapping, wordly, onSelect }: RowProps): JSX.Element {
    return (
      <li className={styles.row} data-current={current || undefined} data-near={near || undefined} aria-current={current ? "true" : undefined}>
        <span className={styles.stamp}>{line.atMs === null ? "" : formatStamp(line.atMs).slice(1, -1)}</span>
        <p>
          {wordly ? (
            line.words.map((item, index) => (
              <button
                key={index}
                type="button"
                tabIndex={-1}
                className={styles.word}
                data-text={item.text.trimEnd()}
                data-timed={item.atMs !== null || undefined}
                data-next={index === word || undefined}
                data-picked={index === picked || undefined}
                data-sung={(!tapping && index === sung) || undefined}
                onClick={() => onSelect({ line: at, word: index })}
              >
                {item.text.trimEnd()}
              </button>
            ))
          ) : (
            <button
              type="button"
              tabIndex={-1}
              className={styles.word}
              data-text={line.text}
              data-timed={line.atMs !== null || undefined}
              data-next={word >= 0 || undefined}
              data-picked={picked >= 0 || undefined}
              data-sung={(!tapping && sung >= 0) || undefined}
              onClick={() => onSelect({ line: at, word: 0 })}
            >
              {line.text}
            </button>
          )}
        </p>
      </li>
    );
  },
  (a, b) =>
    a.line === b.line &&
    a.current === b.current &&
    a.near === b.near &&
    a.word === b.word &&
    a.picked === b.picked &&
    a.sung === b.sung &&
    a.tapping === b.tapping &&
    a.wordly === b.wordly,
);
