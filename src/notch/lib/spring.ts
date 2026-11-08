export interface Spring {
  stiffness: number;
  damping: number;
  mass: number;
}

// openNook's morph spring: 0.30 s with a slight overshoot.
export const MORPH_SPRING: Spring = { stiffness: 439, damping: 27, mass: 1 };

const STEP_S = 1 / 600;
const REST_DISPLACEMENT = 0.001;
const REST_VELOCITY = 0.01;
const MAX_DURATION_S = 2;

/** Step response of a damped spring from 0 to 1, sampled until it rests. */
export function simulateSpring(spring: Spring): { values: number[]; durationMs: number } {
  const values = [0];
  let position = 0;
  let velocity = 0;
  let time = 0;
  while (time < MAX_DURATION_S) {
    const force = -spring.stiffness * (position - 1) - spring.damping * velocity;
    velocity += (force / spring.mass) * STEP_S;
    position += velocity * STEP_S;
    time += STEP_S;
    values.push(position);
    if (Math.abs(position - 1) < REST_DISPLACEMENT && Math.abs(velocity) < REST_VELOCITY) break;
  }
  return { values, durationMs: Math.round(time * 1000) };
}

/** CSS `linear()` easing that reproduces the spring, plus the duration to pair it with. */
export function springEasing(spring: Spring, points = 32): { easing: string; durationMs: number } {
  const { values, durationMs } = simulateSpring(spring);
  const stops: string[] = [];
  for (let i = 0; i <= points; i++) {
    const value = i === points ? 1 : values[Math.round((i / points) * (values.length - 1))];
    stops.push(String(Math.round(value * 1000) / 1000));
  }
  return { easing: `linear(${stops.join(", ")})`, durationMs };
}
