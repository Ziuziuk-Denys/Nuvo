import type { CoverLight } from "./readLight";
import { GRID } from "./shader";

export type LightScene = "room" | "page" | "wall" | "calm" | "karaoke";

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface View {
  width: number;
  height: number;
}

export const AT = {
  key: [0, 3],
  rim: [3, 3],
  lamp: [6, 3],
  aim: [9, 3],
  beam: [12, 2],
  spillCone: [14, 2],
  power: [16, 1],
  spill: [17, 1],
  emit: [18, 1],
  screenLift: [19, 1],
  screen: [20, 4],
  lean: [24, 1],
  cells: [25, GRID * GRID * 3],
} as const;

export type LightState = Float32Array;
const LENGTH = AT.cells[0] + AT.cells[1];

type Values = Record<keyof typeof AT, readonly number[]>;

function pack(values: Values): LightState {
  const state = new Float32Array(LENGTH);
  for (const name of Object.keys(AT) as (keyof typeof AT)[]) state.set(values[name], AT[name][0]);
  return state;
}

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

function exposure({ cells }: CoverLight): number {
  let sum = 0;
  for (let i = 0; i < cells.length; i += 3) sum += 0.2126 * cells[i] + 0.7152 * cells[i + 1] + 0.0722 * cells[i + 2];
  return clamp(0.06 / (sum / (cells.length / 3)), 0.12, 2.2);
}

export function lightState(scene: LightScene, view: View, light: CoverLight, hero: Box | null, awake = true): LightState {
  const grow = clamp(view.height / 900, 0.85, 1.6);
  const [side, rise] = light.from;
  const x = hero ? hero.x + hero.width / 2 : view.width * (scene === "page" ? 0.22 : 0.5);
  const y = hero ? hero.y + hero.height / 2 : 260 * grow;
  const common = {
    key: light.key,
    rim: light.rim,
    cells: light.cells,
    emit: [0],
    screen: [x, y, 1, 1],
    screenLift: [1],
    lean: [0],
    spill: [0.34],
    beam: [0.9, 0.82],
    spillCone: [0.95, 0.2],
  };
  if (scene === "room") {
    return pack({ ...common, lamp: [x + side * Math.min(300, view.width * 0.2), (rise * 20 - 110) * grow, 330 * grow], aim: [x + side * 40, y - 30, 0], power: [0.34] });
  }
  if (scene === "page") {
    return pack({ ...common, lamp: [x + (100 + side * 150) * grow, (rise * 20 - 110) * grow, 310 * grow], aim: [x + 120 * grow, y, 0], power: [0.3] });
  }
  if (scene === "karaoke") {
    const box = hero ?? { x: view.width * 0.1, y: view.height * 0.16, width: 400, height: 400 };
    return pack({
      ...common,
      lamp: [x + side * 120 * grow, box.y - 260 * grow, 340 * grow],
      aim: [x, y - 60 * grow, 0],
      beam: [0.93, 0.86],
      spillCone: [0.95, 0.3],
      power: [awake ? 0.17 : 0],
      emit: [(awake ? 0.3 : 0.56) * exposure(light)],
      screen: [x, y, box.width / 2, box.height / 2],
      screenLift: [300 * grow],
      lean: [0.06 - rise * 0.12],
    });
  }
  const power = scene === "calm" ? 0.07 : 0.15;
  return pack({
    ...common,
    lamp: [view.width * (0.5 + side * 0.22), -170 * grow, 430 * grow],
    aim: [view.width * (0.5 + side * 0.1), 150 * grow, 0],
    beam: [0.86, 0.62],
    spillCone: [0.9, 0.1],
    power: [power],
  });
}

export const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (2 - 2 * t) ** 3 / 2);

export function between(from: LightState, to: LightState, t: number, out: LightState): LightState {
  const e = ease(clamp(t, 0, 1));
  for (let i = 0; i < out.length; i += 1) out[i] = from[i] + (to[i] - from[i]) * e;
  // the lamp swings over the top and dims on the way, like a lamp being turned
  const arc = Math.sin(Math.PI * e);
  out[AT.power[0]] *= 1 - 0.4 * arc * turned(from, to);
  out[AT.lamp[0] + 1] -= 50 * arc * turned(from, to);
  return out;
}

function turned(from: LightState, to: LightState): number {
  let change = 0;
  for (let i = 0; i < 3; i += 1) change += Math.abs(from[i] - to[i]);
  return Math.min(1, change * 4);
}

export function turnsColour(from: LightState, to: LightState): boolean {
  return turned(from, to) > 0;
}
