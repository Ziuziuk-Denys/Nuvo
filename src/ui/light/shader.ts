export const MAX_OBJECTS = 24;
export const GRID = 4;

export const VERTEX = `#version 300 es
in vec2 position;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
}`;

export const FRAGMENT = `#version 300 es
precision highp float;
out vec4 color;
uniform vec2 size;
uniform float scale;
uniform vec3 base;
uniform float dark;
uniform float cap;
uniform vec2 foot;
uniform vec3 key;
uniform vec3 lamp;
uniform vec3 aim;
uniform vec2 beam;
uniform vec2 spillCone;
uniform float power;
uniform float spill;
uniform float emit;
uniform vec4 screen;
uniform float screenLift;
uniform float lean;
uniform float both;
uniform vec3 cells[${GRID * GRID}];
uniform int count;
uniform vec4 box[${MAX_OBJECTS}];
uniform vec2 body[${MAX_OBJECTS}];

const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

float grain(vec2 p) {
  return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}

vec3 toLinear(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
}

vec3 toScreen(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(max(c, 0.0), vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

float rounded(vec2 p, vec2 halfSize, float radius) {
  vec2 d = abs(p) - halfSize + radius;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - radius;
}

float shadow(vec2 p) {
  float clear = 1.0;
  for (int i = 0; i < count; i++) {
    vec4 b = box[i];
    float lift = body[i].y;
    vec2 thrown = p + (lamp.xy - p) * (lift / lamp.z);
    float away = max(rounded(p - b.xy, b.zw, body[i].x), 0.0);
    float soft = 1.5 + away * 0.95;
    float covered = smoothstep(soft, -soft, rounded(thrown - b.xy, b.zw, body[i].x));
    clear *= 1.0 - covered / (1.0 + away / (lift * 1.6));
  }
  return 1.0 - clear;
}

vec3 cell(float column, float row) {
  return cells[int(clamp(row, 0.0, ${GRID - 1}.0)) * ${GRID} + int(clamp(column, 0.0, ${GRID - 1}.0))];
}

vec3 pane(vec2 at) {
  vec2 q = at * ${GRID}.0 - 0.5;
  vec2 i = floor(q);
  vec2 f = smoothstep(0.0, 1.0, q - i);
  return mix(mix(cell(i.x, i.y), cell(i.x + 1.0, i.y), f.x), mix(cell(i.x, i.y + 1.0), cell(i.x + 1.0, i.y + 1.0), f.x), f.y);
}

vec3 fromScreen(vec2 p) {
  float side = sign(p.x - screen.x);
  float gone = abs(p.x - screen.x) - screen.z;
  if (gone < 0.0) return vec3(0.0);
  float far = gone / screenLift;
  float v = (p.y - screen.y - gone * lean) / (screen.w * (1.0 + far * 0.5));
  float soft = 0.012 + far * 0.62;
  float window = smoothstep(-soft, soft, v + 1.0) * smoothstep(-soft, soft, 1.0 - v);
  vec3 tint = pane(vec2(0.5 + side * (0.5 - far / (far + 2.2)), clamp(v * 0.5 + 0.5, 0.0, 1.0)));
  tint = mix(tint, pane(vec2(0.5 - side * (0.5 - far / (far + 2.2)), clamp(v * 0.5 + 0.5, 0.0, 1.0))), 0.45 * both);
  return tint * (side < 0.0 ? both : 1.0) * window / ((1.0 + far * 0.62) * (1.0 + far * 0.62));
}

void main() {
  vec2 p = vec2(gl_FragCoord.x, size.y * scale - gl_FragCoord.y) / scale;
  vec3 d = lamp - vec3(p, 0.0);
  float r = length(d);
  float reach = distance(lamp, aim);
  float fall = d.z / r * reach * reach / (r * r) * power;
  float angle = dot(-d / r, normalize(aim - lamp));
  float core = fall * smoothstep(beam.y, beam.x, angle) * (1.0 - spill);
  float wide = fall * smoothstep(spillCone.y, spillCone.x, angle) * spill;
  float shade = shadow(p);
  float end = 1.0 - smoothstep(foot.x, foot.y, p.y);
  vec3 ground = toLinear(base);
  vec3 light;
  if (dark > 0.5) {
    vec3 grey = vec3(dot(key, LUMA));
    vec3 c = (key * core + mix(grey, key, 0.4) * wide) * (1.0 - 0.62 * shade);
    if (emit > 0.0) {
      vec3 s = fromScreen(p) * emit;
      float bright = dot(s, LUMA);
      c += mix(vec3(bright), s, 0.35 + 0.35 * smoothstep(0.0, 0.04, bright));
    }
    float y = dot(c, LUMA);
    c *= cap * (1.0 - exp(-y / cap)) / max(y, 1e-5);
    light = ground + c * end * (1.0 - ground);
  } else {
    vec3 tint = key / max(key.r, max(key.g, key.b));
    float k = 1.0 - exp(-core * 7.0);
    float day = 1.0 - exp(-wide * 7.0);
    vec3 cool = vec3(0.845, 0.85, 0.861);
    vec3 wall = ground * mix(vec3(1.0), mix(cool, vec3(0.945, 0.947, 0.95), day), min(1.0, power * 3.2));
    vec3 sun = mix(vec3(1.0, 0.99, 0.972), tint, 0.4 * (1.0 - k));
    wall = mix(wall, sun, k * 0.94);
    wall *= mix(vec3(1.0), vec3(0.66, 0.70, 0.78), shade * (0.4 + 0.5 * k));
    light = mix(ground, wall, end);
  }
  float noise = grain(gl_FragCoord.xy) + grain(gl_FragCoord.xy + vec2(47.0, 17.0)) - 1.0;
  color = vec4(toScreen(light) + noise / 255.0, 1.0);
}`;
