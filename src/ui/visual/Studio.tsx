import { useEffect, useMemo, useRef, useState, type JSX } from "react";
import { pushLayer } from "../components/layers";
import { Menu } from "../components/Menu";
import { Icon } from "../icons/Icon";
import { MEDIA_REFUSALS } from "../mediaFiles";
import { useTranslation } from "../ports/i18n";
import { lyricsCommands, useLyrics } from "../ports/lyrics";
import { usePlayerStore } from "../ports/player";
import { importSceneMedia, partsFor, sceneOf, SCENES, type Aspect, type Part, type Selection } from "../ports/visual";
import { chooseScene, setVisualSettings, useVisualSettings, visualSettings } from "./settings";
import { setStudioOpen } from "./studioOpen";
import { Assets } from "./studio/Assets";
import { ExportClip } from "./studio/ExportClip";
import { Glow } from "./studio/Glow";
import { Inspector } from "./studio/Inspector";
import { Player } from "./studio/Player";
import { Rail } from "./studio/Rail";
import theme from "./studio/theme.module.css";
import { Timeline } from "./studio/Timeline";
import { TopBar } from "./studio/TopBar";
import type { Category } from "./studio/types";
import { useHistory } from "./studio/useHistory";
import { applyPick } from "./studio/pick";
import { useHoldTrack } from "./studio/useHoldTrack";
import { useStudioKeys } from "./studio/useStudioKeys";
import { MAX_CLIP_MS, MIN_CLIP_MS } from "./studio/Timeline";
import styles from "./Studio.module.css";

const START: Selection = SCENES[0].selection;
const MAX_EFFECTS = 3;
const NOTICE_MS = 3_200;
const CLIP_MS = 15_000;
const LEAD_MS = 2_000;
const ALL_PARTS = [...partsFor("background"), ...partsFor("atmosphere"), ...partsFor("centrepiece"), ...partsFor("lyrics")];

function clipAround(positionMs: number): [number, number] {
  const from = Math.max(0, positionMs - LEAD_MS);
  return [from, from + CLIP_MS];
}

// the studio is a layer, so Escape closes a popover inside it first and the studio only after that
function useFullscreenLayer(): void {
  useEffect(() => {
    void document.documentElement.requestFullscreen?.().catch(() => undefined);
    const popLayer = pushLayer(() => setStudioOpen(false));
    return () => {
      popLayer();
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    };
  }, []);
}

function UseAsPlayer({ selection, mode }: { selection: Selection; mode: "own" | "random" }): JSX.Element {
  const { t } = useTranslation();
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const choose = (next: "own" | "random") => setVisualSettings(next === "own" ? { template: next, scene: selection } : { template: next });
  return (
    <span className={styles.split}>
      <button
        type="button"
        className={theme.primary}
        data-tour="studio-use"
        onClick={() => {
          setVisualSettings({ enabled: true, stage: true, scene: selection, template: "own" });
          setStudioOpen(false);
        }}
      >
        {t("visual.studio.use")}
      </button>
      <button
        ref={setAnchor}
        type="button"
        className={theme.primary}
        aria-label={t("visual.studio.use_options")}
        aria-haspopup="menu"
        onClick={() => setOpen(true)}
      >
        <Icon name="chevron-down" size={16} />
      </button>
      <Menu
        open={open}
        anchor={anchor}
        onClose={() => setOpen(false)}
        className={theme.dark}
        items={[
          { label: t("visual.editor.own"), icon: mode === "own" ? "check" : undefined, onSelect: () => choose("own") },
          { label: t("visual.editor.random"), icon: mode === "random" ? "check" : undefined, onSelect: () => choose("random") },
        ]}
      />
    </span>
  );
}

