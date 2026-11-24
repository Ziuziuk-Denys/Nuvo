import { useEffect, useLayoutEffect, useRef, useState, type JSX } from "react";
import { useEffectsStore, useReducedEffects, useVisualQuality } from "../effects";
import { parseColor } from "../ports/color";
import { isWindowVisible, onWindowVisibilityChange } from "../ports/window";
import type { Room } from "./objects";
import { cssColour, type CoverLight, type Vec3 } from "./readLight";
import type { LightScene } from "./scene";
import { useBreath } from "./useBreath";
import { createLightView, type LightView } from "./view";
import styles from "./Light.module.css";

interface LightCanvasProps {
  light: CoverLight;
  scene: LightScene;
  dark: boolean;
  base: string;
  room?: Room;
  awake?: boolean;
  breathing?: boolean;
  className?: string;
}

function colour(value: string): Vec3 {
  const { r, g, b } = parseColor(value);
  return [r / 255, g / 255, b / 255];
}

export function LightCanvas({ light, scene, dark, base, room = "page", awake = true, breathing = false, className }: LightCanvasProps): JSX.Element {
  const canvas = useRef<HTMLCanvasElement>(null);
  const view = useRef<LightView | null>(null);
  const [drawn, setDrawn] = useState(true);
  const reduced = useReducedEffects();
  const rich = useVisualQuality() === "visuals";
  const fps = useEffectsStore((state) => state.fps);

  useLayoutEffect(() => {
    const made = createLightView(canvas.current!, room);
    view.current = made;
    setDrawn(made !== null);
    const off = onWindowVisibilityChange((visible) => made?.hold(!visible));
    made?.hold(!isWindowVisible());
    return () => {
      off();
      made?.dispose();
      view.current = null;
    };
  }, [room]);

  useEffect(() => {
    view.current?.want({ scene, light, base: colour(base), dark, awake, reduced, rich, fps });
  }, [scene, light, base, dark, awake, reduced, rich, fps]);

  useBreath(breathing && rich && !reduced, view);

  return (
    <div
      className={className ? `${styles.light} ${className}` : styles.light}
      data-light={scene}
      data-rich={rich ? "" : undefined}
      style={{ backgroundColor: base }}
    >
      <canvas ref={canvas} className={styles.canvas} />
      {drawn ? null : <div className={styles.still} style={{ color: cssColour(light.key) }} />}
    </div>
  );
}
