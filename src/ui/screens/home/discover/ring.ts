import type { HomeMix, Track } from "../../../ports/recs";
import { DISCOVER, homeSongs } from "../homeModel";

export const MIN_TRACKS = 8;
// 11 covers a side reach the widest point of the arc on a 2560 px window
export const FULL_TRACKS = 23;
const MAX_TRACKS = 24;
const FAMILIAR_EVERY = 4;

export const PERSPECTIVE = 1000;
const TURN_DEG = 50;
const TILT = 0.4;
const CENTRE_LIFT = 0.12;
const VANISH = 0.2;

export interface Ring {
  width: number;
  cover: number;
  radius: number;
  step: number;
  depth: number;
  edge: number;
  widest: number;
  centreY: number;
  vanishY: number;
  rise: number;
}

export interface Placement {
  x: number;
  y: number;
  scale: number;
  turn: number;
  tilt: number;
  shown: number;
}

function artOf(track: Track): string[] {
  return [track.album?.id ?? "", track.coverUrl].filter(Boolean);
}

export function ringTracks(mixes: readonly HomeMix[]): Track[] {
  const fresh = mixes.find((mix) => mix.id === DISCOVER)?.tracks ?? [];
  const known = homeSongs(
    mixes.filter((mix) => mix.id !== DISCOVER),
    Infinity,
  )
    .map((song) => song.track)
    .filter((track) => !fresh.some((other) => other.id === track.id));
  const tracks: Track[] = [];
  let next = 0;
  for (const track of fresh) {
    if (tracks.length === MAX_TRACKS) break;
    if (tracks.length % FAMILIAR_EVERY === FAMILIAR_EVERY - 1 && next < known.length) tracks.push(known[next++]);
    if (tracks.length < MAX_TRACKS) tracks.push(track);
  }
  const shown = new Set(tracks.flatMap(artOf));
  for (const track of known.slice(next)) {
    if (tracks.length >= FULL_TRACKS) break;
    const art = artOf(track);
    if (art.some((mark) => shown.has(mark))) continue;
    for (const mark of art) shown.add(mark);
    tracks.push(track);
  }
  return tracks;
}

export function ringSlots(count: number): number {
  return count === 0 ? 0 : Math.ceil(MIN_TRACKS / count) * count;
}

export function ringOffset(index: number, position: number, count: number): number {
  const offset = (((index - position) % count) + count) % count;
  return offset > count / 2 ? offset - count : offset;
}

function depthScale(ring: Pick<Ring, "depth">, angle: number): number {
  return PERSPECTIVE / (PERSPECTIVE + ring.depth * (1 - Math.cos(angle)));
}

export function ringFor(width: number, height: number, clearTop: number): Ring {
  const cover = Math.round(Math.min(172, Math.max(132, width * 0.15)));
  const radius = width * 0.8;
  const depth = radius * 0.7;
  const centreY = height * 0.62;
  const half = cover / 2;
  let edge = 0;
  let reach = 0;
  let widest = Infinity;
  while (edge < Math.PI / 2) {
    const scale = depthScale({ depth }, edge);
    const out = (radius * Math.sin(edge) + half * Math.cos((edge * TURN_DEG * Math.PI) / 180)) * scale;
    if (out < reach) widest = Math.min(widest, edge);
    reach = out;
    if (width / 2 + radius * Math.sin(edge) * scale - half * scale >= width) break;
    edge += 0.01;
  }
  const scale = depthScale({ depth }, edge);
  const vanishY = height * VANISH;
  const room = (vanishY + (centreY - vanishY) * scale - half * scale - clearTop) / ((1 - Math.cos(edge)) * scale);
  return { width, cover, radius, step: (cover * 0.95) / radius, depth, edge, widest, centreY, vanishY, rise: Math.max(0, Math.min(height * 2, room)) };
}

export function place(ring: Ring, offset: number): Placement | null {
  const angle = offset * ring.step;
  const shown = Math.min(1, (ring.widest - Math.abs(angle)) / ring.step);
  if (Math.abs(angle) > ring.edge || shown <= 0) return null;
  const scale = depthScale(ring, angle);
  const x = ring.width / 2 + ring.radius * Math.sin(angle) * scale;
  return {
    x,
    y: ring.vanishY + (ring.centreY - ring.rise * (1 - Math.cos(angle)) - ring.vanishY) * scale,
    scale: scale * (1 + CENTRE_LIFT * Math.max(0, 1 - Math.abs(offset))),
    turn: -angle * TURN_DEG,
    tilt: -Math.atan2(ring.rise * Math.sin(angle), ring.radius * Math.cos(angle)) * TILT,
    shown,
  };
}
