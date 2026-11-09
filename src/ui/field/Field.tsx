import { useState, type JSX } from "react";
import { usePageBackdropStore } from "../ports/backdrop";
import { useCoverSrc } from "../ports/covers";
import { useCustomizationStore } from "../ports/settings";
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
  const showWallpaper = Boolean(wallpaper) && dark;

  return (
    <div className={styles.field} aria-hidden="true" data-mode={look.mode}>
      {showWallpaper ? <Wallpaper src={wallpaper!} /> : cover ? <Backdrop src={cover} dark={dark} blur={options?.blur ?? 32} dim={options?.dim ?? 0} /> : null}
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

  const tint = foot ? `rgb(${foot.join(" ")} / ${dark ? 0.9 : 0.35})` : undefined;
  const filter = `blur(${blur}px) saturate(130%)`;

  return (
    <div className={styles.backdrop} style={{ backgroundColor: tint }}>
      <div className={styles.cover}>
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
  return (
    <>
      <img
        src={src}
        alt=""
        className={styles.wallpaper}
        style={{
          inset: -blur * 2,
          width: `calc(100% + ${blur * 4}px)`,
          height: `calc(100% + ${blur * 4}px)`,
          filter: blur > 0 ? `blur(${blur}px)` : undefined,
        }}
      />
      {dim > 0 && <div className={styles.dim} style={{ opacity: dim / 100 }} />}
    </>
  );
}
