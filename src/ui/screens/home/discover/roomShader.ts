export const VERTEX = `#version 300 es
in vec2 corner;
uniform vec2 view;
uniform vec2 at;
uniform vec4 spin;
uniform float cover;
uniform float scale;
uniform float stand;
uniform float back;
uniform vec2 spread;
uniform vec2 floorLine;
uniform float mirrored;
out vec2 uv;
out float above;
out float depth;
const float P = 1000.0;
void main() {
  vec2 p = corner * cover * 0.5 * spread;
  p = mat2(spin.x, spin.y, -spin.y, spin.x) * p;
  vec3 q = vec3(p.x * spin.z - back * spin.w, p.y, -p.x * spin.w - back * spin.z);
  float w = 1.0 - q.z / P;
  vec2 flat2 = at + q.xy * scale / w;
  float ground = floorLine.x + (floorLine.y - floorLine.x) * stand / w;
  above = (ground - flat2.y) / (cover * scale);
  flat2.y = mix(flat2.y, 2.0 * ground - flat2.y, mirrored);
  uv = corner * 0.5 + 0.5;
  depth = w;
  vec2 clip = vec2(flat2.x / view.x * 2.0 - 1.0, 1.0 - flat2.y / view.y * 2.0);
  gl_Position = vec4(clip * w, 0.0, w);
}`;

export const FRAGMENT = `#version 300 es
precision highp float;
in vec2 uv;
in float above;
in float depth;
uniform sampler2D art;
uniform float ready;
uniform float cover;
uniform float scale;
uniform float ratio;
uniform float blur;
uniform float dim;
uniform float mirrored;
uniform float slab;
uniform float radius;
uniform vec2 lamp;
uniform vec3 sweep;
uniform float mirrorGain;
uniform float bright;
uniform float shown;
uniform float lit;
out vec4 color;

float noise(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }

float edge(vec2 p) {
  vec2 q = abs(p - 0.5) * cover - (cover * 0.5 - radius);
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - radius;
}

vec3 sampleArt(vec2 p, float soft) {
  vec2 size = vec2(textureSize(art, 0));
  float texels = soft * size.x / cover;
  if (texels < 0.6) return texture(art, p).rgb;
  float lod = max(0.0, log2(texels * 0.7));
  vec3 sum = vec3(0.0);
  float turn = noise(gl_FragCoord.xy) * 6.2831853;
  for (int i = 0; i < 12; i++) {
    float r = sqrt((float(i) + 0.5) / 12.0) * soft / cover;
    float a = float(i) * 2.3999632 + turn;
    sum += textureLod(art, clamp(p + vec2(cos(a), sin(a)) * r, 0.004, 0.996), lod).rgb;
  }
  return sum / 12.0;
}

void main() {
  float soft = blur + mirrored * max(0.0, above) * 16.0;
  float d = edge(uv);
  float aa = max(0.75 / (scale * ratio), soft);
  float inside = 1.0 - smoothstep(-aa, aa * 0.6, d);
  if (inside < 0.002) discard;
  vec3 bare = mix(vec3(0.07), vec3(0.93), bright);
  bare += (1.0 - bright) * lit * 0.2 * exp(-dot(uv - vec2(0.5, 0.0), uv - vec2(0.5, 0.0)) * 3.2);
  vec3 paint = mix(bare, sampleArt(uv, soft), ready);
  if (slab > 0.0) {
    paint = mix(mix(vec3(0.3), vec3(0.8), bright), mix(textureLod(art, clamp(uv, 0.02, 0.98), 4.0).rgb, vec3(0.5), 0.25), ready);
    float facing = 0.35 + 0.65 * max(0.0, dot(normalize(uv - 0.5 + 1e-4), lamp));
    paint *= mix(0.22, 0.6, facing) * mix(1.0, 1.75, bright);
  } else {
    float rim = 1.0 - smoothstep(0.0, 1.3, -d - 0.2);
    vec2 outward = normalize((uv - 0.5) * abs(uv - 0.5) + 1e-4);
    paint += rim * max(0.0, dot(outward, lamp)) * 0.32 * (1.0 - bright * 0.6);
    float band = dot(uv - 0.5, vec2(0.82, 0.57)) - sweep.x;
    paint += sweep.z * (0.11 * exp(-band * band * 46.0) + 0.07 * exp(-band * band * 900.0));
    paint *= 1.0 + sweep.z * 0.05 * (0.5 - uv.y);
  }
  paint *= dim;
  float alpha = inside * shown;
  if (mirrored > 0.5) {
    float fade = clamp(1.0 - above / 0.62, 0.0, 1.0);
    alpha *= mirrorGain * fade * fade * smoothstep(-0.02, 0.01, above);
  }
  paint += (noise(gl_FragCoord.xy) - 0.5) / 255.0;
  color = vec4(paint * alpha, alpha);
}`;

export const FLOOR_FRAGMENT = `#version 300 es
precision highp float;
in vec2 uv;
in float above;
in float depth;
uniform sampler2D art;
uniform float ready;
uniform float bright;
uniform vec2 pool;
out vec4 color;
float noise(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
void main() {
  vec2 p = (uv - 0.5) * 2.0;
  float r2 = dot(p, p);
  float window = max(0.0, 1.0 - r2);
  float fall = window * window / (1.0 + 9.0 * r2);
  vec3 tint = mix(vec3(0.5), textureLod(art, vec2(0.5, 0.8), 7.0).rgb, ready);
  vec3 light = tint * fall * pool.x;
  vec2 c = p * vec2(1.35, 5.5);
  float contact = exp(-dot(c, c) * 2.2) * pool.y;
  float grain = (noise(gl_FragCoord.xy) - 0.5) / 255.0;
  color = vec4(light * mix(1.0, 0.4, bright) + grain * fall, contact + length(tint) * fall * pool.x * bright * 0.22);
}`;
