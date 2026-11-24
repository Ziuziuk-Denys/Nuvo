import { useEffect, useState } from "react";
import { composite, luminance, parseColor, toHex } from "@/data/color/contrast";
import heart from "./likesHeart.webp?inline";

const mix = (from: string, to: string, amount: number) => toHex(composite({ ...parseColor(to), a: amount }, parseColor(from)));

// From the deepest shadow on the wall to the brightest edge of the heart
export function likesCoverTones(accent: string, field: string): string[] {
  const a = toHex(parseColor(accent));
  const f = toHex(parseColor(field));
  if (luminance(parseColor(a)) < luminance(parseColor(f))) {
    return [mix(a, "#000000", 0.6), a, mix(a, "#ffffff", 0.5), mix(a, "#ffffff", 0.9), "#ffffff"];
  }
  return [mix(f, "#000000", 0.75), mix(f, a, 0.13), mix(a, f, 0.35), a, mix(a, "#ffffff", 0.75)];
}

export function likesCoverSvg(tones: string[]): string {
  const colors = tones.map(parseColor);
  const channel = (key: "r" | "g" | "b") => colors.map((color) => (color[key] / 255).toFixed(3)).join(" ");
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><filter id="tint" color-interpolation-filters="sRGB" x="0" y="0" width="1" height="1"><feComponentTransfer>` +
    `<feFuncR type="table" tableValues="${channel("r")}"/><feFuncG type="table" tableValues="${channel("g")}"/><feFuncB type="table" tableValues="${channel("b")}"/>` +
    `</feComponentTransfer></filter><image href="${heart}" x="-36" y="-36" width="584" height="584" filter="url(#tint)"/></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function themeCover(): string {
  const style = getComputedStyle(document.documentElement);
  const read = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  return likesCoverSvg(likesCoverTones(read("--n-accent", "#4a69b0"), read("--n-field", "#f4f7ff")));
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
