import { useEffect, useState } from "react";
import { composite, luminance, parseColor, toHex } from "@/data/color/contrast";

const HEART = "M32 47.327L18.565 33.892A9.5 9.5 0 0 1 32 20.457A9.5 9.5 0 0 1 45.435 33.892Z";
const ECHOES = [
  { offset: 6.5, opacity: 0.42 },
  { offset: 14, opacity: 0.24 },
  { offset: 23, opacity: 0.12 },
];
const ECHO_WIDTH = 1.25;
const CORE_WIDTH = 3.4;

export interface LikesCoverColors {
  ground: string;
  line: string;
}

export function likesCoverColors(accent: string, field: string): LikesCoverColors {
  const a = parseColor(accent);
  const f = parseColor(field);
  if (luminance(a) < luminance(f)) return { ground: toHex(a), line: toHex(f) };
  return { ground: toHex(composite({ ...a, a: 0.16 }, f)), line: toHex(a) };
}

function stroke(color: string, width: number, opacity = 1): string {
  return `<use href="#h" fill="none" stroke="${color}" stroke-width="${width.toFixed(2)}" stroke-opacity="${opacity.toFixed(2)}"/>`;
}

// each echo is a wide band cut back by the ground, so every ring sits at an even offset
export function likesCoverSvg({ ground, line }: LikesCoverColors): string {
  const rings: string[] = [];
  for (const { offset, opacity } of [...ECHOES].reverse()) {
    rings.push(stroke(line, 2 * offset + ECHO_WIDTH, opacity), stroke(ground, 2 * offset - ECHO_WIDTH));
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" stroke-linejoin="round"><defs><path id="h" d="${HEART}"/></defs><rect width="64" height="64" fill="${ground}"/>${rings.join("")}<use href="#h" fill="${ground}" stroke="${line}" stroke-width="${CORE_WIDTH}"/></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function themeCover(): string {
  const style = getComputedStyle(document.documentElement);
  const read = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  return likesCoverSvg(likesCoverColors(read("--n-accent", "#4a69b0"), read("--n-field", "#f4f7ff")));
}

export function useLikesCover(): string {
  const [cover, setCover] = useState(themeCover);
  useEffect(() => {
    const observer = new MutationObserver(() => setCover(themeCover()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["style", "class", "data-theme"] });
    return () => observer.disconnect();
  }, []);
  return cover;
}
