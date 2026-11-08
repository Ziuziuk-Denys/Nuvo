import { useEffect, useMemo, useRef, useState, type WheelEvent } from "react";
import { CompactFace } from "./CompactFace";
import { ExpandedFace, VIEWS, type ExpandedView } from "./ExpandedFace";
import { Island, MORPH } from "./Island";
import { DEFAULT_NOTCH_SETTINGS, type NotchAction, type NotchLyrics, type NotchSettings, type NotchState, type NotchTrack } from "./contracts";
import { ISLAND_SIZES, grownRect, islandRect, type IslandMode, type IslandSize, type Rect } from "./lib/geometry";
import { IslandMachine } from "./lib/machine";
import { MORPH_SPRING, simulateSpring } from "./lib/spring";
import { activeLineIndex, msUntilNextLine, positionAt, type LyricLine, type PositionSample } from "./lib/playback";
import type { NotchBridge } from "../../electron/app/preload-notch";
import "./notch.css";

/** The Notch window's preload exposes its own channels under the same global name. */
const notchBridge = () => window.nuvoElectron as unknown as NotchBridge | undefined;

const VOLUME_STEP = 0.05;
const VOLUME_VISIBLE_MS = 1500;
const WHEEL_THRESHOLD = 40;
const WHEEL_IDLE_MS = 280;
const NO_LINES: LyricLine[] = [];
const MORPH_OVERSHOOT = Math.max(0, Math.max(...simulateSpring(MORPH_SPRING).values) - 1);

