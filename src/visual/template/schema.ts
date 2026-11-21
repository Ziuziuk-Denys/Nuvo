import type { TextLook } from "./text";

export type FeatureName = "bass" | "mid" | "high" | "level" | "flux" | "onset" | "beat";

export interface Binding {
  feature: FeatureName;
  amount: number;
  curve?: "linear" | "square" | "gate";
}

export interface BoundParam {
  base: number;
  bind?: Binding[];
}

export type ParamValue = number | BoundParam;

export interface Layer {
  shader: string;
  params: Record<string, ParamValue>;
  blend?: "normal" | "add" | "screen" | "multiply";
}

export type Aspect = "wide" | "tall" | "square";

export interface Frame {
  focus: [number, number];
  scale: number;
  lyricBox: [number, number, number, number];
}

export interface Voice {
  family: "ui" | "condensed" | "serif" | "neutral" | "rounded" | "script";
  weight: number;
  italic: boolean;
  upper: boolean;
}

export interface LyricStyle {
  mode: "stack" | "line" | "single";
  voices: [Voice] | [Voice, Voice];
  size: number;
  leading: number;
  align: "justify" | "centre" | "left";
  motion: "cut" | "rise" | "settle";
}

export interface Template {
  id: string;
  name: string;
  family: "type" | "cover" | "signal";
  background: Layer;
  layers: Layer[];
  grain: number;
  mono?: number;
  impact?: number;
  colors?: { a: [number, number, number]; b: [number, number, number] };
  lyrics: { animation: string; style?: LyricStyle; scale?: number } | null;
  text?: TextLook;
  layouts: Record<Aspect, Frame>;
  liveSafe: boolean;
}

export interface ShaderParam {
  min: number;
  max: number;
  value: number;
}

export interface ShaderSpec {
  params: Record<string, ShaderParam>;
}

function baseOf(value: ParamValue): number {
  return typeof value === "number" ? value : value.base;
}

export function validateTemplate(template: Template, shaders: Record<string, ShaderSpec>): string[] {
  const errors: string[] = [];
  for (const layer of [template.background, ...template.layers]) {
    const spec = shaders[layer.shader];
    if (!spec) {
      errors.push(`${template.id}: unknown shader ${layer.shader}`);
      continue;
    }
    for (const [name, value] of Object.entries(layer.params)) {
      const param = spec.params[name];
      if (!param) {
        errors.push(`${template.id}: ${layer.shader} has no parameter ${name}`);
        continue;
      }
      const base = baseOf(value);
      if (base < param.min || base > param.max) errors.push(`${template.id}: ${layer.shader}.${name} ${base} is outside ${param.min}..${param.max}`);
    }
  }
  return errors;
}
