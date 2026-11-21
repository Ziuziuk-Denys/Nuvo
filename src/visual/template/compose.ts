import type { Rgb } from "../render/palette";
import type { Aspect, Frame, Layer, LyricStyle, Template } from "./schema";
import type { TextLook } from "./text";

export const WEIGHT_BUDGET = 6;

export type Slot = "background" | "atmosphere" | "centrepiece" | "lyrics";
export type Issue = "busy" | "weather" | "heavy";

export interface Part {
  id: string;
  slot: Slot;
  weight: 1 | 2 | 3;
  zone: "full" | "centre" | "upper" | "lower";
  layers: Layer[];
  group?: string;
  back?: boolean;
  ink?: "light" | "dark";
  drawsText?: boolean;
  animation?: string;
  style?: LyricStyle;
  requires?: string[];
  calm?: string;
  scale?: number;
  mono?: number;
  impact?: number;
  controls?: string[];
}

export interface Selection {
  background: string;
  atmosphere: string[];
  centrepiece: string | null;
  lyrics: string | null;
  params?: Record<string, Record<string, number>>;
  colors?: { a: Rgb; b: Rgb };
  text?: TextLook;
}

function find(parts: Part[], id: string): Part {
  const part = parts.find((candidate) => candidate.id === id);
  if (!part) throw new Error(`unknown part ${id}`);
  return part;
}

export function balance(selection: Selection, parts: Part[]): { fixed: Selection; issues: Issue[] } {
  const issues: Issue[] = [];
  const fixed: Selection = { ...selection, atmosphere: [...selection.atmosphere] };

  const centre = fixed.centrepiece ? find(parts, fixed.centrepiece) : null;
  const lyrics = fixed.lyrics ? find(parts, fixed.lyrics) : null;
  if (centre?.zone === "centre" && lyrics && lyrics.zone !== "lower" && lyrics.calm) {
    issues.push("busy");
    fixed.lyrics = lyrics.calm;
  }

  const groups = new Set<string>();
  const kept: string[] = [];
  for (const id of fixed.atmosphere) {
    const group = find(parts, id).group;
    if (group && groups.has(group)) {
      if (!issues.includes("weather")) issues.push("weather");
      continue;
    }
    if (group) groups.add(group);
    kept.push(id);
  }
  fixed.atmosphere = kept;

  const accepted = fixed.lyrics ? find(parts, fixed.lyrics).requires : undefined;
  if (accepted && !accepted.includes(fixed.background)) fixed.background = accepted[0];

  const total = () =>
    [fixed.background, ...fixed.atmosphere, ...(fixed.centrepiece ? [fixed.centrepiece] : []), ...(fixed.lyrics ? [fixed.lyrics] : [])].reduce(
      (sum, id) => sum + find(parts, id).weight,
      0,
    );
  while (total() > WEIGHT_BUDGET && fixed.atmosphere.length > 0) {
    if (!issues.includes("heavy")) issues.push("heavy");
    fixed.atmosphere.pop();
  }
  return { fixed, issues };
}

function withSettings(part: Part, settings: Record<string, number> | undefined): Layer[] {
  if (!settings) return part.layers;
  return part.layers.map((layer, index) => {
    const params = { ...layer.params };
    for (const [key, value] of Object.entries(settings)) {
      const [shader, name] = key.includes(".") ? key.split(".") : [null, key];
      if (shader ? layer.shader === shader : index === 0) params[name] = value;
    }
    return { ...layer, params };
  });
}

export function compose(id: string, selection: Selection, parts: Part[], layouts: Record<Aspect, Frame>): Template {
  const layersOf = (part: Part) => withSettings(part, selection.params?.[part.id]);
  const background = find(parts, selection.background);
  const atmosphere = selection.atmosphere.map((part) => find(parts, part));
  const centre = selection.centrepiece ? find(parts, selection.centrepiece) : null;
  const lyrics = selection.lyrics ? find(parts, selection.lyrics) : null;
  const text: Layer[] = lyrics && !background.drawsText && !lyrics.drawsText ? [{ shader: "type", params: { tone: background.ink === "dark" ? 0 : 1 } }] : [];
  const [base, ...rest] = layersOf(background);
  const chosen = [background, ...atmosphere, ...(centre ? [centre] : []), ...(lyrics ? [lyrics] : [])];
  return {
    id,
    name: `visual.template.${id}`,
    family: lyrics ? "type" : centre ? "signal" : "cover",
    background: base,
    layers: [
      ...rest,
      ...atmosphere.filter((part) => part.back).flatMap(layersOf),
      ...(centre ? layersOf(centre) : []),
      ...(lyrics ? layersOf(lyrics) : []),
      ...text,
      ...atmosphere.filter((part) => !part.back).flatMap(layersOf),
    ],
    grain: 0.035,
    mono: Math.max(0, ...chosen.map((part) => part.mono ?? 0)),
    impact: Math.max(0, ...chosen.map((part) => part.impact ?? 0)),
    colors: selection.colors,
    text: selection.text,
    lyrics: lyrics?.animation ? { animation: lyrics.animation, style: lyrics.style, scale: lyrics.scale } : null,
    layouts,
    liveSafe: !lyrics || lyrics.weight === 1,
  };
}
