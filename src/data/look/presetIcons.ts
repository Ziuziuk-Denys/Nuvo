import { FENNEC_16, FENNEC_32, FENNEC_48 } from "./fennec";
import type { PresetId, PresetMode } from "./presets";

export const FLAT_SIZES = [16, 32, 48] as const;
export type FlatSize = (typeof FLAT_SIZES)[number];

const RENDERS = import.meta.glob<string>("./presetIcons/*.webp", { query: "?url", import: "default", eager: true });

const MARKS: Record<FlatSize, [path: string, transform: string]> = {
  16: [FENNEC_16, "translate(256 256) scale(1.4646) translate(-128.00 -129.75)"],
  32: [FENNEC_32, "translate(256 256) scale(1.6316) translate(-128.00 -126.75)"],
  48: [FENNEC_48, "translate(256 256) scale(1.6316) translate(-128.00 -126.75)"],
};

type Flat = [tileTop: string, tileBottom: string, mark: string, back: string];

const FLAT: Record<PresetId, Record<PresetMode, Flat>> = {
  nuvo: {
    dark: ["#0f1836", "#38538f", "#eaf1ff", '<circle cx="214" cy="120" r="78" fill="#6f8bd0"/>'],
    light: ["#cfdcf9", "#f2f6ff", "#1a2650", '<circle cx="214" cy="120" r="78" fill="#fff"/>'],
  },
  ink: {
    dark: [
      "#26262a",
      "#0d0d0f",
      "#ffffff",
      '<g fill="none" stroke-linecap="round"><path d="M112 440A222 222 0 1 1 420 410" stroke="#5a5a60" stroke-width="34"/></g>',
    ],
    light: [
      "#fbf9f4",
      "#e9e4d8",
      "#141416",
      '<g fill="none" stroke-linecap="round"><path d="M112 440A222 222 0 1 1 420 410" stroke="#bdb8ac" stroke-width="34"/></g>',
    ],
  },
  frost: {
    dark: ["#062230", "#1b6278", "#effcff", '<path d="M0 150Q130 60 256 140T512 110V200Q390 150 256 220T0 220Z" fill="#3fcfb4" opacity=".75"/>'],
    light: ["#b9e2f2", "#f2fbff", "#0f465c", '<path d="M0 300L110 150L190 250L300 120L400 250L512 160V512H0Z" fill="#8cc8df"/>'],
  },
  moss: {
    dark: ["#0a2a1b", "#2b6b48", "#f1fbef", '<circle cx="392" cy="112" r="56" fill="#cfe6a8"/>'],
    light: ["#d8eee0", "#f1faee", "#175036", '<circle cx="392" cy="112" r="56" fill="#fff0b8"/>'],
  },
  matcha: {
    dark: ["#3a3a2c", "#15150e", "#fffef0", '<circle cx="256" cy="256" r="226" fill="#7d9f2c"/>'],
    light: ["#f3ecd8", "#dccfae", "#2c390a", '<circle cx="256" cy="256" r="226" fill="#b7d45e"/>'],
  },
  amber: {
    dark: ["#4a2f0c", "#1c1006", "#3a1c03", '<circle cx="256" cy="256" r="240" fill="#0d0a08"/><circle cx="256" cy="256" r="206" fill="#f6b53f"/>'],
    light: ["#fff1d2", "#efd49c", "#3a1c03", '<circle cx="256" cy="256" r="240" fill="#1a1512"/><circle cx="256" cy="256" r="206" fill="#f9c45a"/>'],
  },
  dusk: {
    dark: ["#4a1840", "#ff8a50", "#2a0c27", '<circle cx="256" cy="262" r="216" fill="#ffb35c"/>'],
    light: ["#ffc9a8", "#ffe9c8", "#5f1e08", '<circle cx="256" cy="262" r="216" fill="#fff3d0"/>'],
  },
  blossom: {
    dark: ["#3a1029", "#8f3a68", "#fff0f6", '<circle cx="104" cy="100" r="62" fill="#ff8fbd"/>'],
    light: ["#ffd0e1", "#fff3f8", "#6c1643", '<circle cx="104" cy="100" r="62" fill="#ff9dc4"/>'],
  },
  velvet: {
    dark: ["#1c0b3c", "#1c0b3c", "#f6f0ff", '<path d="M0 0H92Q70 260 98 512H0ZM512 0H420Q442 260 414 512H512Z" fill="#6a38c8"/>'],
    light: ["#f1e9ff", "#e2d3fb", "#38187f", '<path d="M0 0H92Q70 260 98 512H0ZM512 0H420Q442 260 414 512H512Z" fill="#a47be6"/>'],
  },
};

export function presetRenderUrl(id: PresetId, mode: PresetMode, size: 128 | 512): string {
  return RENDERS[`./presetIcons/${id}-${mode}-${size}.webp`];
}

// 48 px and below: the scene turns to mush there, so its colours are drawn flat behind the mark
export function presetFlatSvg(id: PresetId, mode: PresetMode, size: FlatSize): string {
  const [top, bottom, ink, back] = FLAT[id][mode];
  const [mark, place] = MARKS[size];
  const edge =
    mode === "light" ? `<rect x="8" y="8" width="496" height="496" rx="105" fill="none" stroke="#000" stroke-opacity="0.16" stroke-width="16"/>` : "";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512"><defs><clipPath id="tile"><rect width="512" height="512" rx="112.64"/></clipPath>` +
    `<linearGradient id="bg" x1="0" y1="0" x2="0" y2="512" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></linearGradient></defs>` +
    `<g clip-path="url(#tile)"><rect width="512" height="512" fill="url(#bg)"/>${back}<path fill="${ink}" fill-rule="evenodd" transform="${place}" d="${mark}"/></g>${edge}</svg>`
  );
}
