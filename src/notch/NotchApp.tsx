import { useCallback, useEffect, useMemo, useRef, useState, type WheelEvent } from "react";
import { CompactFace } from "./CompactFace";
import { ExpandedFace } from "./ExpandedFace";
import { Island, MORPH } from "./Island";
import {
  DEFAULT_NOTCH_SETTINGS,
  type Cutout,
  type NotchAction,
  type NotchLyrics,
  type NotchPlaylists,
  type NotchPresence,
  type NotchSettings,
  type NotchState,
  type NotchTrack,
} from "./contracts";
import {
  capturesPointer,
  grownRect,
  islandRect,
  islandSizes,
  PAGE_HEIGHTS,
  notchWindow,
  pageSize,
  type IslandMode,
  type IslandSize,
  type NotchPage,
  type Point,
  type Rect,
} from "./lib/geometry";
import { IslandMachine } from "./lib/machine";
import { MORPH_SPRING, simulateSpring } from "./lib/spring";
import { activeLineIndex, msUntilNextLine, positionAt, predicted, type LyricLine, type PositionSample } from "./lib/playback";
import type { NotchBridge } from "../../electron/app/preload-notch";
import "./fonts/fonts.css";
import "./notch.css";

/** The Notch window's preload exposes its own channels under the same global name. */
const notchBridge = () => window.nuvoElectron as unknown as NotchBridge | undefined;

const VOLUME_STEP = 0.05;
const VOLUME_VISIBLE_MS = 1500;
const WHEEL_THRESHOLD = 40;
const WHEEL_IDLE_MS = 280;
const NO_LINES: LyricLine[] = [];
const NUDGE_MS = 1500;
const NUDGED_KEY = "nuvo_notch_nudged";
const MORPH_OVERSHOOT = Math.max(0, Math.max(...simulateSpring(MORPH_SPRING).values) - 1);

