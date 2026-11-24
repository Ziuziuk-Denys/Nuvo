import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type WheelEvent } from "react";
import { useTranslation } from "@/i18n";
import type { NotchLyrics, NotchState } from "@/notch/contracts";
import { positionAt, predicted, type PositionSample } from "@/notch/lib/playback";
import type { PocketBridge } from "../../electron/app/preload-pocket";
import { Back } from "./Back";
import { POCKET_MENU_KEYS, type PocketAction, type PocketFace, type PocketFeed, type PocketHello, type PocketMenuLabels } from "./contracts";
import { Front } from "./Front";
import { useAwake } from "./useAwake";
import "./pocket.css";

const bridge = () => (window as unknown as { nuvoPocket?: PocketBridge }).nuvoPocket;

const SEEK_STEP_MS = 5000;
const VOLUME_STEP = 0.05;
const WHEEL_STEP_PX = 40;

type Frame = Pick<PocketHello, "margin" | "top">;

export default function PocketApp() {
  const { t } = useTranslation();
  const [state, setState] = useState<NotchState | null>(null);
  const [lyrics, setLyrics] = useState<NotchLyrics | null>(null);
  const [feed, setFeed] = useState<PocketFeed | null>(null);
  const [frame, setFrame] = useState<Frame | null>(null);
  const [wantedFace, setWantedFace] = useState<PocketFace>("cover");
  const [volume, setVolume] = useState<{ step: number; louder: boolean } | null>(null);
  const awake = useAwake(frame?.margin ?? 0);
  const wheel = useRef(0);

  useEffect(() => {
    const b = bridge();
    if (!b) return;
    const offs = [b.onState(setState), b.onLyrics(setLyrics), b.onFeed(setFeed), b.onFace(setWantedFace)];
    void b.hello().then((hello) => {
      setFrame({ margin: hello.margin, top: hello.top });
      setState((now) => now ?? hello.state);
      setLyrics((now) => now ?? hello.lyrics);
      setFeed((now) => now ?? hello.feed);
    });
    return () => offs.forEach((off) => off());
  }, []);

  const track = state?.track ?? null;
  const fed = feed && track && feed.trackId === track.id ? feed : null;
  const coverUrl = fed?.coverUrl ?? track?.coverUrl ?? null;
  const lines = useMemo(() => (track && lyrics?.trackId === track.id ? lyrics.lines : []), [lyrics, track?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const upNext = fed?.upNext ?? state?.upNext ?? [];
  const faces: PocketFace[] = ["cover", ...(lines.length > 0 ? (["lyrics"] as const) : []), ...(upNext.length > 0 ? (["queue"] as const) : [])];
  const face = faces.includes(wantedFace) ? wantedFace : "cover";
  const playing = state?.status === "playing";

  const sample = useMemo<PositionSample>(
    () => ({ positionMs: state?.positionMs ?? 0, sampledAt: state?.sampledAt ?? 0, playing, durationMs: track?.durationMs ?? 0 }),
    [state?.positionMs, state?.sampledAt, playing, track?.durationMs],
  );

  const act = useCallback((action: PocketAction) => {
    bridge()?.action(action);
    setState((now) => now && predicted(now, action, Date.now()));
  }, []);

  const openMenu = useCallback(() => {
    const labels = Object.fromEntries(POCKET_MENU_KEYS.map((key) => [key, t(`ui.pocket.menu_${key}`)])) as PocketMenuLabels;
    bridge()?.menu({ labels, face, faces });
  }, [t, face, faces.join()]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => bridge()?.onContext(openMenu), [openMenu]);

  useEffect(() => {
    if (!volume) return;
    const timer = setTimeout(() => setVolume(null), 900);
    return () => clearTimeout(timer);
  }, [volume]);

  const changeVolume = (louder: boolean) => {
    act({ type: "volumeDelta", delta: louder ? VOLUME_STEP : -VOLUME_STEP });
    setVolume((now) => ({ step: (now?.step ?? 0) + 1, louder }));
  };

  const seekBy = (ms: number) => {
    if (sample.durationMs > 0) act({ type: "seek", positionMs: Math.min(sample.durationMs, Math.max(0, positionAt(sample, Date.now()) + ms)) });
  };

  const onKey = useRef<(event: KeyboardEvent) => void>(() => undefined);
  onKey.current = (event) => {
    if ((event.ctrlKey || event.metaKey) && event.code === "KeyW") return bridge()?.close();
    if (event.ctrlKey || event.altKey || event.metaKey) return;
    const onButton = (event.target as Element).closest("button");
    const keys: Record<string, () => void> = {
      ...(onButton ? {} : { " ": () => act({ type: "togglePlay" }) }),
      ArrowLeft: () => seekBy(-SEEK_STEP_MS),
      ArrowRight: () => seekBy(SEEK_STEP_MS),
      ArrowUp: () => changeVolume(true),
      ArrowDown: () => changeVolume(false),
      KeyL: () => setWantedFace(face === "lyrics" ? "cover" : "lyrics"),
      KeyQ: () => setWantedFace(face === "queue" ? "cover" : "queue"),
      Escape: () => (face === "cover" ? bridge()?.close() : setWantedFace("cover")),
    };
    const run = keys[event.key] ?? keys[event.code];
    if (!run) return;
    event.preventDefault();
    run();
  };

  useEffect(() => {
    const listener = (event: KeyboardEvent) => onKey.current(event);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  const onWheel = (event: WheelEvent) => {
    if (face !== "cover") return;
    wheel.current += event.deltaY;
    if (Math.abs(wheel.current) < WHEEL_STEP_PX) return;
    changeVolume(wheel.current < 0);
    wheel.current = 0;
  };

  if (!frame) return null;

  const look = feed?.look;
  const style = {
    "--margin": `${frame.margin}px`,
    ...(look ? { "--field": look.field, "--ink": look.ink } : {}),
  } as CSSProperties;

  return (
    <div
      className="pocket"
      style={style}
      data-native={frame.margin === 0 || undefined}
      data-mode={look?.light ? "light" : "dark"}
      data-awake={awake}
      data-face={face}
      onWheel={onWheel}
      onContextMenu={(event) => {
        event.preventDefault();
        openMenu();
      }}
    >
      <div className="drag" aria-hidden="true" />
      <Front
        state={state}
        track={track}
        coverUrl={coverUrl}
        sample={sample}
        awake={awake}
        hidden={face !== "cover"}
        turnTo={faces[1] ?? null}
        onAction={act}
        onFace={setWantedFace}
        onClose={() => bridge()?.close()}
      />
      <Back
        face={face}
        faces={faces}
        coverUrl={coverUrl}
        lines={lines}
        upNext={upNext}
        sample={sample}
        playing={playing}
        onAction={act}
        onFace={setWantedFace}
      />
      {volume ? <span key={volume.step} className="pocket-volume" data-louder={volume.louder} aria-hidden="true" /> : null}
    </div>
  );
}
