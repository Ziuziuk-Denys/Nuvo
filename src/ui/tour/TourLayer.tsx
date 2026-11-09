import { useEffect, useRef, useState, type CSSProperties, type JSX } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { focusables, LAYER_ATTRIBUTE, usePresence } from "../components/layers";
import { useTranslation } from "../ports/i18n";
import { useGateStore } from "../screens/lock/gateState";
import { Brief } from "./Brief";
import { Callout } from "./Callout";
import { chapterById, type Step } from "./chapters";
import { dockLeft, dockOnTop, ringAround, type Area, type Box, type Ring } from "./placement";
import { runStep } from "./runStep";
import { SkipPrompt } from "./SkipPrompt";
import { StartStep } from "./StartStep";
import { boxOf, panelOf, sameBox, targetElement } from "./targets";
import { TourDock } from "./TourDock";
import { TourPoster } from "./TourPoster";
import { briefWaiting, lastStep, useTour, waiting } from "./tourStore";
import { useTourStage } from "./useTourStage";
import styles from "./tour.module.css";

const DOCK_ZONE = 104;
// Must match the dock's min(560px, 100% - 32px) width in the stylesheet
const DOCK_WIDTH = 560;
const RESTORE_DELAY_MS = 1200;
const MORE_CHECK_MS = 2000;

interface Frame {
  box: Box & { radius: number };
  panel: Box | null;
}

