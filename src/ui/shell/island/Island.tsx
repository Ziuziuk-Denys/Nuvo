import { useEffect, useRef, useState, type JSX, type MouseEvent, type WheelEvent } from "react";
import { Button } from "../../components/Button";
import { Cover } from "../../components/Cover";
import { IconButton } from "../../components/IconButton";
import { Menu } from "../../components/Menu";
import { LAYER_ATTRIBUTE } from "../../components/layers";
import { Popover } from "../../components/Popover";
import { Tooltip } from "../../components/Tooltip";
import { ISLAND, POPOVER } from "../../geometry";
import { useCachedTrackIds } from "../../ports/catalog";
import { coverAccent } from "../../ports/color";
import { useTranslation } from "../../ports/i18n";
import { MorphPlayIcon } from "../../ports/karaoke";
import { useIsTrackLiked, useLikeTrack, useUnlikeTrack } from "../../ports/library";
import { useStreamingReachable } from "../../ports/network";
import {
  currentFallback,
  keepVersion,
  rejectVersion,
  currentStreamFormat,
  isRadioContext,
  nextRepeatMode,
  playerEngine,
  playerOutputs,
  toVolumeLevel,
  usePlayerState,
  usePlayerStore,
} from "../../ports/player";
import { recsEnabled, useCurrentPick } from "../../ports/recs";
import { useAbLoopStore, useSleepTimer } from "../../ports/sound";
import { useDownloadProgress } from "../../ports/exports";
import { DislikeButton } from "../../recs/DislikeButton";
import { NotInterestedMenu } from "../../recs/NotInterestedMenu";
import { useNotInterestedStore } from "../../recs/notInterested";
import { reasonText } from "../../recs/reasonText";
import { noticeText, UndoNotice } from "../../recs/UndoNotice";
import { useLook } from "../../ports/theme";
import { useTourDemo } from "../../tour/demo";
import { AddToPlaylistPopover } from "../popovers/AddToPlaylistPopover";
import { SOUND_TABS, SoundPopover, SoundTrailing, type SoundTab } from "../popovers/SoundPopover";
import { VolumePopover, wheelVolume } from "../popovers/VolumePopover";
import { usePageLit } from "../pageLit";
import { useShellStore } from "../shellStore";
import { QUEUE_ID } from "../queue/QueuePanel";
import styles from "./Island.module.css";
import { Scrubber } from "./Scrubber";
import { stateLine, type StateLine } from "./stateLine";
import { VolumeLadder } from "./VolumeLadder";

type Panel = "add" | "sound" | "volume";

const CODEC_NAMES: Record<string, string> = { opus: "Opus", aac: "AAC", mp3: "MP3" };

export function coverWash(accent: string, light: boolean): string {
  return `color-mix(in srgb, ${accent} ${light ? 9 : 18}%, transparent)`;
}

function useCoverTint(url: string | undefined, light: boolean): string {
  const fallback = light ? "rgba(0, 0, 0, 0.06)" : "rgba(255, 255, 255, 0.12)";
  const [tint, setTint] = useState<{ key: string; value: string } | null>(null);
  const key = `${url ?? ""}|${light}`;

  useEffect(() => {
    if (!url) return;
    let live = true;
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = 64;
        canvas.height = 64;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context || !live) return;
        context.drawImage(image, 0, 0, 64, 64);
        setTint({ key, value: coverWash(coverAccent(context.getImageData(0, 0, 64, 64).data, light), light) });
      } catch {
        // a tainted canvas keeps the grey wash
      }
    };
    image.src = url;
    return () => {
      live = false;
    };
  }, [url, light, key]);

  return tint?.key === key ? tint.value : fallback;
}

