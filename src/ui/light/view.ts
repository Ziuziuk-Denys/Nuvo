import { lightObjects, watchLightObjects, type LightObject, type Room } from "./objects";
import { onRendererRestored, sharedRenderer, type Frame } from "./renderer";
import { AT, between, lightState, turnsColour, type Box, type LightScene, type LightState } from "./scene";
import type { CoverLight, Vec3 } from "./readLight";

export interface Wanted {
  scene: LightScene;
  light: CoverLight;
  base: Vec3;
  dark: boolean;
  awake: boolean;
  reduced: boolean;
  rich: boolean;
  fps: number;
}

export interface LightView {
  want(next: Wanted): void;
  level(value: number): void;
  hold(held: boolean): void;
  dispose(): void;
}

const TURN_MS = 500;
const MOVE_MS = 420;
const REST_MS = 900;
const CALM_MS = 240;
const SWAY_PX = 34;
const SWAY_EASE = 0.12;
const BREATH = 0.06;
const CAP_DARK = 0.105;
const SLOW_SCALE = 0.3;
const PLAIN_SCALE = 0.6;

export function createLightView(canvas: HTMLCanvasElement, room: Room): LightView | null {
  const renderer = sharedRenderer();
  const target = canvas.getContext("bitmaprenderer");
  if (!renderer || !target) return null;
  let wanted: Wanted | null = null;
  let from: LightState | null = null;
  let to: LightState | null = null;
  let shown: LightState | null = null;
  let startedAt = 0;
  let duration = 0;
  let frame = 0;
  let drawnAt = -Infinity;
  let held = false;
  let sway = 0;
  let swayTo = 0;
  let loudness = 0;

  const objectsIn = (): LightObject[] => {
    const origin = canvas.getBoundingClientRect();
    return lightObjects(room).map((object) => ({ ...object, x: object.x - origin.x, y: object.y - origin.y }));
  };
  const schedule = () => {
    if (!frame && !held) frame = requestAnimationFrame(draw);
  };

  function aimAt(objects: LightObject[], now: number, ms: number): void {
    if (!wanted) return;
    const hero: Box | null = objects.find((object) => object.hero) ?? null;
    const next = lightState(wanted.scene, { width: canvas.clientWidth, height: canvas.clientHeight }, wanted.light, hero, wanted.awake);
    if (to && next.every((value, i) => Math.abs(value - to![i]) < 1e-4)) return;
    const turning = shown !== null && turnsColour(shown, next);
    from = shown ? shown.slice() : null;
    to = next;
    startedAt = now;
    duration = !from || renderer!.slow ? 0 : wanted.reduced ? (turning ? CALM_MS : 0) : turning ? TURN_MS : ms;
  }

  function draw(now: number): void {
    frame = 0;
    if (!wanted || held) return;
    const animating = now < startedAt + duration;
    const swaying = Math.abs(swayTo - sway) > 0.002;
    if (!animating && !swaying && loudness > 0 && now - drawnAt < 1000 / wanted.fps - 2) return schedule();
    const objects = objectsIn();
    aimAt(objects, now, MOVE_MS);
    if (!to) return;
    const moving = from !== null && now < startedAt + duration;
    shown = moving ? between(from!, to, (now - startedAt) / duration, shown ?? to.slice()) : to.slice();
    sway = swaying ? sway + (swayTo - sway) * SWAY_EASE : swayTo;
    const state = shown.slice();
    state[AT.lamp[0]] += sway * SWAY_PX;
    if (loudness > 0) {
      state[AT.power[0]] *= 1 + loudness * BREATH;
      state[AT.emit[0]] *= 1 + loudness * BREATH;
    }
    paint(state, objects);
    drawnAt = now;
    if (moving || Math.abs(swayTo - sway) > 0.002) schedule();
  }

  function paint(state: LightState, objects: LightObject[]): void {
    const view = { width: canvas.clientWidth, height: canvas.clientHeight };
    const { base, dark, rich, scene } = wanted!;
    const full = Math.min(2, devicePixelRatio);
    const scale = renderer!.slow ? SLOW_SCALE : rich ? full : Math.min(1, full) * PLAIN_SCALE;
    const whole = scene === "karaoke";
    const input: Frame = {
      state,
      view,
      scale,
      base,
      dark,
      cap: CAP_DARK,
      foot: whole ? [view.height * 2, view.height * 3] : [view.height * 0.55, view.height],
      objects,
    };
    const bitmap = renderer!.draw(input);
    if (!bitmap) return;
    if (canvas.width !== bitmap.width) canvas.width = bitmap.width;
    if (canvas.height !== bitmap.height) canvas.height = bitmap.height;
    target!.transferFromImageBitmap(bitmap);
  }

  const onPointer = (event: PointerEvent) => {
    if (!wanted?.rich || wanted.reduced || (wanted.scene !== "room" && wanted.scene !== "page")) return;
    swayTo = (event.clientX / window.innerWidth) * 2 - 1;
    schedule();
  };
  const onEnd = () => {
    if (lightObjects(room).length > 0) schedule();
  };
  const observer = new ResizeObserver(() => {
    from = null;
    shown = null;
    to = null;
    schedule();
  });
  observer.observe(canvas);
  window.addEventListener("pointermove", onPointer, { passive: true });
  // an entrance lifts the page, so its objects settle only when the animation ends
  document.addEventListener("animationend", onEnd, true);
  const unwatch = watchLightObjects(room, schedule);
  const unrestore = onRendererRestored(schedule);

  return {
    want(next) {
      const rested = wanted !== null && wanted.awake !== next.awake;
      wanted = next;
      if (!next.rich || next.reduced) swayTo = 0;
      if (rested && shown) aimAt(objectsIn(), performance.now(), REST_MS);
      schedule();
    },
    level(value) {
      loudness = value;
      schedule();
    },
    hold(next) {
      held = next;
      if (!held) schedule();
    },
    dispose() {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("pointermove", onPointer);
      document.removeEventListener("animationend", onEnd, true);
      unwatch();
      unrestore();
    },
  };
}