export default function NotchApp() {
  const [state, setState] = useState<NotchState | null>(null);
  const [lyrics, setLyrics] = useState<NotchLyrics | null>(null);
  const [playlists, setPlaylists] = useState<NotchPlaylists | null>(null);
  const [settings, setSettings] = useState<NotchSettings>(DEFAULT_NOTCH_SETTINGS);
  const [cutout, setCutout] = useState<Cutout | null>(null);
  const [presence, setPresence] = useState<NotchPresence>("out");
  const sizes = useMemo(() => islandSizes(cutout), [cutout]);
  const [machine, setMachine] = useState<IslandMachine | null>(null);
  const [mode, setMode] = useState<IslandMode>("idle");
  const [view, setView] = useState<NotchPage>("now");
  const [nudge, setNudge] = useState(false);
  const [accent, setAccent] = useState<{ url: string | null; color: string }>({ url: null, color: "#ffffff" });
  const [volume, setVolume] = useState<{ louder: boolean; step: number } | null>(null);
  const [lineIndex, setLineIndex] = useState(-1);
  const islandRef = useRef<HTMLDivElement>(null);

  const track = state?.track ?? null;
  const trackId = track?.id ?? null;
  const playing = state?.status === "playing";
  const upNextCount = state?.upNext.length ?? 0;

  useEffect(() => {
    const created = new IslandMachine((next) => {
      setMode(next);
      if (next !== "expanded") setView((current) => (current === "add" ? "now" : current));
    });
    setMachine(created);
    return () => created.dispose();
  }, []);

  useEffect(() => {
    const api = notchBridge();
    if (!api) return;
    let alive = true;
    let gotState = false;
    let gotLyrics = false;
    let gotPlaylists = false;
    let gotSettings = false;
    let gotCutout = false;
    let gotPresence = false;
    const unsubscribe = [
      api.onNotchState((next) => {
        gotState = true;
        setState(next);
      }),
      api.onNotchLyrics((next) => {
        gotLyrics = true;
        setLyrics(next);
      }),
      api.onNotchPlaylists((next) => {
        gotPlaylists = true;
        setPlaylists(next);
      }),
      api.onNotchSettings((next) => {
        gotSettings = true;
        setSettings(next);
      }),
      api.onNotchCutout((next) => {
        gotCutout = true;
        setCutout(next);
      }),
      api.onNotchPresence((next) => {
        gotPresence = true;
        setPresence(next);
      }),
    ];
    api
      .notchHello()
      .then((hello) => {
        if (!alive) return;
        // A live update that raced the hello reply is newer; keep it.
        if (!gotState && hello.state) setState(hello.state);
        if (!gotLyrics && hello.lyrics) setLyrics(hello.lyrics);
        if (!gotPlaylists && hello.playlists) setPlaylists(hello.playlists);
        if (!gotSettings) setSettings(hello.settings);
        if (!gotCutout) setCutout(hello.cutout);
        if (!gotPresence) setPresence(hello.presence);
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
    if (previous !== trackId) setView((current) => (current === "add" ? "now" : current));
    const changed = previous !== null && trackId !== null && previous !== trackId;
    machine.setTrack(trackId !== null, changed && pulseOnTrackChange);
    // setTrack(false) forgets the pointer; a track arriving under the pointer must hover again.
    if (previous === null && trackId !== null && islandRef.current?.matches(":hover")) machine.pointerEnter();
  }, [machine, trackId, pulseOnTrackChange]);

  const lines = lyrics && lyrics.trackId === trackId ? lyrics.lines : NO_LINES;
  const pages = useMemo<NotchPage[]>(
    () => ["now", ...(settings.showLyrics && lines.length > 0 ? (["lyrics"] as const) : []), ...(upNextCount > 0 ? (["upNext"] as const) : [])],
    [settings.showLyrics, lines.length, upNextCount],
  );
  const page = view === "add" || pages.includes(view) ? view : "now";
  const expanded = mode === "expanded";
  const size = useMemo(() => (expanded ? pageSize(sizes.expanded, page) : sizes[mode]), [expanded, sizes, mode, page]);

  useEffect(() => {
    if (!expanded || pages.length < 2) return;
    try {
      if (localStorage.getItem(NUDGED_KEY)) return;
      localStorage.setItem(NUDGED_KEY, "1");
    } catch {
      return;
    }
    setNudge(true);
    const timer = setTimeout(() => setNudge(false), NUDGE_MS);
    return () => {
      clearTimeout(timer);
      setNudge(false);
    };
  }, [expanded, pages.length]);

  const shapeRect = useRef<Rect>(islandRect(sizes.idle));
  const pointer = useRef({ at: null as Point | null, buttons: 0, capturing: false });
  const updateCapture = () => {
    const { at, buttons, capturing } = pointer.current;
    const next = capturesPointer(at, shapeRect.current, capturing, buttons);
    if (next === capturing) return;
    pointer.current.capturing = next;
    notchBridge()?.notchSetCapture?.(next);
  };

  useEffect(() => {
    const onMove = (event: MouseEvent) => {
      pointer.current.at = { x: event.clientX, y: event.clientY };
      pointer.current.buttons = event.buttons;
      updateCapture();
    };
    const onLeave = () => {
      pointer.current.at = null;
      updateCapture();
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mousedown", onMove);
    window.addEventListener("mouseup", onMove);
    document.documentElement.addEventListener("mouseleave", onLeave);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mousedown", onMove);
      window.removeEventListener("mouseup", onMove);
      document.documentElement.removeEventListener("mouseleave", onLeave);
    };
  }, []);

  const shapeSize = useRef<IslandSize>(sizes.idle);
  const shapePadded = useRef(false);
  useEffect(() => {
    const next = size;
    const previous = shapeSize.current;
    const setShape = (rect: Rect) => {
      shapeRect.current = rect;
      notchBridge()?.notchSetShape(rect);
      updateCapture();
    };
    const armTighten = () => {
      const tighten = setTimeout(() => {
        shapePadded.current = false;
        setShape(islandRect(next));
      }, MORPH.durationMs);
      return () => clearTimeout(tighten);
    };
    // An interrupted grow (or a StrictMode re-run) can return here with the padding still applied.
    if (next === previous) return shapePadded.current ? armTighten() : undefined;
    if (expanded && next.height < previous.height) machine?.linger();
    if (next.width * next.height >= previous.width * previous.height) {
      shapeSize.current = next;
      shapePadded.current = true;
      setShape(grownRect(previous, next, MORPH_OVERSHOOT, notchWindow(cutout)));
      return armTighten();
    }
    const shrink = setTimeout(() => {
      shapeSize.current = next;
      shapePadded.current = false;
      setShape(islandRect(next));
    }, MORPH.durationMs);
    return () => clearTimeout(shrink);
  }, [machine, expanded, size, cutout]);

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
  const lyricsActive = expanded && page === "lyrics";

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

  const flip = (direction: number) => {
    const target = pages[pages.indexOf(page) + direction];
    if (page !== "add" && target) setView(target);
  };
  const toNow = useCallback(() => setView("now"), []);

  const send = (action: NotchAction) => {
    notchBridge()?.notchAction(action);
    setState((current) => current && predicted(current, action, Date.now()));
  };

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
      if (!expanded || acc.switched) return;
      acc.x += event.deltaX;
      if (Math.abs(acc.x) < WHEEL_THRESHOLD) return;
      acc.switched = true;
      flip(Math.sign(acc.x));
      return;
    }
    if (page === "add") return;
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
    <div className="notch-stage" data-presence={presence}>
      <Island
        ref={islandRef}
        mode={mode}
        size={size}
        cutout={cutout}
        onMouseEnter={() => machine?.pointerEnter()}
        onMouseLeave={() => machine?.pointerLeave()}
        onClick={(event) => {
          if ((event.target as Element).closest("button, [data-control]")) return;
          machine?.click();
        }}
        onWheel={onWheel}
      >
        <CompactFace
          mode={mode}
          split={cutout !== null}
          track={track}
          playing={playing}
          accent={accentColor}
          onAccent={onAccent}
          onFocusApp={() => send({ type: "focusApp" })}
        />
        {state && sample && track && (
          <ExpandedFace
            state={state as NotchState & { track: NotchTrack }}
            sample={sample}
            page={page}
            pages={pages}
            height={PAGE_HEIGHTS[page]}
            live={expanded && page === "now" && playing}
            lines={lines}
            lineIndex={lineIndex}
            playlists={playlists}
            accent={accentColor}
            nudge={nudge}
            onPage={setView}
            onFlip={flip}
            onAdded={toNow}
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
