import type { MoodPoint } from "../../../ports/homeMoments";
import type { Place } from "./mood";

const LIT = 12;
const BIGGEST = 56;
const SMALLEST = 40;
const CLEAR_OF_LAMP = 22;
const GAP = 6;
const RELAX_STEPS = 70;
const GLIDE_MS = 110;
const CHIP = 7;
const CHIPS = 36;
const CHIP_REACH = 0.42;
const RAISED = 12;
const POOL = 0.78;
const SHADOW_THROW = 0.09;
export const INSET = 38;

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
  hit(x: number, y: number): { index: number; x: number; y: number; size: number } | null;
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
  let chips = new Map<number, number>();
  let tone: [number, number, number] = [150, 150, 160];
  let last = 0;

  const at = (x: number, y: number) => ({ x: INSET + x * (side - 2 * INSET), y: INSET + (1 - y) * (side - 2 * INSET) });
  const home = (point: MoodPoint) => at(point.energy, point.brightness);

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
    const lamp = at(aim.x, aim.y);
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
        const half = one.size / 2 + INSET - 4;
        one.x = Math.max(half, Math.min(side - half, one.x));
        one.y = Math.max(half, Math.min(side - half, one.y));
      }
    }
    const clear = spots.filter((spot, rank) =>
      spots.slice(0, rank).every((other) => Math.max(Math.abs(spot.x - other.x), Math.abs(spot.y - other.y)) >= (spot.size + other.size) / 2),
    );
    return new Map(clear.map((spot) => [spot.index, spot]));
  };

  const pool = (dark: boolean) => {
    const { x, y } = at(aim.x, aim.y);
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
    const lamp = at(aim.x, aim.y);
    const dx = item.x - lamp.x;
    const dy = item.y - lamp.y;
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
    aim(place, picked) {
      aim = place;
      const arts = new Set<string>();
      lit = picked.filter((index) => !arts.has(shown[index].track.coverUrl) && arts.add(shown[index].track.coverUrl)).slice(0, LIT);
      chips = new Map(
        shown
          .map((point, index): [number, number] => [index, Math.hypot(point.energy - place.x, point.brightness - place.y)])
          .filter(([index, away]) => away < CHIP_REACH && !lit.includes(index))
          .sort((left, right) => left[1] - right[1])
          .slice(0, CHIPS),
      );
      for (const index of lit) load(items[index], shown[index].track.coverUrl);
    },
    hit(x, y) {
      let best: { index: number; x: number; y: number; size: number } | null = null;
      for (const [index, { x: itemX, y: itemY, size }] of items.entries()) {
        const reach = Math.max(size, 14) / 2;
        if (size < 2 || Math.abs(x - itemX) > reach || Math.abs(y - itemY) > reach) continue;
        if (!best || size > best.size) best = { index, x: itemX, y: itemY, size };
      }
      return best;
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
        const goal = spot && item.tone ? spot : { ...home(shown[index]), size: chips.has(index) ? CHIP * (shown[index].fresh ? 0.7 : 1) : 0 };
        if (Math.abs(goal.x - item.x) + Math.abs(goal.y - item.y) + Math.abs(goal.size - item.size) > 0.2) moving = true;
        item.x += (goal.x - item.x) * ease;
        item.y += (goal.y - item.y) * ease;
        item.size += (goal.size - item.size) * ease;
        if (item.size > RAISED || item.size < 1) continue;
        const near = 1 - (chips.get(index) ?? CHIP_REACH) / CHIP_REACH;
        context.globalAlpha = 0.08 + 0.34 * Math.max(0, near);
        context.beginPath();
        context.roundRect(item.x - item.size / 2, item.y - item.size / 2, item.size, item.size, 1.5);
        context.fill();
      }
      context.globalAlpha = 1;
      const raised = items.filter((item) => item.size > RAISED).sort((left, right) => left.size - right.size);
      for (const item of raised) cover(item, dark);
      return moving;
    },
  };
}
