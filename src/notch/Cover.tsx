import { useState } from "react";
import { NuvoGlyph } from "./icons";
import { accentFromPixels } from "./lib/accent";

const SAMPLE = 16;
const FALLBACK_ACCENT = "#ffffff";

function sampleAccent(img: HTMLImageElement): string {
  const canvas = document.createElement("canvas");
  canvas.width = SAMPLE;
  canvas.height = SAMPLE;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return FALLBACK_ACCENT;
  try {
    context.drawImage(img, 0, 0, SAMPLE, SAMPLE);
    return accentFromPixels(context.getImageData(0, 0, SAMPLE, SAMPLE).data);
  } catch {
    // A cover served without CORS headers taints the canvas.
    return FALLBACK_ACCENT;
  }
}

interface CoverProps {
  src: string | null;
  size: number;
  radius: number;
  onAccent?: (color: string) => void;
}

export function Cover({ src, size, radius, onAccent }: CoverProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const style = { width: size, height: size, borderRadius: radius };
  if (!src || failedSrc === src) {
    return (
      <span className="cover cover-placeholder" style={style}>
        <NuvoGlyph size={Math.round(size * 0.42)} />
      </span>
    );
  }
  return (
    <img
      className="cover"
      src={src}
      alt=""
      width={size}
      height={size}
      style={style}
      crossOrigin="anonymous"
      draggable={false}
      onLoad={onAccent ? (event) => onAccent(sampleAccent(event.currentTarget)) : undefined}
      onError={() => {
        setFailedSrc(src);
        onAccent?.(FALLBACK_ACCENT);
      }}
    />
  );
}
