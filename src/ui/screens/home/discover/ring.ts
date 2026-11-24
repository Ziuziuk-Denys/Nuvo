import type { HomeMix, Track } from "../../../ports/recs";
import { firstArtist } from "../../../recs/notInterestedItems";
import { DISCOVER, homeSongs } from "../homeModel";

export const MIN_TRACKS = 8;
const MAX_TRACKS = 24;
const FAMILIAR_EVERY = 4;

export const PERSPECTIVE = 1000;
const TURN_DEG = 50;
const TILT = 0.4;
const CENTRE_LIFT = 0.12;
const VANISH = 0.2;
const DEEPEST = 780;
const WIDE_FROM = 1400;
const FADE_FROM = 0.72;
const FADE_TO = 0.98;

export interface Ring {
  width: number;
  cover: number;
  radius: number;
  step: number;
  depth: number;
  edge: number;
  centreY: number;
  vanishY: number;
  rise: number;
}

export interface Placement {
  x: number;
  y: number;
  depth: number;
  scale: number;
  turn: number;
  tilt: number;
  shown: number;
}

// Singles often share their album's art under another address, so one artist's songs stand far apart
function apart(tracks: readonly Track[]): Track[] {
  const heard = new Map<string, number>();
  const rounds = tracks.map((track) => {
    const round = heard.get(firstArtist(track)) ?? 0;
    heard.set(firstArtist(track), round + 1);
    return round;
  });
  return tracks
    .map((track, index) => ({ track, round: rounds[index] }))
    .sort((left, right) => left.round - right.round)
    .map(({ track }) => track);
}

export function ringTracks(mixes: readonly HomeMix[]): Track[] {
  const shown = new Set<string>();
  const unseen = (track: Track) => {
    const art = track.coverUrl || track.id;
    return !shown.has(art) && shown.add(art);
  };
  const fresh = apart((mixes.find((mix) => mix.id === DISCOVER)?.tracks ?? []).filter(unseen));
  const rest = homeSongs(
    mixes.filter((mix) => mix.id !== DISCOVER),
    Infinity,
  );
  const known = apart(rest.map((song) => song.track).filter(unseen));
  const tracks: Track[] = [];
  let next = 0;
  for (const track of fresh) {
    if (tracks.length === MAX_TRACKS) break;
    if (tracks.length % FAMILIAR_EVERY === FAMILIAR_EVERY - 1 && next < known.length) tracks.push(known[next++]);
    if (tracks.length < MAX_TRACKS) tracks.push(track);
  }
  while (tracks.length < MIN_TRACKS && next < known.length) tracks.push(known[next++]);
  return tracks;
}

export function ringSlots(count: number): number {
  return count === 0 ? 0 : Math.ceil(MIN_TRACKS / count) * count;
}

export function ringOffset(index: number, position: number, count: number): number {
  const offset = (((index - position) % count) + count) % count;
  return offset > count / 2 ? offset - count : offset;
}

export function floorOf(ring: Pick<Ring, "centreY" | "cover">): number {
  return ring.centreY + ring.cover / 2 + 2;
}

function depthScale(ring: Pick<Ring, "depth">, angle: number): number {
  return PERSPECTIVE / (PERSPECTIVE + ring.depth * (1 - Math.cos(angle)));
}

function coverFor(width: number): number {
  const wide = Math.max(0, width - WIDE_FROM) * 0.08;
  return Math.round(Math.min(236, Math.min(172, Math.max(132, width * 0.15)) + wide));
}

export function ringHeight(width: number): number {
  return 460 + Math.round((coverFor(width) - coverFor(WIDE_FROM)) * 1.1 * Number(width > WIDE_FROM));
}

export function ringFor(width: number, height: number, clearTop: number): Ring {
  const cover = coverFor(width);
  const radius = width * 0.8;
  const depth = Math.min(DEEPEST, radius * 0.7);
  const centreY = height * 0.62;
  const half = cover / 2;
  let edge = 0;
  while (edge < Math.PI / 2) {
    const scale = depthScale({ depth }, edge);
    if (width / 2 + radius * Math.sin(edge) * scale - half * scale >= width) break;
    edge += 0.01;
  }
  const scale = depthScale({ depth }, edge);
  const vanishY = height * VANISH;
  const room = (vanishY + (centreY - vanishY) * scale - half * scale - clearTop) / ((1 - Math.cos(edge)) * scale);
  return { width, cover, radius, step: (cover * 0.95) / radius, depth, edge, centreY, vanishY, rise: Math.max(0, Math.min(height * 2, room)) };
}

export function place(ring: Ring, offset: number): Placement | null {
  const angle = offset * ring.step;
  if (Math.abs(angle) >= Math.min(ring.edge, FADE_TO)) return null;
  const scale = depthScale(ring, angle);
  const x = ring.width / 2 + ring.radius * Math.sin(angle) * scale;
  const lift = CENTRE_LIFT * Math.max(0, 1 - Math.abs(offset));
  return {
    x,
    y: ring.vanishY + (ring.centreY - ring.rise * (1 - Math.cos(angle)) - ring.vanishY) * scale - (ring.cover / 2) * scale * lift,
    depth: scale,
    scale: scale * (1 + lift),
    turn: -angle * TURN_DEG,
    tilt: -Math.atan2(ring.rise * Math.sin(angle), ring.radius * Math.cos(angle)) * TILT,
    shown: Math.min(1, (FADE_TO - Math.abs(angle)) / (FADE_TO - FADE_FROM)),
  };
}
