import type { Features } from "../signal/features";
import type { Binding, ParamValue } from "./schema";

export const REDUCED_MOTION_SCALE = 0.35;

function shape(value: number, curve: Binding["curve"]): number {
  if (curve === "square") return value * value;
  if (curve === "gate") return value > 0.5 ? 1 : 0;
  return value;
}

export function evaluate(param: ParamValue, features: Features, reduced: boolean): number {
  if (typeof param === "number") return param;
  let sum = 0;
  for (const binding of param.bind ?? []) sum += binding.amount * shape(features[binding.feature], binding.curve);
  return param.base + (reduced ? sum * REDUCED_MOTION_SCALE : sum);
}
