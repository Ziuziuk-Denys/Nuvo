import type { MoodPoint } from "../../../ports/homeMoments";
import type { Place } from "./mood";

const LIT = 9;
const BIGGEST = 50;
const SMALLEST = 26;
const CLEAR_OF_LAMP = 30;
const GAP = 5;
const RELAX_STEPS = 24;
const GLIDE_MS = 110;
const DOT = 2.2;
const POOL = 0.78;
const SHADOW_THROW = 0.09;
const EDGE = 8;

interface Item {
  x: number;
  y: number;
  size: number;
  tone: [number, number, number] | null;
  image: HTMLImageElement | null;
}

export interface MoodField {
  resize(side: number, ratio: number): void;
  points(points: readonly MoodPoint[], coverUrl: (cover: string) => string): void;
  aim(at: Place, picked: readonly number[]): void;
  draw(now: number, look: { dark: boolean; ink: string; still: boolean }): boolean;
}

const tones = new Map<string, [number, number, number]>();

function toneOf(image: HTMLImageElement): [number, number, number] {
  const known = tones.get(image.src);
  if (known) return known;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const context = canvas.getContext("2d")!;
  context.drawImage(image, 0, 0, 1, 1);
  const [red, green, blue] = context.getImageData(0, 0, 1, 1).data;
  const lift = 190 / Math.max(60, red, green, blue);
  const tone: [number, number, number] = [red * lift, green * lift, blue * lift];
  tones.set(image.src, tone);
  return tone;
}

function vivid(tone: readonly number[]): number {
  return (Math.max(...tone) - Math.min(...tone)) / Math.max(...tone);
}

