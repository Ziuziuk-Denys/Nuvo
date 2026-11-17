import type { Features } from "./features";

export const RING_POINTS = 96;
const STEP_S = 1 / 240;
const STIFFNESS = 90;
const DAMPING = 3.2;
const TENSION = 140;
const KICK = 6;
const LIMIT = 1.5;

export interface Ring {
  step(dtMs: number, features: Features): Float32Array;
  reset(): void;
}

function noise(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

function shaped(level: number): number {
  const t = Math.min(1, Math.max(0, (level - 0.42) / 0.53));
  return t * t * (3 - 2 * t);
}

export function createRing(): Ring {
  const x = new Float32Array(RING_POINTS);
  const v = new Float32Array(RING_POINTS);
  const target = new Float32Array(RING_POINTS);
  const next = new Float32Array(RING_POINTS);
  const side = Array.from({ length: RING_POINTS }, (_, i) => 1 - Math.abs((2 * i) / RING_POINTS - 1));
  let elapsed = 0;
  let done = 0;
  let hits = 0;

  function integrate(): void {
    for (let i = 0; i < RING_POINTS; i++) {
      const left = x[(i + RING_POINTS - 1) % RING_POINTS];
      const right = x[(i + 1) % RING_POINTS];
      const accel = STIFFNESS * (target[i] - x[i]) - DAMPING * v[i] + TENSION * (left + right - 2 * x[i]);
      next[i] = v[i] + accel * STEP_S;
    }
    for (let i = 0; i < RING_POINTS; i++) {
      v[i] = next[i];
      x[i] = Math.min(LIMIT, Math.max(-LIMIT, x[i] + v[i] * STEP_S));
    }
  }

  return {
    step(dtMs, features) {
      for (let i = 0; i < RING_POINTS; i++) {
        const s = side[i];
        const band = Math.round((0.03 + s * 0.45) * (features.bands.length - 1));
        const around = (features.bands[band - 1] ?? 0) + features.bands[band] + (features.bands[band + 1] ?? 0);
        target[i] = 0.25 * shaped(around / 3) + 0.35 * features.bass * (0.6 + 0.4 * Math.cos(Math.PI * s));
      }
      if (features.onset === 1) {
        hits++;
        const lobes = 2 + (hits % 3);
        const phase = noise(hits) * 2 * Math.PI;
        for (let i = 0; i < RING_POINTS; i++) {
          const angle = (2 * Math.PI * i) / RING_POINTS;
          const shape = 0.5 + 0.5 * Math.cos(lobes * angle + phase);
          v[i] += KICK * shape * (0.75 + 0.25 * noise(hits * 131 + i)) * (0.6 + 0.4 * features.bass);
        }
      }
      elapsed += dtMs / 1000;
      const due = Math.floor(elapsed / STEP_S + 1e-6);
      while (done < due) {
        integrate();
        done++;
      }
      return x.slice();
    },
    reset() {
      x.fill(0);
      v.fill(0);
      elapsed = 0;
      done = 0;
      hits = 0;
    },
  };
}
