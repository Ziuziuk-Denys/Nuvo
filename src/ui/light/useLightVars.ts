import { useEffect } from "react";
import { cssColour, type CoverLight } from "./readLight";

export function lightVars(light: CoverLight): Record<string, string> {
  return {
    "--n-lamp": cssColour(light.key),
    "--n-lamp-rim": cssColour(light.rim),
    "--n-light-x": (-light.from[0]).toFixed(3),
    "--n-light-y": (0.7 - light.from[1] * 0.3).toFixed(3),
  };
}

export function useLightVars(light: CoverLight): void {
  useEffect(() => {
    for (const [name, value] of Object.entries(lightVars(light))) document.documentElement.style.setProperty(name, value);
  }, [light]);
}