export function createMoodField(canvas: HTMLCanvasElement, changed: () => void): MoodField {
  const context = canvas.getContext("2d")!;
  let side = 0;
  let ratio = 1;
  let shown: readonly MoodPoint[] = [];
  let items: Item[] = [];
  let url = (cover: string) => cover;
  let aim: Place = { x: 0.5, y: 0.5 };
  let lit: number[] = [];
  let tone: [number, number, number] = [150, 150, 160];
  let last = 0;

  const home = (point: MoodPoint) => ({ x: point.energy * side, y: (1 - point.brightness) * side });

  const load = (item: Item, cover: string) => {
    if (item.image || !cover) return;
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.src = url(cover);
    item.image = image;
    void image.decode().then(
      () => {
        item.tone = toneOf(image);
        changed();
      },
      () => undefined,
    );
  };

  const targets = () => {
    const lamp = { x: aim.x * side, y: (1 - aim.y) * side };
    const spots = lit.map((index, rank) => ({ index, size: BIGGEST - ((BIGGEST - SMALLEST) * rank) / Math.max(1, LIT - 1), ...home(shown[index]) }));
    for (let step = 0; step < RELAX_STEPS; step += 1) {
      for (const [a, one] of spots.entries()) {
        for (const two of spots.slice(a + 1)) {
          const apart = (one.size + two.size) / 2 + GAP;
          const dx = two.x - one.x;
          const dy = two.y - one.y;
          const overlap = Math.min(apart - Math.abs(dx), apart - Math.abs(dy));
          if (overlap <= 0) continue;
          const flat = Math.abs(dx) > Math.abs(dy);
          const push = overlap / 2;
          const sign = flat ? Math.sign(dx) || 1 : Math.sign(dy) || 1;
          if (flat) {
            one.x -= push * sign;
            two.x += push * sign;
          } else {
            one.y -= push * sign;
            two.y += push * sign;
          }
        }
        const dx = one.x - lamp.x;
        const dy = one.y - lamp.y;
        const distance = Math.hypot(dx, dy) || 1;
        const clear = CLEAR_OF_LAMP + one.size / 2;
        if (distance < clear) {
          one.x = lamp.x + ((dx || 1) / distance) * clear;
          one.y = lamp.y + (dy / distance) * clear;
        }
        const half = one.size / 2 + EDGE;
        one.x = Math.max(half, Math.min(side - half, one.x));
        one.y = Math.max(half, Math.min(side - half, one.y));
      }
    }
    return new Map(spots.map((spot) => [spot.index, spot]));
  };

  const pool = (dark: boolean) => {
    const x = aim.x * side;
    const y = (1 - aim.y) * side;
    const reach = side * POOL;
    const gradient = context.createRadialGradient(x, y, 0, x, y, reach);
    const [red, green, blue] = tone.map(Math.round);
    const peak = dark ? 0.82 : 0.6;
    for (let stop = 0; stop <= 16; stop += 1) {
      const r = stop / 16;
      const window = (1 - r * r) ** 2;
      gradient.addColorStop(r, `rgba(${red}, ${green}, ${blue}, ${((peak * window) / (1 + 11 * r * r)).toFixed(4)})`);
    }
    context.fillStyle = gradient;
    context.fillRect(0, 0, side, side);
  };

  const cover = (item: Item, dark: boolean) => {
    const lampX = aim.x * side;
    const lampY = (1 - aim.y) * side;
    const dx = item.x - lampX;
    const dy = item.y - lampY;
    const fall = 1 / (1 + (Math.hypot(dx, dy) / (side * 0.34)) ** 2);
    const corner = Math.max(3, item.size * 0.12);
    const box = () => {
      context.beginPath();
      context.roundRect(item.x - item.size / 2, item.y - item.size / 2, item.size, item.size, corner);
    };
    context.save();
    context.shadowColor = dark ? "rgba(0, 0, 0, 0.7)" : "rgba(20, 22, 32, 0.34)";
    context.shadowBlur = 12 * ratio;
    context.shadowOffsetX = dx * SHADOW_THROW * ratio;
    context.shadowOffsetY = (dy * SHADOW_THROW + 2) * ratio;
    context.fillStyle = "#141416";
    box();
    context.fill();
    context.restore();
    context.save();
    box();
    context.clip();
    context.drawImage(item.image!, item.x - item.size / 2, item.y - item.size / 2, item.size, item.size);
    context.fillStyle = `rgba(0, 0, 0, ${((1 - fall) * (dark ? 0.62 : 0.2)).toFixed(3)})`;
    context.fillRect(item.x - item.size / 2, item.y - item.size / 2, item.size, item.size);
    context.restore();
  };

  return {
    resize(nextSide, nextRatio) {
      side = nextSide;
      ratio = nextRatio;
      canvas.width = canvas.height = Math.round(side * ratio);
      for (const [index, item] of items.entries()) Object.assign(item, home(shown[index]));
    },
    points(points, coverUrl) {
      url = coverUrl;
      shown = points;
      items = points.map((point) => ({ ...home(point), size: 0, tone: null, image: null }));
    },
    aim(at, picked) {
      aim = at;
      lit = picked.slice(0, LIT);
      for (const index of lit) load(items[index], shown[index].track.coverUrl);
    },
    draw(now, { dark, ink, still }) {
      const ease = still || last === 0 ? 1 : 1 - Math.exp(-Math.min(50, now - last) / GLIDE_MS);
      last = now;
      const wanted = targets();
      let moving = false;
      const mixed = lit.flatMap((index, rank) => {
        const found = items[index].tone;
        return found ? [{ found, weight: (1 + 3 * vivid(found)) / (1 + rank) }] : [];
      });
      const whole = mixed.reduce((sum, { weight }) => sum + weight, 0);
      if (whole > 0) {
        for (const channel of [0, 1, 2] as const) {
          const goal = mixed.reduce((sum, { found, weight }) => sum + found[channel] * weight, 0) / whole;
          if (Math.abs(goal - tone[channel]) > 0.6) moving = true;
          tone[channel] += (goal - tone[channel]) * ease;
        }
      }
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, side, side);
      pool(dark);
      context.fillStyle = ink;
      for (const [index, item] of items.entries()) {
        const spot = wanted.get(index);
        const ready = item.tone !== null;
        const goal = spot && ready ? spot : { ...home(shown[index]), size: 0 };
        if (Math.abs(goal.x - item.x) + Math.abs(goal.y - item.y) + Math.abs(goal.size - item.size) > 0.2) moving = true;
        item.x += (goal.x - item.x) * ease;
        item.y += (goal.y - item.y) * ease;
        item.size += (goal.size - item.size) * ease;
        if (item.size > 6) continue;
        const away = Math.hypot(shown[index].energy - aim.x, shown[index].brightness - aim.y);
        context.globalAlpha = (0.2 + 0.6 * Math.exp(-away * away * 12)) * (shown[index].fresh ? 0.6 : 1);
        context.beginPath();
        context.arc(item.x, item.y, shown[index].fresh ? DOT * 0.75 : DOT, 0, Math.PI * 2);
        context.fill();
      }
      context.globalAlpha = 1;
      const raised = items.filter((item) => item.size > 6).sort((left, right) => left.size - right.size);
      for (const item of raised) cover(item, dark);
      return moving;
    },
  };
}
