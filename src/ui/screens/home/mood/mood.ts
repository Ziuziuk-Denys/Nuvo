import type { MoodPoint } from "../../../ports/homeMoments";
import type { Track } from "../../../ports/recs";
import { firstArtist } from "../../../recs/notInterestedItems";

export interface Place {
  x: number;
  y: number;
}

export const MIX_SIZE = 25;
const REACH = 0.17;
const PER_ARTIST = 3;
const REPEAT_ARTIST = 0.6;
const TASTE_SHARE = 0.3;
const FRESH_SHARE = 0.9;

export function tasteRanks(points: readonly MoodPoint[]): number[] {
  const order = points.map((_, index) => index).sort((left, right) => points[left].taste - points[right].taste);
  const ranks: number[] = Array.from({ length: points.length }, () => 0);
  order.forEach((index, place) => {
    ranks[index] = points.length > 1 ? place / (points.length - 1) : 1;
  });
  return ranks;
}

export function pickMix(points: readonly MoodPoint[], ranks: readonly number[], at: Place, size = MIX_SIZE): number[] {
  const scored = points.map((point, index) => {
    const distance = Math.hypot(point.energy - at.x, point.brightness - at.y);
    const near = Math.exp(-(distance * distance) / (2 * REACH * REACH));
    const score = near * (1 - TASTE_SHARE + TASTE_SHARE * ranks[index]) * (point.fresh ? FRESH_SHARE : 1);
    return { index, artist: firstArtist(point.track).toLocaleLowerCase(), score };
  });
  const used = new Map<string, number>();
  const picked: number[] = [];
  while (picked.length < size && scored.length > 0) {
    let best = 0;
    for (let index = 1; index < scored.length; index += 1) if (scored[index].score > scored[best].score) best = index;
    if (scored[best].score === 0) break;
    const [{ index, artist }] = scored.splice(best, 1);
    picked.push(index);
    const count = (used.get(artist) ?? 0) + 1;
    used.set(artist, count);
    for (const other of scored) if (artist && other.artist === artist) other.score *= count < PER_ARTIST ? REPEAT_ARTIST : 0;
  }
  return picked;
}

const third = (value: number) => (value < 1 / 3 ? "low" : value < 2 / 3 ? "mid" : "high");

export function moodName({ x, y }: Place): string {
  return `ui.home.mood.name.${third(x)}_${third(y)}`;
}

export function startPlace(points: readonly MoodPoint[]): Place {
  const liked = [...points].sort((left, right) => right.taste - left.taste).slice(0, 5);
  const mean = (pick: (point: MoodPoint) => number) => liked.reduce((sum, point) => sum + pick(point), 0) / liked.length;
  return { x: mean((point) => point.energy), y: mean((point) => point.brightness) };
}

export function moodTracks(points: readonly MoodPoint[], picked: readonly number[]): Track[] {
  return picked.map((index) => points[index].track);
}

// A row keeps its song while the song stays near the top, so a moving light swaps rows instead of shuffling them
export function steady(before: readonly number[], picked: readonly number[], rows: number): number[] {
  const top = picked.slice(0, rows * 2);
  const left = top.filter((index) => !before.includes(index));
  return Array.from({ length: Math.min(rows, picked.length) }, (_, row) => (top.includes(before[row]) ? before[row] : left.shift()!));
}