export default function NotchApp() {
  const [state, setState] = useState<NotchState | null>(null);
  const [lyrics, setLyrics] = useState<NotchLyrics | null>(null);
  const [settings, setSettings] = useState<NotchSettings>(DEFAULT_NOTCH_SETTINGS);
  const [machine, setMachine] = useState<IslandMachine | null>(null);
  const [mode, setMode] = useState<IslandMode>("idle");
  const [view, setView] = useState<ExpandedView>("now");
  const [accent, setAccent] = useState<{ url: string | null; color: string }>({ url: null, color: "#ffffff" });
  const [volume, setVolume] = useState<{ louder: boolean; step: number } | null>(null);
  const [lineIndex, setLineIndex] = useState(-1);
  const islandRef = useRef<HTMLDivElement>(null);

  const track = state?.track ?? null;
  const trackId = track?.id ?? null;
  const playing = state?.status === "playing";

  useEffect(() => {
    const created = new IslandMachine(setMode);
    setMachine(created);
    return () => created.dispose();
  }, []);

  useEffect(() => {
    const api = notchBridge();
    if (!api) return;
    let alive = true;
    let gotState = false;
    let gotLyrics = false;
    let gotSettings = false;
    const unsubscribe = [
      api.onNotchState((next) => {
        gotState = true;
        setState(next);
      }),
      api.onNotchLyrics((next) => {
        gotLyrics = true;
        setLyrics(next);
      }),
      api.onNotchSettings((next) => {
        gotSettings = true;
        setSettings(next);
      }),
    ];
    api
      .notchHello()
      .then((hello) => {
        if (!alive) return;
        // A live update that raced the hello reply is newer; keep it.
        if (!gotState && hello.state) setState(hello.state);
        if (!gotLyrics && hello.lyrics) setLyrics(hello.lyrics);
        if (!gotSettings) setSettings(hello.settings);
      })
      .catch((error) => console.warn("[notch] hello failed:", error));
    return () => {
      alive = false;
      unsubscribe.forEach((off) => off());
    };
  }, []);

  useEffect(() => {
    machine?.setTrigger(settings.expandOn);
  }, [machine, settings.expandOn]);

  const pulseOnTrackChange = settings.pulseOnTrackChange;
  const lastTrackId = useRef<string | null>(null);
  useEffect(() => {
    if (!machine) return;
    const previous = lastTrackId.current;
    lastTrackId.current = trackId;
    const changed = previous !== null && trackId !== null && previous !== trackId;
    machine.setTrack(trackId !== null, changed && pulseOnTrackChange);
    // setTrack(false) forgets the pointer; a track arriving under the pointer must hover again.
    if (previous === null && trackId !== null && islandRef.current?.matches(":hover")) machine.pointerEnter();
  }, [machine, trackId, pulseOnTrackChange]);

  // Input region: grow at once (padded for the spring overshoot, since setShape also clips painting)
  // and tighten once the morph has ended; shrink only after the morph.
  const shapeSize = useRef<IslandSize>(ISLAND_SIZES.idle);
  const shapePadded = useRef(false);
  useEffect(() => {
    const next = ISLAND_SIZES[mode];
    const previous = shapeSize.current;
    const setShape = (rect: Rect) => notchBridge()?.notchSetShape(rect);
    const armTighten = () => {
      const tighten = setTimeout(() => {
        shapePadded.current = false;
        setShape(islandRect(next));
      }, MORPH.durationMs);
      return () => clearTimeout(tighten);
    };
    // An interrupted grow (or a StrictMode re-run) can return here with the padding still applied.
    if (next === previous) return shapePadded.current ? armTighten() : undefined;
    if (next.width * next.height >= previous.width * previous.height) {
      shapeSize.current = next;
      shapePadded.current = true;
      setShape(grownRect(previous, next, MORPH_OVERSHOOT));
      return armTighten();
    }
    const shrink = setTimeout(() => {
      shapeSize.current = next;
      shapePadded.current = false;
      setShape(islandRect(next));
    }, MORPH.durationMs);
    return () => clearTimeout(shrink);
  }, [mode]);

  const sample = useMemo<PositionSample | null>(
    () =>
      state?.track
        ? {
            positionMs: state.positionMs,
            sampledAt: state.sampledAt,
            playing: state.status === "playing",
            durationMs: state.track.durationMs,
          }
        : null,
    [state],
  );
  const lines = lyrics && lyrics.trackId === trackId ? lyrics.lines : NO_LINES;
  const lyricsActive = mode === "expanded" && lines.length > 0;

  // One timer armed for the next line start; re-armed by every new sample (seek, pause, track).
  useEffect(() => {
    if (!lyricsActive || !sample) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const update = () => {
      const position = positionAt(sample, Date.now());
      setLineIndex(activeLineIndex(lines, position));
      if (!sample.playing) return;
      const wait = msUntilNextLine(lines, position);
      if (wait !== null) timer = setTimeout(update, wait);
    };
    update();
    return () => clearTimeout(timer);
  }, [lyricsActive, sample, lines]);

  const send = (action: NotchAction) => notchBridge()?.notchAction(action);

  useEffect(() => {
    if (!volume) return;
    const timer = setTimeout(() => setVolume(null), VOLUME_VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [volume]);

  const wheel = useRef({ x: 0, y: 0, switched: false, idle: undefined as ReturnType<typeof setTimeout> | undefined });
  useEffect(() => () => clearTimeout(wheel.current.idle), []);

  const onWheel = (event: WheelEvent<HTMLDivElement>) => {
    if (!track) return;
    const acc = wheel.current;
    clearTimeout(acc.idle);
    acc.idle = setTimeout(() => {
      acc.x = 0;
      acc.y = 0;
      acc.switched = false;
    }, WHEEL_IDLE_MS);
    if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
      if (mode !== "expanded" || acc.switched) return;
      acc.x += event.deltaX;
      if (Math.abs(acc.x) < WHEEL_THRESHOLD) return;
      // One switch per swipe gesture.
      acc.switched = true;
      const index = VIEWS.findIndex((item) => item.id === view);
      const nextIndex = Math.min(VIEWS.length - 1, Math.max(0, index + Math.sign(acc.x)));
      setView(VIEWS[nextIndex].id);
      return;
    }
    acc.y += event.deltaY;
    if (Math.abs(acc.y) < WHEEL_THRESHOLD) return;
    const louder = acc.y < 0;
    acc.y = 0;
    send({ type: "volumeDelta", delta: louder ? VOLUME_STEP : -VOLUME_STEP });
    setVolume((current) => ({ louder, step: (current?.step ?? 0) + 1 }));
  };

  const accentColor = accent.url === (track?.coverUrl ?? null) ? accent.color : "#ffffff";
  const onAccent = (color: string) => setAccent({ url: track?.coverUrl ?? null, color });

  return (
    <div className="notch-stage">
      <Island
        ref={islandRef}
        mode={mode}
        onMouseEnter={() => machine?.pointerEnter()}
        onMouseLeave={() => machine?.pointerLeave()}
        onClick={(event) => {
          if ((event.target as Element).closest("button, [data-control]")) return;
          machine?.click();
        }}
        onWheel={onWheel}
      >
        <CompactFace mode={mode} track={track} playing={playing} accent={accentColor} onAccent={onAccent} onFocusApp={() => send({ type: "focusApp" })} />
        {state && sample && track && (
          <ExpandedFace
            state={state as NotchState & { track: NotchTrack }}
            sample={sample}
            view={view}
            live={mode === "expanded" && playing}
            lines={lines}
            lineIndex={lineIndex}
            showLyrics={settings.showLyrics}
            accent={accentColor}
            onView={setView}
            onAction={send}
            onHold={(holding) => machine?.hold(holding)}
          />
        )}
        {volume && (
          <span className="volume" data-direction={volume.louder ? "up" : "down"} aria-hidden="true">
            <span className="volume-nudge" key={volume.step} style={{ backgroundColor: accentColor }} />
          </span>
        )}
      </Island>
    </div>
  );
}
