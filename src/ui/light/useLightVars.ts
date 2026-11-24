import { useEffect } from "react";
import { cssColour, type CoverLight } from "./readLight";

function brightest({ cells }: CoverLight): number {
  let most = 0;
  for (let i = 0; i < cells.length; i += 3) most = Math.max(most, 0.2126 * cells[i] + 0.7152 * cells[i + 1] + 0.0722 * cells[i + 2]);
  return most;
}

export function lightVars(light: CoverLight): Record<string, string> {
  return {
    "--n-lamp": cssColour(light.key),
    "--n-lamp-rim": cssColour(light.rim),
    "--n-cover-bright": brightest(light).toFixed(3),
    "--n-light-x": (-light.from[0]).toFixed(3),
    "--n-light-y": (0.7 - light.from[1] * 0.3).toFixed(3),
  };
}

export function useLightVars(light: CoverLight): void {
  useEffect(() => {
    for (const [name, value] of Object.entries(lightVars(light))) document.documentElement.style.setProperty(name, value);
  }, [light]);
}
