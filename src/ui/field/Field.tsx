import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type JSX } from "react";
import { usePageBackdropStore } from "../ports/backdrop";
import { useCoverSrc } from "../ports/covers";
import { useCustomizationStore, wallpaperKind } from "../ports/settings";
import { isWindowVisible, onWindowVisibilityChange } from "../ports/window";
import { useLook } from "../ports/theme";
import { useCalmStore } from "./calm";
import { useReducedEffects } from "../effects";
import styles from "./Field.module.css";

const FADE_MS = 380;
const FILL_DARKEN = 0.38;
const SAMPLE_WIDTH = 16;
const FOOT_SHARE = 0.08;

type Rgb = readonly number[];

function footRow(picture: HTMLImageElement): Uint8ClampedArray | null {
  const { naturalWidth: width, naturalHeight: height } = picture;
  if (!width || !height) return null;
  const sampler = Object.assign(document.createElement("canvas"), { width: SAMPLE_WIDTH, height: 1 }).getContext("2d", { willReadFrequently: true });
  if (!sampler) return null;
  const footHeight = Math.max(1, height * FOOT_SHARE);
  try {
    sampler.drawImage(picture, 0, height - footHeight, width, footHeight, 0, 0, SAMPLE_WIDTH, 1);
    return sampler.getImageData(0, 0, SAMPLE_WIDTH, 1).data;
  } catch {
    return null;
  }
}

function darkenedMean(row: Uint8ClampedArray): Rgb {
  const totals = [0, 0, 0, 0];
  row.forEach((byte, offset) => {
    totals[offset % 4] += byte;
  });
  return totals.slice(0, 3).map((total) => Math.round((total / SAMPLE_WIDTH) * FILL_DARKEN));
}

export function Field(): JSX.Element {
  const look = useLook();
  const wallpaper = useCustomizationStore((s) => s.backgroundImage);
  const coverGlow = useCustomizationStore((s) => s.coverGlow);
  const calm = useCalmStore((s) => s.count > 0);
  const reduced = useReducedEffects();
  const pageCover = usePageBackdropStore((s) => s.coverUrl);
  const options = usePageBackdropStore((s) => s.options);
  const cover = useCoverSrc(coverGlow && !calm && !reduced ? (pageCover ?? undefined) : undefined);
  const dark = look.mode === "dark";
  return (
    <div className={styles.field} aria-hidden="true" data-mode={look.mode}>
      {wallpaper ? <Wallpaper src={wallpaper} /> : cover ? <Backdrop src={cover} dark={dark} blur={options?.blur ?? 32} dim={options?.dim ?? 0} /> : null}
    </div>
  );
}

// Generations only grow, so a cover that comes back still gets a fresh element
type CoverLayer = { generation: number; src: string };

const COVER_IMG = { alt: "", crossOrigin: "anonymous", draggable: false, decoding: "async" } as const;

function Backdrop({ src, dark, blur, dim }: { src: string; dark: boolean; blur: number; dim: number }) {
  const [stack, setStack] = useState<CoverLayer[]>([{ generation: 0, src }]);
  const [visible, setVisible] = useState(-1);
  const [foot, setFoot] = useState<Rgb | null>(null);
  const top = stack[stack.length - 1];

  if (top.src !== src) setStack([top, { generation: top.generation + 1, src }]);

  const reveal = (layer: CoverLayer, picture: HTMLImageElement) => {
    if (layer.generation !== top.generation) return;
    const row = footRow(picture);
    setFoot(row ? darkenedMean(row) : null);
    setVisible(layer.generation);
    window.setTimeout(() => setStack((now) => now.filter((kept) => kept.generation >= layer.generation)), FADE_MS + 60);
  };

  // the cover's colour is mixed into the theme's own field, so every preset still shows under the glow
  const tint = foot ? `color-mix(in oklab, rgb(${foot.join(" ")}) ${dark ? 40 : 30}%, var(--n-deep))` : undefined;
  const filter = `blur(${blur}px) saturate(130%)`;

  return (
    <div className={styles.backdrop} style={{ backgroundColor: tint }}>
      <div className={styles.cover} style={{ "--blur": `${blur}px` } as CSSProperties}>
        {stack.map((layer) => (
          <img
            {...COVER_IMG}
            key={layer.generation}
            src={layer.src}
            style={{ filter }}
            data-shown={visible === layer.generation ? "" : undefined}
            onLoad={(event) => reveal(layer, event.currentTarget)}
          />
        ))}
        {dark && dim > 0 ? <div className={styles.dim} style={{ opacity: dim }} /> : null}
      </div>
      {dark ? null : <div className={styles.veil} />}
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