export function Studio({ phase }: { phase: "in" | "out" }): JSX.Element {
  const { t } = useTranslation();
  const visual = useVisualSettings();
  const media = visual.media;
  const track = usePlayerStore((state) => state.currentTrack);
  const positionMs = usePlayerStore((state) => state.positionMs);
  const durationMs = usePlayerStore((state) => state.durationMs);
  const lines = useLyrics((state) => state.lines);
  const [category, setCategory] = useState<Category>("scenes");
  const [aspect, setAspect] = useState<Aspect>("tall");
  const [mirror, setMirror] = useState<HTMLCanvasElement | null>(null);
  const [foot, setFoot] = useState<[number, number, number] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimer = useRef<number | undefined>(undefined);
  const showNotice = (text: string) => {
    window.clearTimeout(noticeTimer.current);
    setNotice(text);
    noticeTimer.current = window.setTimeout(() => setNotice(null), NOTICE_MS);
  };
  useEffect(() => () => window.clearTimeout(noticeTimer.current), []);
  const [range, setRange] = useState<[number, number]>(() => clipAround(positionMs));
  // a song picked by hand gets its own clip range; the old one would point into a different song
  const [rangeTrack, setRangeTrack] = useState(track?.id);
  if (track?.id !== rangeTrack) {
    setRangeTrack(track?.id);
    setRange(clipAround(positionMs));
  }
  const selection = visual.scene ?? START;
  const mode = visual.template === "random" ? "random" : "own";
  const scene = useMemo(() => sceneOf(selection), [selection]);
  const history = useHistory(selection, chooseScene);
  const coverUrl = track?.coverUrl ?? "";

  useFullscreenLayer();
  useHoldTrack();
  const markIn = () => {
    const at = Math.round(lyricsCommands.clock().atMs);
    setRange(([, end]) => [at, Math.min(at + MAX_CLIP_MS, Math.max(at + MIN_CLIP_MS, end))]);
  };
  const markOut = () => {
    const at = Math.round(lyricsCommands.clock().atMs);
    setRange(([start]) => [start, Math.max(start + MIN_CLIP_MS, Math.min(start + MAX_CLIP_MS, at))]);
  };
  useStudioKeys({ undo: history.undo, redo: history.redo, markIn, markOut });

  const save = (next: Selection) => {
    if (JSON.stringify(next) !== JSON.stringify(selection)) history.commit(next);
  };
  const isChosen = (part: Part) => (part.slot === "atmosphere" ? scene.selection.atmosphere.includes(part.id) : scene.selection[part.slot] === part.id);
  const pickPart = (part: Part) => {
    const result = applyPick(scene.selection, part, MAX_EFFECTS);
    if (result.selection) save(result.selection);
    if (result.notice) {
      const values = Object.fromEntries(
        Object.entries(result.notice.values ?? {}).map(([name, id]) => [name, name === "max" ? id : t(`visual.part.${id}.title`)]),
      );
      showNotice(t(result.notice.key, values));
    }
  };
  const importMedia = (file: File) => {
    void importSceneMedia(file).then((result) => {
      if ("error" in result) return showNotice(t(MEDIA_REFUSALS[result.error]));
      setVisualSettings({ media: result.media });
      const chosen = visualSettings().scene ?? START;
      if (!["ascii", "media"].includes(sceneOf(chosen).selection.background)) history.commit({ ...chosen, background: "media" });
    });
  };
  const inspected = [scene.selection.background, ...scene.selection.atmosphere, scene.selection.centrepiece, scene.selection.lyrics]
    .map((id) => ALL_PARTS.find((part) => part.id === id))
    .filter((part): part is Part => Boolean(part));

  return (
    <div className={`${theme.dark} ${styles.studio}`} data-state={phase} role="dialog" aria-modal="true" aria-label={t("visual.studio.title")}>
      <Glow foot={foot} onMirror={setMirror} />
      <TopBar
        category={category}
        effects={{ used: scene.selection.atmosphere.length, max: MAX_EFFECTS }}
        track={track}
        aspect={aspect}
        onAspect={setAspect}
        onBack={() => setStudioOpen(false)}
        actions={
          <>
            {track ? (
              <ExportClip
                songMs={durationMs}
                artists={track.artists}
                request={{
                  trackId: track.id,
                  name: track.title,
                  template: scene.template,
                  aspect,
                  fromMs: range[0],
                  lenMs: range[1] - range[0],
                  lines,
                  coverUrl,
                  media,
                }}
              />
            ) : null}
            <UseAsPlayer selection={selection} mode={mode} />
          </>
        }
      />
      <div className={styles.work}>
        <div className={`${theme.panel} ${styles.browser}`} data-tour="studio-browser">
          <Rail category={category} onCategory={setCategory} />
          <Assets
            category={category}
            selection={selection}
            coverUrl={coverUrl}
            media={media}
            isChosen={isChosen}
            onPart={pickPart}
            onScene={save}
            onMedia={importMedia}
            notice={notice}
            full={category === "atmosphere" && scene.selection.atmosphere.length >= MAX_EFFECTS}
          />
        </div>
        <Player template={scene.template} aspect={aspect} coverUrl={coverUrl} lines={lines} media={media} mirror={mirror} onFoot={setFoot} range={range} />
        <Inspector scene={scene} parts={inspected} coverUrl={coverUrl} media={media} onChange={save} />
      </div>
      {track ? (
        <Timeline
          track={{ id: track.id, coverUrl: track.coverUrl }}
          template={scene.template}
          aspect={aspect}
          media={media}
          lines={lines}
          range={range}
          onRange={setRange}
          history={history}
          onMarkIn={markIn}
          onMarkOut={markOut}
        />
      ) : (
        <section className={theme.panel} />
      )}
    </div>
  );
}