export function Island(): JSX.Element | null {
  const { t } = useTranslation();
  const player = usePlayerState();
  const setFullscreen = usePlayerStore((state) => state.setFullscreen);
  const queueOpen = useShellStore((state) => state.queueOpen);
  const toggleQueue = useShellStore((state) => state.toggleQueue);
  const demo = useTourDemo();
  const track = player.currentTrack ?? demo;
  const liked = useIsTrackLiked(track?.id);
  const likeTrack = useLikeTrack();
  const unlikeTrack = useUnlikeTrack();
  const liking = useRef(false);
  const [pop, setPop] = useState(false);
  const reachable = useStreamingReachable();
  const sleep = useSleepTimer();
  const loopA = useAbLoopStore((state) => state.a);
  const loopB = useAbLoopStore((state) => state.b);
  const saving = useDownloadProgress();
  const look = useLook();
  const lit = usePageLit();
  const tint = useCoverTint(track?.coverUrl || undefined, look.mode === "light");
  // shortcut: probed once per track, so a stream that finishes caching mid-play says so from the next play
  const cachedIds = useCachedTrackIds(player.currentTrack ? [player.currentTrack.id] : [], Boolean(player.currentTrack));

  const [panel, setPanel] = useState<Panel>("volume");
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const shared = useRef<"sound" | "add">("sound");
  if (panel !== "volume") shared.current = panel;
  const [soundTab, setSoundTab] = useState<SoundTab>("eq");

  const pick = useCurrentPick();
  const notice = useNotInterestedStore((state) => state.notice);
  const [dislikeMenu, setDislikeMenu] = useState({ open: false, at: { x: 0, y: 0 } });
  const hasTrack = Boolean(track);

  useEffect(() => {
    if (!hasTrack) useNotInterestedStore.getState().setNotice(null);
  }, [hasTrack]);

  if (!track) return null;

  const playing = player.status === "playing" || player.status === "loading";
  const durationMs = player.durationMs > 0 ? player.durationMs : (track.durationMs ?? 0);
  const volumeLevel = toVolumeLevel(player.volume ?? 1);

  const toggle = (next: Panel) => (event: MouseEvent<HTMLButtonElement>) => {
    if (open && panel === next) {
      setOpen(false);
      return;
    }
    setAnchor(event.currentTarget);
    setPanel(next);
    setOpen(true);
  };

  const toggleLike = () => {
    if (liking.current) return;
    liking.current = true;
    const onSettled = () => {
      liking.current = false;
    };
    if (liked) unlikeTrack.mutate(track.id, { onSettled });
    else likeTrack.mutate(track, { onSettled });
    setPop(!liked);
  };

  const openPlayer = () => {
    setOpen(false);
    setFullscreen(true);
  };

  // a popover trigger says expanded, not pressed; the open one is lit like a pressed toggle
  const expanded = (name: Panel) => {
    const on = open && panel === name;
    return { "aria-haspopup": "dialog" as const, "aria-expanded": on, tooltip: !on, className: on ? styles.on : undefined };
  };

  const standIn = currentFallback();
  const line = stateLine({
    offline: !reachable,
    sleepRemainingMs: sleep.remainingMs,
    playbackContext: player.playbackContext,
    queueTitles: player.queue.map((item) => item.title),
    currentIndex: player.currentIndex,
    autoplayFrom: player.autoplayFrom,
    reason: standIn
      ? t(standIn.restarted ? "ui.island.state.restarted" : "ui.island.state.played_from", { source: standIn.source })
      : reasonText(pick.reason, t),
    notice: player.outputSilent
      ? t(player.outputSilent === "system_muted" ? "ui.island.state.system_muted" : "ui.island.state.output_stopped")
      : notice
        ? noticeText(notice, t)
        : (saving?.error ?? null),
    downloads: saving && saving.total > 0 ? saving : null,
  });
  const lineText = (value: StateLine) => {
    if (value.kind === "offline") return t("ui.island.state.offline");
    if (value.kind === "sleep") return t("ui.island.state.sleep", { clock: value.clock });
    if (value.kind === "downloads") return t("ui.island.state.downloads", { done: value.done, total: value.total });
    if (value.kind === "reason" || value.kind === "notice") return value.text;
    if (value.kind === "radio-seed") return t("ui.island.state.radio_seed", { seed: value.seed });
    return t("ui.island.state.radio_queue");
  };
  const format = currentStreamFormat();
  const hint = standIn
    ? `${standIn.hover} ${t("ui.island.stand_in_hint")}`
    : cachedIds?.has(track.id)
      ? t("ui.island.cached")
      : format && format.bitrate > 0
        ? t("ui.island.bitrate", { codec: CODEC_NAMES[format.codec] ?? format.codec, bitrate: Math.round(format.bitrate / 1000) })
        : "";
  const repeatLabel = t(`player.repeat_${player.repeat}`);

  const onVolumeWheel = (event: WheelEvent<HTMLElement>) => wheelVolume(player.volume ?? 1, event.deltaY);

  const titles: Record<Panel, string> = { add: t("ui.add.title"), sound: t("ui.sound.title"), volume: t("ui.volume.title") };
  const width = shared.current === "sound" ? (SOUND_TABS.find((entry) => entry.id === soundTab)?.width ?? POPOVER.sound) : POPOVER.narrow;

  return (
    <div
      className={styles.bar}
      data-island=""
      data-lit={lit ? "" : undefined}
      data-notice={notice || player.outputSilent ? "" : undefined}
      {...{ [LAYER_ATTRIBUTE]: "" }}
    >
      <div className={styles.now}>
        <button
          type="button"
          className={styles.open}
          aria-label={t("ui.island.open_lyrics")}
          onClick={openPlayer}
          onContextMenu={
            standIn || (recsEnabled && pick.track)
              ? (event: MouseEvent<HTMLButtonElement>) => {
                  event.preventDefault();
                  setOpen(false);
                  setDislikeMenu({ open: true, at: { x: event.clientX, y: event.clientY } });
                }
              : undefined
          }
        >
          <Cover src={track.coverUrl ?? ""} size={ISLAND.cover} radius={ISLAND.coverRadius} />
          <span className={styles.text}>
            <span className={styles.title} data-island-title="">
              {track.title}
            </span>
            <Tooltip text={hint}>
              {line ? (
                <span className={styles.artist} data-state-line="">
                  {lineText(line)}
                </span>
              ) : (
                <span className={styles.artist}>{track.artists}</span>
              )}
            </Tooltip>
          </span>
        </button>
        <span className={styles.rate}>
          <IconButton
            icon={liked ? "liked" : "like"}
            label={liked ? t("ui.island.unlike") : t("ui.island.like")}
            className={`${styles.like} ${styles.heart}`}
            data-like=""
            data-liked={liked ? "" : undefined}
            data-pop={pop ? "" : undefined}
            data-tour="like"
            onClick={toggleLike}
            onAnimationEnd={() => setPop(false)}
          />
          <DislikeButton track={track} className={styles.like} />
        </span>
        <span className={styles.live} aria-live="polite">
          {line?.kind === "notice" ? line.text : ""}
        </span>
        <UndoNotice />
        {player.outputSilent === "system_muted" ? (
          <Button variant="text" size="s" className={styles.unmute} onClick={() => void playerOutputs.unmute()}>
            {t("ui.island.unmute")}
          </Button>
        ) : null}
      </div>

      <div className={styles.centre}>
        <div className={styles.transport}>
          <IconButton className={styles.skip} icon="previous" label={t("ui.island.previous")} onClick={() => void playerEngine.skipPrevious()} />
          <Tooltip text={playing ? t("ui.island.pause") : t("ui.island.play")}>
            <button
              type="button"
              className={styles.play}
              aria-label={playing ? t("ui.island.pause") : t("ui.island.play")}
              aria-busy={player.status === "loading" || undefined}
              onClick={() => void playerEngine.togglePlayPause()}
            >
              <span className={styles.glyph} data-play={playing ? undefined : ""}>
                <MorphPlayIcon playing={playing} size={ISLAND.playGlyph} />
              </span>
            </button>
          </Tooltip>
          <IconButton className={styles.skip} icon="next" label={t("ui.island.next")} onClick={() => void playerEngine.skipNext()} />
        </div>
      </div>

      <div className={styles.actions}>
        <div className={styles.well}>
          <IconButton
            icon="shuffle"
            label={player.shuffle ? t("player.shuffle_on") : t("player.shuffle_off")}
            className={player.shuffle ? styles.on : undefined}
            onClick={() => playerEngine.setShuffle(!player.shuffle)}
          />
          <IconButton
            icon={player.repeat === "one" ? "repeat-one" : "repeat"}
            label={repeatLabel}
            className={player.repeat !== "off" ? styles.on : undefined}
            onClick={() => playerEngine.setRepeat(nextRepeatMode(player.repeat, isRadioContext(player.playbackContext)))}
          />
          <IconButton icon="equalizer" label={t("ui.island.sound")} {...expanded("sound")} data-tour="sound" onClick={toggle("sound")} />
          <IconButton icon="playlist-add" label={t("ui.island.add")} {...expanded("add")} data-tour="add" onClick={toggle("add")} />
          <VolumeLadder level={volumeLevel} label={t("ui.island.volume")} {...expanded("volume")} onClick={toggle("volume")} onWheel={onVolumeWheel} />
          <IconButton icon="now-playing" label={t("player.open_player")} onClick={openPlayer} />
          <span className={styles.divider} aria-hidden="true" />
          <IconButton
            icon="queue"
            label={t("ui.island.queue")}
            aria-controls={QUEUE_ID}
            active={queueOpen}
            className={queueOpen ? styles.on : undefined}
            data-tour="queue"
            onClick={() => {
              setOpen(false);
              toggleQueue();
            }}
          />
        </div>
      </div>

      {standIn ? (
        <Menu
          open={dislikeMenu.open}
          anchor={null}
          at={dislikeMenu.at}
          onClose={() => setDislikeMenu((menu) => ({ ...menu, open: false }))}
          items={[
            { label: t("ui.island.keep_version"), onSelect: () => void keepVersion() },
            { label: t("ui.island.reject_version"), onSelect: () => void rejectVersion(track.id) },
          ]}
        />
      ) : pick.track ? (
        <NotInterestedMenu
          track={pick.track}
          open={dislikeMenu.open}
          at={dislikeMenu.at}
          onClose={() => setDislikeMenu((menu) => ({ ...menu, open: false }))}
        />
      ) : null}

      <Scrubber positionMs={player.positionMs} durationMs={durationMs} tint={tint} loop={{ a: loopA, b: loopB }} />

      <VolumePopover open={open && panel === "volume"} anchor={anchor} onClose={() => setOpen(false)} onWheel={onVolumeWheel} />
      <Popover
        open={open && panel !== "volume"}
        anchor={anchor}
        onClose={() => setOpen(false)}
        title={titles[shared.current]}
        width={width}
        trailing={shared.current === "sound" ? <SoundTrailing tab={soundTab} /> : undefined}
      >
        {shared.current === "sound" ? (
          <SoundPopover tab={soundTab} onTab={setSoundTab} />
        ) : (
          <AddToPlaylistPopover track={track} onDone={() => setOpen(false)} />
        )}
      </Popover>
    </div>
  );
}
