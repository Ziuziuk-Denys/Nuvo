export const SKY = `#version 300 es
precision highp float;
in vec2 uv;
out vec4 color;
uniform sampler2D current;
uniform sampler2D previous;
uniform float blend;
uniform float time;
uniform vec2 aspect;
uniform float dark;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}

float fbm(vec2 p) {
  float sum = 0.0;
  float weight = 0.5;
  for (int i = 0; i < 4; i++) {
    sum += weight * noise(p);
    p = p * 2.03 + vec2(1.7, 9.2);
    weight *= 0.5;
  }
  return sum;
}

vec3 cover(vec2 p) {
  vec3 c = mix(texture(previous, p).rgb, texture(current, p).rgb, blend);
  c = clamp(mix(vec3(dot(c, vec3(0.299, 0.587, 0.114))), c, 1.25), 0.0, 1.0);
  c /= max(max(c.r, max(c.g, c.b)), 0.3);
  return dark > 0.5 ? c * 0.95 : mix(c, vec3(1.0), 0.08);
}

float ribbon(vec2 p, float t, float seed, float base, float tilt, out float d, out vec2 warp) {
  warp = vec2(fbm(p * 0.8 + vec2(t, seed)), fbm(p * 0.8 + vec2(seed, -t)));
  vec2 q = p + (warp - 0.5) * 0.55;
  float path = base + tilt * q.x + 0.18 * sin(q.x * 1.5 + seed + t * 2.0) + 0.08 * sin(q.x * 3.6 - t * 1.4 + seed * 2.0);
  d = q.y - path;
  float body = d > 0.0 ? exp(-d * mix(7.0, 5.0, dark)) : exp(-d * d * mix(380.0, 520.0, dark));
  float rays = 0.45 + 0.55 * fbm(vec2(q.x * 17.0 + warp.x * 5.0, seed + t * 0.6));
  float along = smoothstep(0.22, 0.68, fbm(vec2(q.x * 1.05 - t * 1.3, seed * 3.1)));
  return body * mix(1.0, rays, smoothstep(0.0, 0.06, d)) * along;
}

void main() {
  vec2 p = vec2((uv.x - 0.5) * aspect.x / aspect.y, uv.y);
  float t = time * 0.06;
  vec3 sky = vec3(0.0);
  float glow = 0.0;
  float d;
  vec2 warp;

  float r1 = ribbon(p, t, 0.0, 0.64, 0.16, d, warp);
  sky += cover(vec2(0.15 + 0.7 * uv.x + (warp.x - 0.5) * 0.3, mix(0.2, 0.8, smoothstep(-0.02, 0.25, d)))) * r1;
  glow += r1;
  float r2 = ribbon(p, t * 0.8, 4.1, 0.78, -0.2, d, warp) * 0.75;
  sky += cover(vec2(0.85 - 0.7 * uv.x + (warp.y - 0.5) * 0.3, mix(0.3, 0.9, smoothstep(0.0, 0.2, d)))) * r2;
  glow += r2;
  float r3 = ribbon(p, t * 1.2, 9.7, 0.5, 0.06, d, warp) * 0.45;
  sky += cover(vec2(0.5 + 0.4 * (uv.x - 0.5) + (warp.x - 0.5) * 0.4, 0.5)) * r3;
  glow += r3;

  float pool = exp(-length((p - vec2(0.0, 0.27)) * vec2(1.0, 1.8)) * 3.2) * 0.55;
  sky += cover(vec2(0.5)) * pool;
  glow += pool;

  vec3 tone = cover(vec2(0.5 + (fbm(p * 1.3) - 0.5) * 0.6, 0.5));
  float high = smoothstep(0.42, 0.82, fbm(p * vec2(1.1, 2.6) + vec2(t * 1.2, 1.3))) * smoothstep(0.45, 1.0, uv.y);
  float low = smoothstep(0.4, 0.78, fbm(p * vec2(1.4, 4.0) + vec2(-t * 2.6, 7.7))) * smoothstep(0.55, 0.3, uv.y) * smoothstep(0.02, 0.34, uv.y);
  float cloud = high * 0.7 + low * 0.9;

  vec2 cell = p * 7.0 + vec2(0.0, t * 6.0);
  vec2 id = floor(cell);
  float seed = hash(id);
  float mote = seed > 0.82 ? smoothstep(0.09, 0.0, length(fract(cell) - 0.5 - (vec2(hash(id + 3.0), hash(id + 9.0)) - 0.5) * 0.6)) : 0.0;
  mote *= smoothstep(0.15, 0.5, uv.y) * (0.5 + 0.5 * sin(time * 0.8 + seed * 40.0));
  sky += mix(tone, vec3(1.0), 0.6) * mote * 0.9;
  glow += mote * 0.9;

  float edge = 0.14 + 0.025 * sin(p.x * 2.1 + t * 5.0) + 0.012 * sin(p.x * 5.3 - t * 4.0);
  float fade = smoothstep(edge - 0.12, edge + 0.12, uv.y);
  float light = clamp(glow * mix(1.0, 0.85, dark), 0.0, 1.0) * fade;
  float mist = cloud * fade * mix(0.16, 0.38, dark);
  vec3 tint = dark > 0.5 ? tone : mix(vec3(1.0), tone, 0.15);
  float alpha = clamp(light + mist, 0.0, 1.0);
  vec3 c = mix(tint, sky / max(glow, 1e-3), light / max(light + mist, 1e-3));
  color = vec4(c * alpha, alpha);
}`;
