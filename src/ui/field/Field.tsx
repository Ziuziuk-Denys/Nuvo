import { useEffect, useRef, useSyncExternalStore, type CSSProperties, type JSX } from "react";
import { usePageBackdropStore } from "../ports/backdrop";
import { usePlayingCover } from "../ports/player";
import { useCustomizationStore, wallpaperKind } from "../ports/settings";
import { isWindowVisible, onWindowVisibilityChange } from "../ports/window";
import { useLook } from "../ports/theme";
import { LightCanvas } from "../light/LightCanvas";
import { NEUTRAL } from "../light/readLight";
import { useCoverLight } from "../light/useCoverLight";
import { useGround } from "../light/useGround";
import { useLightVars } from "../light/useLightVars";
import { Banner } from "./Banner";
import { useCalmStore } from "./calm";
import { useReducedEffects } from "../effects";
import styles from "./Field.module.css";

export function Field(): JSX.Element {
  const dark = useLook().mode === "dark";
  const wallpaper = useCustomizationStore((s) => s.backgroundImage);
  const coverGlow = useCustomizationStore((s) => s.coverGlow);
  const calm = useCalmStore((s) => s.count > 0);
  const pageCover = usePageBackdropStore((s) => s.coverUrl);
  const options = usePageBackdropStore((s) => s.options);
  const playing = usePlayingCover();
  const ground = useGround();
  const light = useCoverLight(coverGlow ? pageCover || playing || undefined : undefined) ?? NEUTRAL;
  useLightVars(light);
  const scene = calm ? "calm" : pageCover ? (options.scene ?? "page") : "wall";
  return (
    <div className={styles.field} aria-hidden="true" data-mode={dark ? "dark" : "light"}>
      {wallpaper ? (
        <Wallpaper src={wallpaper} />
      ) : coverGlow ? (
        <LightCanvas className={options.pinned ? undefined : styles.light} light={light} scene={scene} dark={dark} base={ground} />
      ) : null}
      {options.banner ? <Banner key={options.banner} src={options.banner} portrait={false} /> : null}
      {options.portrait ? <Banner key={options.portrait} src={options.portrait} portrait /> : null}
    </div>
  );
}

function Wallpaper({ src }: { src: string }) {
  const blur = useCustomizationStore((s) => s.backgroundBlur);
  const dim = useCustomizationStore((s) => s.backgroundDim);
  const fit = useCustomizationStore((s) => s.backgroundFit);
  const visible = useSyncExternalStore(onWindowVisibilityChange, isWindowVisible);
  const reduced = useReducedEffects();
  // the picture overhangs by two blur radii so the blur never fades its own edges
  const style: CSSProperties = {
    inset: -blur * 2,
    width: `calc(100% + ${blur * 4}px)`,
    height: `calc(100% + ${blur * 4}px)`,
    objectFit: fit,
    filter: blur > 0 ? `blur(${blur}px)` : undefined,
  };
  return (
    <>
      <WallpaperMedia src={src} moving={visible && !reduced} className={styles.wallpaper} style={style} />
      {dim > 0 && <div className={styles.wash} style={{ opacity: dim / 100 }} />}
    </>
  );
}

export function WallpaperMedia(props: { src: string; moving: boolean; className?: string; style?: CSSProperties; onError?(): void }): JSX.Element {
  const { src, moving, ...rest } = props;
  const kind = wallpaperKind(src);
  if (kind === "video") return <Video src={src} playing={moving} {...rest} />;
  if (kind === "gif" && !moving) return <Still src={src} {...rest} />;
  return <img {...rest} src={src} alt="" draggable={false} decoding="async" />;
}

function Video({ src, playing, onError, ...rest }: { src: string; playing: boolean; className?: string; style?: CSSProperties; onError?(): void }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    if (playing) video.play().catch(() => undefined);
    else video.pause();
  }, [playing, src]);
  return <video {...rest} ref={ref} src={src} muted loop playsInline preload="auto" disablePictureInPicture disableRemotePlayback onError={onError} />;
}

function Still({ src, ...rest }: { src: string; className?: string; style?: CSSProperties; onError?(): void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let live = true;
    const picture = new Image();
    picture.addEventListener("load", () => {
      const canvas = ref.current;
      if (!live || !canvas) return;
      canvas.width = picture.naturalWidth;
      canvas.height = picture.naturalHeight;
      canvas.getContext("2d")?.drawImage(picture, 0, 0);
    });
    picture.src = src;
    return () => {
      live = false;
    };
  }, [src]);
  return <canvas {...rest} ref={ref} />;
}
