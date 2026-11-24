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
const TASTE_SHARE = 0.3;
const FRESH_SHARE = 0.9;

export function tasteRanks(points: readonly MoodPoint[]): number[] {
  const order = points.map((_, index) => index).sort((left, right) => points[left].taste - points[right].taste);
  const ranks = new Array<number>(points.length);
  order.forEach((index, place) => {
    ranks[index] = points.length > 1 ? place / (points.length - 1) : 1;
  });
  return ranks;
}

export function pickMix(points: readonly MoodPoint[], ranks: readonly number[], at: Place, size = MIX_SIZE): number[] {
  const scored = points
    .map((point, index) => {
      const distance = Math.hypot(point.energy - at.x, point.brightness - at.y);
      const near = Math.exp(-(distance * distance) / (2 * REACH * REACH));
      return { index, score: near * (1 - TASTE_SHARE + TASTE_SHARE * ranks[index]) * (point.fresh ? FRESH_SHARE : 1) };
    })
    .sort((left, right) => right.score - left.score);
  const perArtist = new Map<string, number>();
  const picked: number[] = [];
  for (const { index } of scored) {
    const artist = firstArtist(points[index].track).toLocaleLowerCase();
    const used = perArtist.get(artist) ?? 0;
    if (artist && used >= PER_ARTIST) continue;
    perArtist.set(artist, used + 1);
    picked.push(index);
    if (picked.length === size) break;
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
