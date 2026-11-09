import { useState, useSyncExternalStore, useEffect } from "react";
import { contrastRatio } from "../../ports/color";
import type { PresetId } from "../../ports/theme";

// Developer-only screen: plain English literals, exempt from the localisation rule

export const PRESET_NAMES: Record<PresetId, string> = {
  nuvo: "Nuvo",
  editor: "Editor",
  orbit: "Orbit",
  vinyl: "Vinyl",
  cosmos: "Cosmos",
  sunset: "Sunset",
  amethyst: "Amethyst",
  y2k: "Y2K",
  cassette: "Cassette",
};

export const LONG_RU = "Очень длинное название трека, которое не помещается в строку";

export interface TypeRole {
  id: "display" | "title" | "heading" | "body" | "label" | "caption" | "numeral";
  spec: string;
  sample: string;
  russian: string;
}

export const TYPE_ROLES: TypeRole[] = [
  { id: "display", spec: "40 / 44 · 700 · -0.02em", sample: "Listen", russian: "Слушать" },
  { id: "title", spec: "24 / 30 · 600 · -0.01em", sample: "Continue listening", russian: "Слушать" },
  { id: "heading", spec: "17 / 22 · 600", sample: "Late night drive", russian: LONG_RU },
  { id: "body", spec: "14 / 20 · 400", sample: "Nuvo plays your music. Everything stays on this computer.", russian: LONG_RU },
  { id: "label", spec: "13 / 18 · 500", sample: "Shuffle · Add to playlist", russian: LONG_RU },
  { id: "caption", spec: "12 / 16 · 500 · 0.01em", sample: "Playlist · 48 tracks", russian: LONG_RU },
  { id: "numeral", spec: "12 / 16 · 500 · tabular", sample: "3:42 · 12:07 · 1 204 tracks", russian: "0:59 · 1:00:00 · 48 треков" },
];

export const COLOUR_ROLES = [
  { id: "field", role: "The page surface" },
  { id: "deep", role: "Under the field" },
  { id: "raised", role: "Popovers, sheets, menus" },
  { id: "ink", role: "Primary text and icons" },
  { id: "ink-2", role: "Secondary text" },
  { id: "ink-3", role: "Tertiary text, placeholders" },
  { id: "hair", role: "Hairlines" },
  { id: "tint", role: "Row hover, chip rest" },
  { id: "accent", role: "Focus, progress, selection" },
] as const;

export type ColourRole = (typeof COLOUR_ROLES)[number]["id"];
export type RootTokens = Record<ColourRole, string>;

function coverArt(from: string, to: string): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300" viewBox="0 0 300 300">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs>` +
    `<rect width="300" height="300" fill="url(#g)"/>` +
    `<circle cx="110" cy="120" r="70" fill="#ffffff" fill-opacity="0.22"/>` +
    `<circle cx="200" cy="190" r="46" fill="#000000" fill-opacity="0.18"/>` +
    `</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export const COVERS = [
  { id: "red", name: "Red", url: coverArt("#E0302F", "#FF9E5C") },
  { id: "blue", name: "Blue", url: coverArt("#1E88E5", "#7FD1FF") },
  { id: "green", name: "Green", url: coverArt("#2E9E6B", "#B7F0CF") },
  { id: "violet", name: "Violet", url: coverArt("#7A4DFF", "#C9B8FF") },
  { id: "grey", name: "Grey", url: coverArt("#8A8A8E", "#D2D2D7") },
  { id: "yellow", name: "Yellow", url: coverArt("#F2B705", "#FF7A45") },
] as const;

/** Undecodable on purpose: the cover keeps its tint box. */
export const BROKEN_COVER = "data:image/png;base64,AAAA";

function readTokens(): RootTokens {
  const style = getComputedStyle(document.documentElement);
  return Object.fromEntries(COLOUR_ROLES.map(({ id }) => [id, style.getPropertyValue(`--n-${id}`).trim()])) as RootTokens;
}

// Presets write the roles inline on the root after this screen's effects, so root attributes are watched
export function useRootTokens(): RootTokens {
  const [tokens, setTokens] = useState(readTokens);
  useEffect(() => {
    const update = () => {
      const next = readTokens();
      setTokens((current) => (JSON.stringify(current) === JSON.stringify(next) ? current : next));
    };
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["style", "data-theme", "data-preset"] });
    return () => observer.disconnect();
  }, []);
  return tokens;
}

export function ratio(foreground: string, background: string): number | null {
  try {
    return contrastRatio(foreground, background);
  } catch {
    return null;
  }
}

export function formatColour(value: string): string {
  const rgba = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(value);
  if (!rgba) return value.toUpperCase();
  const hex = `#${[rgba[1], rgba[2], rgba[3]].map((part) => Number(part).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
  return rgba[4] === undefined || Number(rgba[4]) === 1 ? hex : `${hex} ${Math.round(Number(rgba[4]) * 100)}%`;
}

const REDUCED_QUERY = "(prefers-reduced-motion: reduce)";

function subscribeReduced(onChange: () => void): () => void {
  const query = window.matchMedia(REDUCED_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribeReduced, () => window.matchMedia(REDUCED_QUERY).matches);
}