function useWindowSize(): { width: number; height: number } {
  const [size, setSize] = useState({ width: window.innerWidth, height: window.innerHeight });
  useEffect(() => {
    const onResize = () => setSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return size;
}

/* An even-odd polygon: the whole window minus the outline, so presses inside the outline reach the real control */
function holeClip(ring: Ring): string {
  const { x, y, width, height } = ring;
  const right = x + width;
  const bottom = y + height;
  return `polygon(evenodd, 0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${x}px ${y}px, ${right}px ${y}px, ${right}px ${bottom}px, ${x}px ${bottom}px, ${x}px ${y}px)`;
}

function cycleFocus(event: KeyboardEvent, scope: HTMLElement[]): void {
  const items = scope.filter((item) => item.tabIndex >= 0);
  if (items.length === 0) return;
  event.preventDefault();
  const at = items.indexOf(document.activeElement as HTMLElement);
  const next = at === -1 ? 0 : (at + (event.shiftKey ? -1 : 1) + items.length) % items.length;
  items[next].focus({ preventScroll: true });
}

export function TourLayer(): JSX.Element | null {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const phase = useTour((state) => state.phase);
  const poster = useTour((state) => state.poster);
  const chapterIds = useTour((state) => state.chapterIds);
  const chapter = useTour((state) => state.chapter);
  const step = useTour((state) => state.step);
  const prompt = useTour((state) => state.prompt);
  const resumeAt = useTour((state) => state.at);
  const missed = useTour((state) => state.missed);
  const last = useTour(lastStep);
  const gateWaits = useTour(waiting);
  const briefWaits = useTour(briefWaiting);
  const away = useTour((state) => state.away);
  const locked = useGateStore((state) => state.locked);
  const presence = usePresence(phase !== "off" && !locked);
  const { stage, shown } = useTourStage(navigate);
  const [shownKey, setShownKey] = useState<string | null>(null);
  const stepKey = `${chapterIds.join()}:${chapter}:${step}`;
  const ready = phase === "chapter" && shownKey === stepKey;
  const [onScreen, setOnScreen] = useState({ chapter: 0, step: 0 });
  const [frame, setFrame] = useState<Frame | null>(null);
  const size = useWindowSize();
  const rootRef = useRef<HTMLDivElement>(null);
  const shownRef = useRef<Step | null>(null);
  useEffect(() => {
    shownRef.current = shown;
  }, [shown]);
  const sceneOf = useRef<string | null>(null);

  useEffect(() => {
    if (locked) return;
    const timer = window.setTimeout(() => useTour.getState().restore(), RESTORE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [locked]);

  useEffect(() => {
    if (phase !== "off" || locked) return;
    const timer = window.setInterval(() => {
      const state = useTour.getState();
      if (state.status !== "done" || state.missed.length === 0) return;
      const showable = state.missed.some((id) => {
        const needs = chapterById(id)?.needs;
        return needs ? targetElement(needs) !== null : true;
      });
      if (showable) state.offerMore();
    }, MORE_CHECK_MS);
    return () => window.clearInterval(timer);
  }, [phase, locked]);

  useEffect(() => {
    const current = chapterById(chapterIds[chapter]);
    if (phase !== "chapter" || !current) {
      if (sceneOf.current !== null) stage.clear();
      sceneOf.current = null;
      return;
    }
    const scene = `${chapterIds.join()}:${chapter}`;
    const fresh = sceneOf.current !== scene;
    sceneOf.current = scene;
    if (fresh) setFrame(null);
    let alive = true;
    const key = `${chapterIds.join()}:${chapter}:${step}`;
    void runStep(current, step, stage, () => alive, fresh).then((result) => {
      if (!alive) return;
      if (result === "shown") {
        setShownKey(key);
        setOnScreen({ chapter, step });
      } else if (result === "missing") useTour.getState().missing();
      else if (result === "missing-chapter") useTour.getState().missingChapter();
    });
    return () => {
      alive = false;
    };
  }, [phase, chapterIds, chapter, step, stage]);

  useEffect(() => {
    if (phase !== "chapter") {
      setFrame(null);
      return;
    }
    if (!shown) return;
    let id = 0;
    let previous: Frame | null = null;
    const read = () => {
      const element = targetElement(shown.target);
      const next = element ? { box: boxOf(element), panel: panelOf(element) } : null;
      const same = previous && next && sameBox(previous.box, next.box) && sameBox(previous.panel, next.panel);
      if (next && !same) {
        previous = next;
        setFrame(next);
      }
      id = requestAnimationFrame(read);
    };
    read();
    return () => cancelAnimationFrame(id);
  }, [phase, shown]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const timer = window.setTimeout(() => {
      const wanted =
        phase === "chapter" && prompt
          ? root.querySelector<HTMLElement>("[data-prompt] button")
          : phase === "chapter" && ready
            ? root.querySelector<HTMLElement>("[data-next]")
            : phase === "poster"
              ? root.querySelector<HTMLElement>("[data-primary]")
              : phase === "brief"
                ? root.querySelector<HTMLElement>("[data-next]")
                : null;
      wanted?.focus({ preventScroll: true });
    });
    return () => window.clearTimeout(timer);
  }, [phase, poster, prompt, ready, presence, away]);

  useEffect(() => {
    if (phase === "off") return;
    const onKeyDown = (event: KeyboardEvent) => {
      const state = useTour.getState();
      if (state.away) return;
      const root = rootRef.current;
      const step = shownRef.current;
      const live = state.phase === "chapter" && !state.prompt && step?.interactive ? targetElement(step.target) : null;
      const target = event.target instanceof Node ? event.target : null;

      if (event.key === "Tab") {
        const promptCard = root?.querySelector<HTMLElement>("[data-prompt]");
        cycleFocus(event, promptCard ? focusables(promptCard) : [...(live ? focusables(live) : []), ...(root ? focusables(root) : [])]);
        return;
      }
      if (live && target && live.contains(target) && event.key !== "Escape") return;
      event.stopPropagation();

      if (event.key === "Escape") {
        event.preventDefault();
        if (state.phase === "chapter") {
          if (state.prompt) state.closePrompt();
          else state.openPrompt();
        } else if (state.phase === "poster") {
          if (state.poster === "start") state.toBrief();
          else if (state.poster === "resume") state.later();
          else state.decline();
        } else if (state.phase === "brief" && !briefWaiting(state)) {
          state.finish();
        }
        return;
      }
      if (state.phase !== "chapter" || state.prompt) return;
      const onButton = target instanceof Element && root?.contains(target) && target.closest("button") !== null;
      if (event.key === "ArrowRight" || (event.key === "Enter" && !onButton)) {
        event.preventDefault();
        if (!waiting(state)) state.next();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        state.back();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [phase]);

  if (presence === null) return null;

  const tour = useTour.getState();
  const inChapter = phase === "chapter";
  const ring = inChapter && frame ? ringAround(frame.box, size) : null;
  const onTop = dockOnTop(ring, size.height, DOCK_ZONE);
  const area: Area = onTop ? { width: size.width, top: DOCK_ZONE, bottom: size.height } : { width: size.width, top: 0, bottom: size.height - DOCK_ZONE };
  const holeStyle: CSSProperties = ring
    ? { transform: `translate(${ring.x}px, ${ring.y}px)`, width: ring.width, height: ring.height, borderRadius: ring.radius }
    : { transform: `translate(${size.width / 2}px, ${size.height / 2}px)`, width: 0, height: 0, borderRadius: 0 };
  const id = chapterIds[chapter];
  const posterChapters = poster === "more" ? missed : resumeAt ? [resumeAt.chapter] : [];
  const announcement = inChapter && ready && shown ? `${t(`ui.tour.chapters.${id}`)}. ${t(`ui.tour.steps.${shown.text}`)}` : "";

  return createPortal(
    <div
      ref={rootRef}
      className={styles.root}
      data-state={presence}
      data-away={away ? "" : undefined}
      data-tour-layer=""
      role="dialog"
      aria-modal="true"
      aria-label={t("ui.tour.label")}
      onContextMenu={(event) => event.preventDefault()}
      {...{ [LAYER_ATTRIBUTE]: "" }}
    >
      <div className={styles.blocker} style={ring && shown?.interactive && !prompt ? { clipPath: holeClip(ring) } : undefined} />
      <div className={styles.hole} style={holeStyle} data-empty={ring ? undefined : ""} />

      {inChapter && ring && frame && shown && ready ? (
        <Callout ring={ring} panel={frame.panel} area={area} side={shown.side} text={t(`ui.tour.steps.${shown.text}`)} stepKey={`${id}:${step}`} />
      ) : null}

      {inChapter ? (
        <div
          key={onTop ? "top" : "bottom"}
          className={styles.dockWrap}
          data-top={onTop ? "" : undefined}
          style={{
            left: dockLeft(
              ring,
              size.width,
              Math.min(DOCK_WIDTH, size.width - 32),
              onTop ? { top: 0, bottom: DOCK_ZONE } : { top: size.height - DOCK_ZONE, bottom: size.height },
            ),
          }}
        >
          {prompt ? <SkipPrompt onChapter={tour.skipChapter} onLater={tour.later} onAll={tour.toBrief} onStay={tour.closePrompt} /> : null}
          <TourDock
            chapterIds={chapterIds}
            chapter={ready ? chapter : onScreen.chapter}
            step={ready ? step : onScreen.step}
            last={last}
            waiting={gateWaits}
            ready={ready}
            onReady={tour.markRead}
            onNext={tour.next}
            onBack={tour.back}
            onSkip={tour.openPrompt}
          />
        </div>
      ) : null}

      {phase === "poster" ? (
        <div className={styles.center}>
          {poster === "start" ? (
            <StartStep onContinue={tour.watch} onSkipTour={tour.toBrief} />
          ) : (
            <TourPoster key={poster} kind={poster} chapters={posterChapters} onWatch={tour.watch} onSkip={poster === "resume" ? tour.finish : tour.decline} />
          )}
        </div>
      ) : null}

      {phase === "brief" ? (
        <div className={styles.center}>
          <Brief waiting={briefWaits} onReady={tour.markBriefRead} onDone={tour.finish} onWatch={tour.rewatch} />
        </div>
      ) : null}

      <p className={styles.live} aria-live="polite">
        {announcement}
      </p>
    </div>,
    document.body,
  );
}
