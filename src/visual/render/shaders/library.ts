import type { ShaderSpec } from "../../template/schema";

export interface ShaderDef extends ShaderSpec {
  body: string;
  feedback?: boolean;
  backdrop?: boolean;
}

const flow: ShaderDef = {
  params: {
    speed: { min: 0, max: 2, value: 1 },
    dim: { min: 0, max: 1, value: 0.55 },
    bloom: { min: 0, max: 1.5, value: 0.2 },
    zoom: { min: 1, max: 3, value: 1.6 },
  },
  body: `
vec4 layer() {
  vec2 p = centred() / u_zoom;
  float t = uTime * 0.045 * u_speed;
  p += 0.22 * (vec2(fbm(p * 1.3 + vec2(t, -t)), fbm(p * 1.3 + vec2(-t * 0.8, t * 1.1) + 7.3)) - 0.5);
  float a = sin(t * 0.7) * 0.5;
  p = mat2(cos(a), -sin(a), sin(a), cos(a)) * p;
  vec3 c = coverSoft(p + 0.5, 3.5);
  c = max(mix(vec3(luma(c)), c, 1.45), 0.0) * u_dim;
  float rise = pow(clamp(1.0 - vUv.y, 0.0, 1.0), 2.6);
  c += uKey * u_bloom * rise * 0.6;
  c *= mix(1.0, 0.5, smoothstep(0.35, 1.0, length((vUv - 0.5) * vec2(1.0, 1.15))));
  return vec4(c, 1.0);
}`,
};

const paper: ShaderDef = {
  params: {
    ink: { min: 0, max: 1, value: 0 },
    tint: { min: 0, max: 1, value: 0.5 },
    fibre: { min: 0, max: 1, value: 1 },
    vignette: { min: 0, max: 1, value: 1 },
  },
  body: `
vec4 layer() {
  vec3 sheet = mix(mix(vec3(1.0), vec3(0.86, 0.85, 0.82), u_fibre), uLight, u_tint * 0.55);
  vec3 night = uDeep * 0.7 + 0.003;
  vec3 c = mix(sheet, night, u_ink);
  vec2 px = gl_FragCoord.xy / min(uResolution.x, uResolution.y);
  c *= 1.0 + (fbm(px * vec2(260.0, 70.0)) - 0.5) * 0.03 * u_fibre;
  c *= 1.0 - 0.1 * u_vignette * smoothstep(0.45, 1.1, length(vUv - 0.5) * 1.4);
  return vec4(c, 1.0);
}`,
};

const type: ShaderDef = {
  params: {
    tone: { min: 0, max: 1, value: 1 },
    opacity: { min: 0, max: 1, value: 1 },
    mono: { min: 0, max: 1, value: 0 },
  },
  body: `
vec4 layer() {
  float a = textAt(vUv) * u_opacity;
  vec3 ink = mix(uDeep * 0.85, mix(uLight, vec3(1.0), 0.65), u_tone);
  ink = mix(ink, vec3(u_tone), u_mono);
  return vec4(ink * a, a);
}`,
};

const columns: ShaderDef = {
  params: {
    count: { min: 1, max: 6, value: 4 },
    levels: { min: 2, max: 6, value: 3 },
    flicker: { min: 0, max: 1, value: 0.6 },
    outline: { min: 0.5, max: 4, value: 1.6 },
    original: { min: 0, max: 1, value: 0 },
    video: { min: 0, max: 1, value: 0 },
    ascii: { min: 0, max: 1, value: 0 },
    cell: { min: 0.006, max: 0.05, value: 0.022 },
    contrast: { min: 0.5, max: 4, value: 2.4 },
    tear: { min: 0, max: 1, value: 0 },
    split: { min: 0, max: 1, value: 0 },
    fog: { min: 0, max: 1, value: 0 },
    scan: { min: 0, max: 1, value: 0 },
    noise: { min: 0, max: 1, value: 0 },
  },
  body: `
vec3 srgbIn(vec3 c) {
  return pow(c, vec3(2.2));
}

vec3 columnHue(int k) {
  vec3 cover = k == 0 ? uKey : k == 1 ? uCool : k == 2 ? uLight : mix(uKey, uLight, 0.5);
  vec3 original = k == 0 ? srgbIn(vec3(0.76, 0.49, 0.49)) : k == 1 ? srgbIn(vec3(0.6, 0.42, 0.94)) : k == 2 ? srgbIn(vec3(0.96, 0.84, 0.69)) : srgbIn(vec3(0.44, 0.58, 0.94));
  return mix(cover, original, u_original);
}

float videoLevel(vec2 uv) {
  float mean = pow(luma(imageAt(vec2(0.5), 10.0)), 0.45);
  return clamp((pow(luma(imageAt(uv, 0.0)), 0.45) - mean) * u_contrast + 0.5, 0.0, 1.0);
}

float asciiLevel(vec2 frag) {
  vec2 cellSize = vec2(0.6, 1.0) * u_cell * min(uResolution.x, uResolution.y);
  vec2 index = floor(frag / cellSize);
  float level = videoLevel((index + 0.5) * cellSize / uResolution);
  float glyph = floor(level * (uGlyphCount - 1.0) + 0.5);
  vec2 inside = fract(frag / cellSize);
  float coverage = texture(uGlyphs, vec2((glyph + inside.x) / uGlyphCount, 1.0 - inside.y)).a;
  return coverage * (0.25 + 0.75 * level);
}

float posterised(vec2 uv, float seed, float col, float steps) {
  if (u_video > 0.5 && uHasImage > 0.5) {
    if (u_ascii > 0.5) return asciiLevel(uv * uResolution);
    return clamp(floor(videoLevel(uv) * steps) / (steps - 1.0), 0.0, 1.0);
  }
  float h1 = hash(vec2(col + 1.0, seed));
  float h2 = hash(vec2(seed + 3.0, col * 7.0 + 1.0));
  float zoom = mix(0.75, 1.6, h1);
  vec2 aspect = vec2(uResolution.x / uResolution.y, 1.0);
  vec2 q = (uv - 0.5) * aspect / zoom + 0.5 + (vec2(h2, h1) - 0.5) * 0.3;
  if (hash(vec2(seed, col + 9.0)) > 0.5) q.x = 1.0 - q.x;
  float mean = pow(luma(textureLod(uCover, vec2(0.5), 10.0).rgb), 0.45);
  float v = smoothstep(mean - 0.18, mean + 0.18, pow(luma(cover(q)), 0.45));
  return clamp(floor(v * steps) / (steps - 1.0), 0.0, 1.0);
}

vec4 layer() {
  float n = floor(u_count + 0.5);
  float col = min(floor(vUv.x * n), n - 1.0);
  int k = int(mod(col, 4.0));
  float seed = uStrobe > 0.5 ? floor(uTime * 20.0) : uCut;
  float steps = floor(u_levels + 0.5);
  vec2 uv = vUv;
  float row = floor(vUv.y * 90.0);
  float torn = step(0.72, hash(vec2(row, uCut))) * (hash(vec2(row, uCut + 1.0)) - 0.5);
  uv.x += u_tear * (torn * 0.16 * uOnset + (hash(vec2(row, floor(uTime * 24.0))) - 0.5) * 0.002);
  float v = posterised(uv, seed, col, steps);
  float shift = u_split * 0.006 * (0.35 + uOnset);
  float vr = u_split > 0.0 ? posterised(uv + vec2(shift, 0.0), seed, col, steps) : v;
  float vb = u_split > 0.0 ? posterised(uv - vec2(shift, 0.0), seed, col, steps) : v;
  vec3 hi = columnHue(k);
  if (u_ascii > 0.5) hi = hi / max(max(hi.r, hi.g), max(hi.b, 0.001)) * 0.9;
  vec3 lo = hi * (u_ascii > 0.5 ? 0.025 : 0.06);
  vec3 c = vec3(mix(lo, hi, vr).r, mix(lo, hi, v).g, mix(lo, hi, vb).b);
  float haze = smoothstep(0.35, 0.85, fbm(vUv * vec2(2.0, 3.0) + vec2(uTime * 0.04, -uTime * 0.025))) * u_fog;
  c = mix(c, mix(lo, hi, 0.25) * 0.35 + 0.005, haze * 0.7);
  c *= 1.0 - u_scan * 0.22 * step(0.5, fract(gl_FragCoord.y / 3.0));
  c *= 1.0 + u_scan * 0.18 * exp(-pow(fract(vUv.y + uTime * 0.07) - 0.5, 2.0) * 300.0);
  float quiet = u_noise * (1.0 - smoothstep(0.15, 0.45, uLevel));
  c = mix(c, hi * hash(gl_FragCoord.xy + floor(uTime * 30.0) * 7.1) * 0.55, quiet * 0.6);
  float flashCol = floor(hash(vec2(uCut, 5.1)) * n);
  float flash = (1.0 - smoothstep(0.03, 0.1, uCutAge)) * step(abs(col - flashCol), 0.5) * u_flicker;
  c = mix(c, mix(lo, hi, 1.0 - v), flash);
  c *= mix(1.0, 0.05, uBlackout);

  float a = textAt(vUv);
  vec2 d = u_outline / uResolution;
  float grown = a;
  for (int i = 0; i < 8; i++) {
    float t = float(i) * PI * 0.25;
    grown = max(grown, textAt(vUv + d * vec2(cos(t), sin(t))));
  }
  vec3 fill = mix(vec3(1.0), uLight, 0.25);
  if (k == 0) c = mix(c, fill, a);
  else if (k == 1) c = mix(c, fill, clamp(grown - a, 0.0, 1.0));
  else if (k == 2) c = mix(c, mix(hi * 0.2, hi * 1.2 + 0.05, posterised(vUv, seed + 17.0, col, steps)), a);
  else c = mix(c, hi * 1.25 + 0.04, a);
  return vec4(c, 1.0);
}`,
};

const duo: ShaderDef = {
  params: {
    bright: { min: 0.3, max: 1.2, value: 0.95 },
    wave: { min: 0, max: 0.02, value: 0.002 },
    pulse: { min: 0, max: 0.3, value: 0.08 },
  },
  body: `
vec4 layer() {
  vec3 vivid = mix(uKey / max(max(uKey.r, uKey.g), max(uKey.b, 0.001)) * u_bright, uColorA, uCustom);
  vec3 dark = mix(uDeep * 0.8 + 0.002, uColorB, uCustom);
  vec3 bg = vivid * (1.0 + uFlash * u_pulse * 12.0);
  vec3 fg = dark;
  vec2 uv = vUv;
  uv.x += sin(uv.y * 38.0 + uTime * 5.0) * u_wave;
  uv.y += sin(uv.x * 21.0 - uTime * 3.7) * u_wave * 0.6;
  float a = textAt(uv);
  return vec4(mix(bg, fg, a), 1.0);
}`,
};

const ink: ShaderDef = {
  feedback: true,
  params: {
    radius: { min: 0.1, max: 0.45, value: 0.3 },
    amp: { min: 0, max: 1.5, value: 0.5 },
    keep: { min: 0.8, max: 0.999, value: 0.975 },
    pressure: { min: 0, max: 3, value: 1 },
    width: { min: 0.0003, max: 0.01, value: 0.0012 },
    tone: { min: 0, max: 1, value: 0 },
    spin: { min: 0, max: 1, value: 0.15 },
  },
  body: `
vec4 layer() {
  vec2 p = centred();
  float a = uDrive * u_spin;
  p = mat2(cos(a), -sin(a), sin(a), cos(a)) * p;
  float r = length(p);
  float s = abs(atan(p.y, p.x)) / PI;
  float w = wave(0.02 + s * 0.96);
  float rc = u_radius * (1.0 + u_amp * w);
  float stroke = line(r - rc, u_width * (1.0 + 2.5 * uOnset));
  float grain = 0.55 + 0.45 * hash(gl_FragCoord.xy + fract(uTime) * 91.0);
  vec4 prev = texture(uPrev, vUv);
  float density = prev.a * pow(u_keep, uDelta * 60.0) + stroke * grain * u_pressure * 0.22 * (0.35 + uLevel);
  density = min(density, 1.0);
  vec3 colour = mix(uDeep * 0.6, uLight * 1.05, u_tone);
  return vec4(colour * density, density);
}`,
};

const disc: ShaderDef = {
  params: {
    radius: { min: 0.02, max: 0.45, value: 0.12 },
    pulse: { min: 0, max: 0.2, value: 0.02 },
    shadow: { min: 0, max: 1, value: 0.45 },
    source: { min: 0, max: 2, value: 0 },
  },
  body: `
vec4 layer() {
  vec2 p = centred();
  float r = length(p);
  float radius = u_radius * (1.0 + u_pulse * uBass);
  vec2 q = p / (2.0 * radius) + 0.5;
  vec3 c = u_source < 0.5 ? cover(q) : u_source < 1.5 && uHasImage > 0.5 ? texture(uImage, vec2(q.x, 1.0 - q.y)).rgb : vec3(0.0);
  float f = fwidth(r);
  float mask = 1.0 - smoothstep(radius - f, radius + f, r);
  float shade = u_shadow * (1.0 - smoothstep(radius * 0.9, radius * 1.6, r)) * (1.0 - mask);
  return vec4(c * mask, mask + shade * 0.6);
}`,
};

const orbit: ShaderDef = {
  params: {
    radius: { min: 0.05, max: 0.45, value: 0.19 },
    amp: { min: 0, max: 0.5, value: 0.17 },
    gap: { min: 0, max: 0.06, value: 0.011 },
    width: { min: 0.0003, max: 0.006, value: 0.0011 },
    lobes: { min: 0, max: 1, value: 0.7 },
  },
  body: `
vec4 layer() {
  vec2 p = centred();
  float r = length(p);
  float s = abs(atan(p.x, p.y)) / PI;
  float spectrum = bandSmooth(0.04 + s * 0.8);
  float lobe = u_lobes * uBass * pow(sin(s * PI), 4.0) * smoothstep(1.0, 0.25, s);
  float reach = u_radius + u_amp * (spectrum * 0.7 + lobe);
  float strokes = 0.0;
  for (int i = 0; i < 3; i++) {
    float k = float(i);
    strokes += line(r - reach - k * u_gap * (1.0 + spectrum), u_width) * (1.0 - k * 0.3);
  }
  strokes += line(r - u_radius * 1.04, u_width * 0.8) * 0.5;
  float a = clamp(strokes, 0.0, 1.0) * 0.92;
  return vec4(uLight * 1.05 * a, a);
}`,
};

const specks: ShaderDef = {
  params: {
    density: { min: 0, max: 1, value: 0.35 },
    size: { min: 0.2, max: 3, value: 1 },
    drift: { min: 0, max: 3, value: 1 },
  },
  body: `
float speck(vec2 p, float depth, float seed) {
  float cell = mix(0.09, 0.32, depth);
  vec2 q = p / cell + vec2(seed * 13.0, -uDrive * u_drift * 0.18 / cell * (1.2 - depth));
  vec2 id = floor(q);
  float h = hash(id + seed);
  if (h > u_density) return 0.0;
  vec2 centre = vec2(hash(id + seed + 1.7), hash(id + seed + 4.2)) * 0.6 + 0.2;
  float radius = min(mix(0.0035, 0.12, depth * depth) * u_size, cell * 0.2);
  float soft = mix(0.3, 1.0, depth);
  float d = length(q - id - centre) * cell;
  return (1.0 - smoothstep(radius * (1.0 - soft), radius, d)) * mix(0.5, 0.07, depth);
}

vec4 layer() {
  vec2 p = centred();
  float a = speck(p, 0.0, 1.0) + speck(p, 0.15, 2.0) + speck(p, 1.0, 3.0);
  a = clamp(a * (0.7 + 0.6 * uOnset), 0.0, 1.0);
  return vec4(uLight * a, a);
}`,
};

const ridgeline: ShaderDef = {
  params: {
    lines: { min: 8, max: 64, value: 42 },
    height: { min: 0, max: 0.6, value: 0.24 },
    width: { min: 0.0003, max: 0.005, value: 0.0011 },
    near: { min: 0, max: 0.6, value: 0.2 },
    far: { min: 0.3, max: 1, value: 0.74 },
  },
  body: `
vec4 layer() {
  float count = floor(u_lines);
  float horizon = -1.0;
  float a = 0.0;
  vec3 c = vec3(0.0);
  float halfWidth = u_width * uResolution.y / min(uResolution.x, uResolution.y);
  for (int i = 0; i < 64; i++) {
    if (float(i) >= count) break;
    float d = float(i) / (count - 1.0);
    float spread = mix(0.8, 0.46, d);
    float x = (vUv.x - 0.5) / spread + 0.5;
    float row = fract(uHistoryHead - d * 0.94);
    float bx = abs(x - 0.5) * 2.0;
    float inside = smoothstep(0.0, 0.015, x) * smoothstep(1.0, 0.985, x);
    float taper = smoothstep(1.0, 0.5, bx);
    float v = shaped(texture(uHistory, vec2(0.02 + bx * 0.85, row)).r) * taper;
    float base = mix(u_near, u_far, pow(d, 0.85));
    float y = base + u_height * mix(1.0, 0.45, d) * v;
    if (vUv.y < horizon) break;
    float stroke = line(vUv.y - y, halfWidth) * step(horizon, vUv.y) * inside;
    vec3 tone = mix(uKey * 1.25 + 0.04, uLight * 0.55, smoothstep(0.0, 0.8, d));
    float alpha = stroke * mix(1.0, 0.3, d);
    c += tone * alpha * (1.0 - a);
    a += alpha * (1.0 - a);
    horizon = max(horizon, y);
  }
  return vec4(c, a);
}`,
};

const still: ShaderDef = {
  params: {
    zoom: { min: 1, max: 1.5, value: 1.12 },
    drift: { min: 0, max: 1, value: 0.4 },
    dim: { min: 0, max: 1.2, value: 0.9 },
    flash: { min: 0, max: 1, value: 0 },
    source: { min: 0, max: 1, value: 0 },
    rays: { min: 0, max: 1, value: 0 },
  },
  body: `
vec3 stillAt(vec2 uv) {
  if (u_source > 0.5 && uHasImage > 0.5) return textureLod(uImage, imageFill(uv), 0.0).rgb;
  vec2 a = uResolution / min(uResolution.x, uResolution.y);
  return cover((uv - 0.5) * a / max(a.x, a.y) + 0.5);
}

vec4 layer() {
  float t = uTime * 0.05 * u_drift;
  float zoom = u_zoom + 0.06 * sin(t * 0.7) + 0.015 * uBass;
  vec2 uv = (vUv - 0.5) / zoom + 0.5 + vec2(sin(t), cos(t * 0.8)) * 0.02;
  float hit = u_flash * uOnset * uOnset * smoothstep(0.55, 0.9, uLevel);
  vec3 c = vec3(0.0);
  for (int i = 0; i < 6; i++) c += stillAt(0.5 + (uv - 0.5) * (1.0 - hit * 0.035 * float(i)));
  c = c / 6.0 * (u_dim + hit * 1.6);
  float shaft = pow(max(0.0, sin((vUv.x * 0.8 + vUv.y) * 5.0 + uTime * 0.05)), 10.0);
  c += vec3(shaft * u_rays * 0.05 * (0.6 + 0.4 * noise(vUv * 3.0 + uTime * 0.05)));
  return vec4(c, 1.0);
}`,
};

const liquid: ShaderDef = {
  params: {
    radius: { min: 0.08, max: 0.4, value: 0.19 },
    amp: { min: 0, max: 0.5, value: 0.15 },
    gloss: { min: 0, max: 1, value: 0.8 },
    body: { min: 0.1, max: 1, value: 0.5 },
    ribbon: { min: 0, max: 0.06, value: 0.03 },
    second: { min: 0, max: 1, value: 0.75 },
    tint: { min: 0, max: 1, value: 0 },
    sharp: { min: 0, max: 2, value: 0.6 },
  },
  body: `
float ringAt(float u) {
  float d = 0.0;
  for (int i = -2; i <= 2; i++) d += texture(uRing, vec2(u + float(i) * 0.006, 0.5)).r * (3.0 - abs(float(i)));
  d /= 9.0;
  return d + u_sharp * max(d, 0.0) * smoothstep(0.15, 0.7, d) * 0.8;
}

vec3 band(float t, vec3 outer, vec3 middle) {
  float stripe = abs(t * 3.0 - 1.5);
  return stripe > 0.5 ? outer : middle;
}

vec4 layer() {
  vec2 p = centred();
  float r = length(p);
  float u = fract(atan(p.x, p.y) / (2.0 * PI));
  float f = fwidth(r);
  float d = ringAt(u);
  float edge = u_radius + u_amp * d;
  float w = u_ribbon * (1.0 + 0.6 * max(d, 0.0));

  vec3 white = mix(uLight, vec3(1.0), 0.8);
  vec3 tone = mix(vec3(0.42), mix(uKey, uLight, 0.25), u_tint);
  vec3 cool = mix(vec3(0.75), mix(uCool, uLight, 0.4), u_tint);

  vec4 out_ = vec4(0.0);
  float body = 1.0 - smoothstep(edge - w - f, edge - w + f, r);
  if (body > 0.0) {
    float du = 1.0 / 96.0;
    float slope = (ringAt(u + du) - ringAt(u - du)) * u_amp / (2.0 * du * 2.0 * PI * max(r, 0.001));
    vec2 radial = p / max(r, 0.0001);
    vec2 tangent = vec2(radial.y, -radial.x);
    float thick = u_radius * u_body + u_amp * max(d, 0.0) * 0.6;
    float depth = clamp((edge - w - r) / thick, 0.0, 1.0);
    float h = sqrt(1.0 - (1.0 - depth) * (1.0 - depth));
    vec3 n = normalize(vec3(normalize(radial - tangent * slope) * (1.0 - h) * 1.8, h + 0.05));
    vec3 light = normalize(vec3(-0.45, 0.6, 0.65));
    float spec = pow(max(dot(reflect(-light, n), vec3(0.0, 0.0, 1.0)), 0.0), 48.0);
    vec3 env = coverSoft(0.5 + n.xy * 0.45, 3.0);
    vec3 c = mix(uDeep * 0.15, env * 0.5, u_gloss * 0.6) * (0.2 + 0.8 * max(dot(n, light), 0.0)) + spec * u_gloss * 1.2;
    out_ = vec4(c * body, body);
  }

  float inA = smoothstep(edge - w - f, edge - w + f, r) * (1.0 - smoothstep(edge - f, edge + f, r));
  if (inA > 0.0) out_ = mix(out_, vec4(band((r - edge + w) / w, white, tone), 1.0), inA);

  float d2 = ringAt(1.0 - u) * 0.85;
  float edge2 = u_radius * 1.04 + u_amp * d2;
  float w2 = u_ribbon * 0.55;
  float inB = smoothstep(edge2 - w2 - f, edge2 - w2 + f, r) * (1.0 - smoothstep(edge2 - f, edge2 + f, r)) * u_second;
  if (inB > 0.0) out_ = mix(out_, vec4(band((r - edge2 + w2) / w2, cool, white * 0.85), 1.0), inB * 0.9);
  return out_;
}`,
};

const chrome: ShaderDef = {
  params: {
    radius: { min: 0.08, max: 0.4, value: 0.2 },
    tube: { min: 0.004, max: 0.04, value: 0.013 },
    ribbon: { min: 0.01, max: 0.08, value: 0.034 },
    reach: { min: 0, max: 0.4, value: 0.1 },
    ears: { min: 0, max: 0.6, value: 0.17 },
    thorns: { min: 0, max: 48, value: 28 },
    thorn: { min: 0, max: 0.6, value: 0.42 },
    centre: { min: 0, max: 2, value: 0 },
  },
  body: `
float studio(vec3 r) {
  float turn = uDrive * 0.35 + uTime * 0.07;
  vec3 key = normalize(vec3(cos(turn), sin(turn), 0.55));
  vec3 fill = normalize(vec3(cos(turn * -0.7 + 2.4), sin(turn * -0.7 + 2.4), 0.35));
  float softbox = exp(-dot(r - key, r - key) * 9.0) * 1.6 + exp(-dot(r - fill, r - fill) * 16.0) * 0.7;
  float ring = exp(-pow((r.z - 0.42 - 0.08 * sin(turn * 2.0 + atan(r.y, r.x) * 2.0)) / 0.07, 2.0)) * 1.3;
  float horizon = smoothstep(0.05, 0.0, abs(r.z - 0.12)) * 0.25;
  return 0.015 + softbox + ring + horizon;
}

float metal(vec3 n) {
  vec3 r = reflect(vec3(0.0, 0.0, -1.0), normalize(n));
  return studio(r);
}

float ribbonRadius(float s) {
  float spectrum = bandSmooth(0.03 + s * 0.4);
  // the bass level flattens out on a dense beat, so each hit kicks the ears on top of it
  float punch = max(uOnset, smoothstep(0.25, 1.0, uFlux));
  float ears = (0.45 * uBass + 0.85 * punch) * u_ears * exp(-pow((s - 0.13) / 0.055, 2.0));
  float wings = u_reach * 0.6 * spectrum * exp(-pow((s - 0.5) / 0.12, 2.0));
  return u_radius * 1.02 + u_reach * spectrum * 0.5 + ears + wings;
}

vec4 layer() {
  vec2 p = centred();
  float r = length(p);
  float angle = atan(p.x, p.y);
  float s = abs(angle) / PI;
  float f = fwidth(r);
  vec2 radial = p / max(r, 0.0001);
  vec4 colour = vec4(0.0);

  float ds = 0.004;
  float rr = ribbonRadius(s);
  float slope = (ribbonRadius(min(s + ds, 1.0)) - ribbonRadius(max(s - ds, 0.0))) / (2.0 * ds * PI * max(r, 0.001));
  float across = (r - rr) / sqrt(1.0 + slope * slope);
  float half_ = u_ribbon * 0.5;
  float inBand = 1.0 - smoothstep(half_ - f, half_ + f, abs(across));
  if (inBand > 0.0) {
    float t = across / u_ribbon + 0.5;
    float white = 1.0 - smoothstep(0.34 - f / u_ribbon, 0.34 + f / u_ribbon, t) * (1.0 - smoothstep(0.66 - f / u_ribbon, 0.66 + f / u_ribbon, t));
    colour = vec4(vec3(white * 0.95 + 0.02), inBand);
  }

  float inner = u_radius - u_tube;
  float face = 1.0 - smoothstep(inner - f, inner + f, r);
  if (face > 0.0) {
    float x = r / inner;
    vec3 dome = normalize(vec3(radial * x * 0.6, sqrt(max(1.0 - x * x * 0.36, 0.0))));
    float fresnel = pow(1.0 - dome.z, 2.0);
    vec3 base;
    if (u_centre < 0.5) {
      base = cover(p / (2.0 * inner) + 0.5) * 0.8 + metal(dome) * (0.06 + fresnel * 0.45);
    } else if (u_centre < 1.5 && uHasImage > 0.5) {
      vec2 q = p / (2.0 * inner) + 0.5;
      vec2 e = vec2(2.0 / uResolution.y, 0.0);
      float alpha = texture(uImage, vec2(q.x, 1.0 - q.y)).a;
      float gx = texture(uImage, vec2(q.x + e.x, 1.0 - q.y)).a - texture(uImage, vec2(q.x - e.x, 1.0 - q.y)).a;
      float gy = texture(uImage, vec2(q.x, 1.0 - q.y - e.x)).a - texture(uImage, vec2(q.x, 1.0 - q.y + e.x)).a;
      base = mix(vec3(0.015), vec3(metal(vec3(-gx * 6.0, -gy * 6.0, 1.0))), alpha);
    } else {
      base = vec3(0.012) + metal(dome) * (0.12 + fresnel * 0.5);
    }
    colour = mix(colour, vec4(base, 1.0), face);
  }
  float n = floor(u_thorns + 0.5);
  if (n > 0.0 && r < inner) {
    float u = fract(angle / (2.0 * PI));
    float k = floor(u * n);
    float seed = hash(vec2(k, 17.0));
    float a = fract(u * n) - 0.5 - (seed - 0.5) * 0.35;
    float centreAngle = (k + 0.5) / n;
    float ks = abs(fract(centreAngle + 0.5) * 2.0 - 1.0);
    float level = bandSmooth(0.05 + (1.0 - ks) * 0.5);
    float keep = step(0.35, seed) * smoothstep(0.15, 0.45, level);
    float len = u_radius * u_thorn * level * mix(0.45, 1.3, hash(vec2(k, 29.0))) * keep;
    float q = inner - r;
    float widthAt = mix(0.12, 0.3, hash(vec2(k, 41.0))) * (1.0 - q / max(len, 0.0001));
    float thorn = step(0.0001, len) * step(0.0, widthAt) * (1.0 - smoothstep(widthAt - fwidth(a) * 1.5, widthAt, abs(a)));
    if (thorn > 0.0) {
      vec2 tangent = vec2(radial.y, -radial.x);
      vec3 facet = normalize(vec3(-radial * 0.5 + tangent * sign(a) * 0.9, 0.42));
      colour = mix(colour, vec4(vec3(metal(facet)), 1.0), thorn);
    }
  }

  float tube = 1.0 - smoothstep(u_tube - f, u_tube + f, abs(r - u_radius));
  if (tube > 0.0) {
    float x = clamp((r - u_radius) / u_tube, -1.0, 1.0);
    vec3 nrm = vec3(radial * x, sqrt(1.0 - x * x));
    colour = mix(colour, vec4(vec3(metal(nrm)), 1.0), tube);
  }

  return colour;
}`,
};

const streak: ShaderDef = {
  params: {
    chance: { min: 0, max: 1, value: 0.45 },
    height: { min: 0.02, max: 0.3, value: 0.08 },
  },
  body: `
vec4 layer() {
  float on = step(hash(vec2(uCut, 4.4)), u_chance);
  float life = uCutAge / 0.42;
  if (on < 0.5 || life > 1.0) return vec4(0.0);
  vec2 p = centred();
  float y = mix(0.25, 0.65, hash(vec2(uCut, 8.8))) * (uResolution.y / min(uResolution.x, uResolution.y)) * 0.5;
  float x = mix(-1.4, 1.4, life) * (hash(vec2(uCut, 2.2)) > 0.5 ? 1.0 : -1.0);
  vec2 d = (p - vec2(x, y)) / vec2(0.55, u_height);
  float a = exp(-dot(d, d) * 2.0) * (1.0 - life) * 0.95;
  return vec4(vec3(a), a);
}`,
};

const treat: ShaderDef = {
  backdrop: true,
  params: {
    mode: { min: 0, max: 3, value: 0 },
    strength: { min: 0, max: 2, value: 1 },
    depth: { min: 0, max: 1, value: 0.5 },
  },
  body: `
float maskLod(vec2 uv, float lod) {
  return textureLod(uText, vec2(uv.x, 1.0 - uv.y), lod).a;
}

vec2 maskNormal(vec2 uv, float lod) {
  vec2 e = vec2(4.0) / uResolution;
  return vec2(maskLod(uv + vec2(e.x, 0.0), lod) - maskLod(uv - vec2(e.x, 0.0), lod), maskLod(uv + vec2(0.0, e.y), lod) - maskLod(uv - vec2(0.0, e.y), lod));
}

vec3 back(vec2 uv) {
  return texture(uBackdrop, uv).rgb;
}

float studioLight(vec3 r) {
  float turn = uDrive * 0.35 + uTime * 0.07;
  vec3 key = normalize(vec3(cos(turn), sin(turn), 0.55));
  vec3 fill = normalize(vec3(cos(-turn * 0.7 + 2.4), sin(-turn * 0.7 + 2.4), 0.35));
  float ring = exp(-pow((r.z - 0.42) / 0.08, 2.0)) * 1.1;
  return 0.02 + exp(-dot(r - key, r - key) * 8.0) * 1.6 + exp(-dot(r - fill, r - fill) * 14.0) * 0.7 + ring;
}

vec4 layer() {
  vec2 uv = vUv;
  float mode = floor(u_mode + 0.5);
  float a = textAt(uv);
  vec3 base = back(uv);

  if (mode < 0.5) {
    float soft = maskLod(uv, 2.0);
    vec2 n = maskNormal(uv, 2.0) * 7.0 * u_strength;
    vec2 centre = 0.5 + (uv - 0.5) / (1.0 + 0.3 * u_strength);
    vec3 refracted = vec3(back(centre - n * 0.05).r, back(centre - n * 0.065).g, back(centre - n * 0.08).b);
    refracted = refracted * 1.6 + 0.04;
    float rim = clamp(length(n) * 0.7, 0.0, 1.0);
    float inside = smoothstep(0.2, 0.7, soft);
    vec3 c = mix(base * (1.0 - 0.35 * smoothstep(0.0, 0.3, soft)), refracted + rim * 0.5, inside);
    return vec4(c, 1.0);
  }

  if (mode < 1.5) {
    float h = maskLod(uv, 2.0);
    vec2 g = maskNormal(uv, 2.0) * 9.0 * u_strength;
    vec3 n = normalize(vec3(-g, 0.6));
    float local = fract(uv.y * 9.0);
    float sky = mix(0.95, 0.55, smoothstep(0.0, 0.5, local)) + 0.25 * n.y;
    float ground = 0.12 + 0.18 * smoothstep(0.55, 1.0, local);
    float chrome = mix(sky, ground, step(0.5, local + n.y * 0.25));
    chrome += pow(clamp(length(g) * 0.5, 0.0, 1.0), 2.0) * 0.9;
    vec3 tint = mix(vec3(1.0), uLight, 0.2);
    vec3 c = mix(base * (1.0 - 0.4 * smoothstep(0.0, 0.4, h)), tint * chrome, a);
    return vec4(c, 1.0);
  }

  if (mode < 2.5) {
    float row = floor(uv.y * 48.0);
    float block = floor(uv.x * 12.0);
    float kick = uOnset * u_strength;
    float shift = (hash(vec2(row, uCut)) - 0.5) * 0.12 * kick * step(0.6, hash(vec2(row, uCut + 3.0)));
    vec2 q = uv + vec2(shift, 0.0);
    float split = 0.004 + 0.012 * kick;
    float ar = textAt(q + vec2(split, 0.0));
    float ag = textAt(q);
    float ab = textAt(q - vec2(split, 0.0));
    vec3 smear = vec3(0.0);
    for (int i = 0; i < 8; i++) smear += back(q - vec2(float(i) * 0.012 * (0.4 + kick), 0.0));
    smear /= 8.0;
    vec3 bg = mix(base, back(q), step(0.75, hash(vec2(block, row + uCut))) * kick);
    vec3 text = vec3(ar, ag, ab) * (0.8 + smear * 0.6);
    return vec4(mix(bg, text + smear * 0.25 * vec3(ar, ag, ab), max(max(ar, ag), ab)), 1.0);
  }

  float tilt = 0.6 + 0.25 * sin(uDrive * 0.6) + 0.2 * uBass;
  vec2 vanish = vec2(0.5 + 0.25 * sin(uDrive * 0.3), 0.5 - 0.35 * tilt);
  float layers = 28.0;
  float depthHit = -1.0;
  for (int i = 1; i <= 28; i++) {
    float k = float(i) / layers;
    vec2 q = uv + (uv - vanish) * k * 0.22 * u_depth;
    if (textAt(q) > 0.5) {
      depthHit = k;
      break;
    }
  }
  vec3 c = base;
  if (depthHit > 0.0) c = mix(uDeep * 0.5 + 0.005, uKey * 0.9 + 0.03, pow(1.0 - depthHit, 1.5)) * (0.4 + 0.6 * (1.0 - depthHit));
  vec2 g = maskNormal(uv, 1.0) * 4.0;
  vec3 n = normalize(vec3(-g, 1.0));
  float light = 0.6 + 0.6 * max(dot(n, normalize(vec3(-0.5, 0.6, 0.6))), 0.0);
  vec3 face = mix(uLight, vec3(1.0), 0.6) * light;
  c = mix(c, face, a);
  return vec4(c, 1.0);
}`,
};

const petals: ShaderDef = {
  params: {
    count: { min: 0, max: 8, value: 3 },
    size: { min: 0.05, max: 0.4, value: 0.15 },
    speed: { min: 0, max: 3, value: 1.6 },
    blur: { min: 0.1, max: 1, value: 0.95 },
  },
  body: `
vec4 layer() {
  vec2 p = centred();
  float alpha = 0.0;
  for (int i = 0; i < 8; i++) {
    float k = float(i);
    if (k >= floor(u_count + 0.5)) break;
    float period = 1.6 + hash(vec2(k, 1.0)) * 4.0;
    float phase = fract((uDrive * 0.55 * u_speed + hash(vec2(k, 2.0)) * period) / period);
    float lane = floor((uDrive * 0.55 * u_speed + hash(vec2(k, 2.0)) * period) / period);
    float heading = hash(vec2(k, lane + 3.0)) * 2.0 * PI;
    vec2 dir = vec2(cos(heading), sin(heading));
    vec2 side = vec2(-dir.y, dir.x);
    vec2 pos = -dir * 1.3 + side * (hash(vec2(k, lane + 5.0)) - 0.5) * 1.1 + dir * 2.6 * phase;
    vec2 q = p - pos;
    float spin = hash(vec2(k, lane + 7.0)) * PI + phase * 2.5;
    q = mat2(cos(spin), -sin(spin), sin(spin), cos(spin)) * q;
    q.y /= 0.5;
    float d = length(q) / (u_size * (0.3 + 1.4 * hash(vec2(k, lane + 9.0))));
    alpha = max(alpha, (1.0 - smoothstep(1.0 - u_blur, 1.0, d)) * 0.45);
  }
  vec3 c = mix(uLight, vec3(1.0), 0.8);
  return vec4(c * alpha, alpha);
}`,
};

const snow: ShaderDef = {
  params: {
    amount: { min: 0, max: 1, value: 0.45 },
    size: { min: 0.3, max: 3, value: 1 },
    wind: { min: -1, max: 1, value: 0.2 },
    speed: { min: 0, max: 3, value: 1 },
  },
  body: `
float flakes(vec2 p, float depth, float seed) {
  float cell = mix(0.05, 0.24, depth);
  vec2 q = p / cell;
  q.y += uTime * u_speed * mix(0.05, 0.2, depth) / cell;
  q.x += uTime * u_wind * mix(0.02, 0.09, depth) / cell;
  vec2 id = floor(q);
  float h = hash(id + seed);
  if (h > u_amount) return 0.0;
  vec2 centre = vec2(hash(id + seed + 1.3), hash(id + seed + 2.7)) * 0.6 + 0.2;
  centre.x += 0.15 * sin(uTime * (0.5 + h) + h * 30.0);
  float radius = mix(0.0045, 0.045, depth * depth) * u_size;
  float soft = mix(0.4, 1.0, depth);
  float d = length((q - id - centre) * cell);
  return (1.0 - smoothstep(radius * (1.0 - soft), radius, d)) * mix(0.95, 0.4, depth);
}

vec4 layer() {
  vec2 p = centred();
  float a = clamp(flakes(p, 0.05, 1.0) + flakes(p, 0.4, 2.0) + flakes(p, 0.95, 3.0), 0.0, 1.0);
  vec3 c = mix(uLight, vec3(1.0), 0.6);
  return vec4(c * a, a);
}`,
};

const rain: ShaderDef = {
  params: {
    amount: { min: 0, max: 1, value: 0.5 },
    speed: { min: 0, max: 3, value: 1 },
    slant: { min: -0.5, max: 0.5, value: 0.12 },
    length: { min: 0.2, max: 3, value: 1 },
  },
  body: `
float streaks(vec2 p, float depth, float seed) {
  float width = mix(0.01, 0.045, depth);
  vec2 q = p;
  q.x += q.y * u_slant;
  float column = floor(q.x / width);
  float h = hash(vec2(column, seed));
  if (h > u_amount) return 0.0;
  float speed = mix(1.1, 2.8, depth) * u_speed * (0.8 + 0.4 * h);
  float len = mix(0.05, 0.2, depth) * u_length;
  float period = 1.2 + h * 1.5;
  float y = mod(q.y + uTime * speed + h * 10.0, period);
  float body = smoothstep(0.0, len * 0.15, y) * (1.0 - smoothstep(len * 0.15, len, y));
  float x = abs(fract(q.x / width) - 0.5 - (h - 0.5) * 0.6) * width;
  float half_ = mix(0.0005, 0.002, depth);
  float stroke = 1.0 - smoothstep(half_, half_ * 2.5, x);
  return stroke * body * mix(0.22, 0.55, depth);
}

vec4 layer() {
  vec2 p = centred();
  float a = clamp(streaks(p, 0.1, 1.0) + streaks(p, 0.5, 2.0) + streaks(p, 1.0, 3.0), 0.0, 1.0);
  vec3 c = mix(uLight, vec3(0.9, 0.93, 1.0), 0.5);
  return vec4(c * a, a);
}`,
};

const film: ShaderDef = {
  params: {
    flicker: { min: 0, max: 1, value: 0.5 },
    vignette: { min: 0, max: 1, value: 0.6 },
    letterbox: { min: 0, max: 0.2, value: 0 },
    scratches: { min: 0, max: 1, value: 0.4 },
    dust: { min: 0, max: 1, value: 0.4 },
  },
  body: `
vec4 layer() {
  float frame = floor(uTime * 24.0);
  float k = 1.0 - u_flicker * 0.14 * hash(vec2(frame, 1.7));
  k *= 1.0 - u_vignette * smoothstep(0.35, 1.05, length((vUv - 0.5) * vec2(1.0, 1.25)));
  k *= 1.0 - step(vUv.y, u_letterbox) - step(1.0 - u_letterbox, vUv.y);
  for (int i = 0; i < 2; i++) {
    float h = hash(vec2(frame, float(i) * 13.1));
    if (h < u_scratches * 0.5) {
      float x = hash(vec2(frame * 0.37, float(i) + 4.0));
      float d = abs(vUv.x - x) * uResolution.x;
      k *= 1.0 - 0.35 * (1.0 - smoothstep(0.6, 1.8, d));
    }
  }
  vec2 cell = floor(vUv * vec2(70.0, 120.0));
  if (hash(cell + frame * 7.3) < u_dust * 0.003) k *= 0.35;
  float bright = 0.0;
  for (int i = 0; i < 6; i++) {
    vec2 at = vec2(hash(vec2(frame, float(i) * 3.1)), hash(vec2(float(i) * 5.7, frame)));
    float size = mix(0.6, 2.4, hash(vec2(frame + 1.0, float(i)))) / uResolution.y;
    float show = step(hash(vec2(frame * 1.3, float(i) + 11.0)), u_dust * 0.6);
    bright = max(bright, show * (1.0 - smoothstep(size * 0.5, size, length((vUv - at) * vec2(uResolution.x / uResolution.y, 1.0)))) * 0.8);
  }
  if (hash(vec2(frame, 77.0)) < u_dust * 0.08) {
    vec2 h = vec2(hash(vec2(frame, 78.0)), hash(vec2(frame, 79.0)));
    vec2 d = (vUv - h) * vec2(uResolution.x / uResolution.y, 1.0);
    float curve = abs(d.y - 0.6 * d.x * d.x / 0.05 - 0.2 * d.x) * uResolution.y;
    bright = max(bright, (1.0 - smoothstep(0.4, 1.2, curve)) * step(abs(d.x), 0.05) * 0.5);
  }
  k = max(k, 0.0);
  return vec4(vec3(bright), 1.0 - k * (1.0 - bright));
}`,
};

const glass: ShaderDef = {
  params: {
    fog: { min: 0, max: 1, value: 0.7 },
    drops: { min: 0, max: 1, value: 0.5 },
    blur: { min: 2, max: 7, value: 4.5 },
  },
  body: `
vec2 fill(vec2 uv) {
  vec2 a = uResolution / min(uResolution.x, uResolution.y);
  return (uv - 0.5) * a / max(a.x, a.y) + 0.5;
}

float droplets(vec2 uv, out vec2 normal) {
  vec2 aspect = vec2(uResolution.x / uResolution.y, 1.0);
  vec2 p = uv * aspect * 16.0;
  vec2 id = floor(p);
  float h = hash(id);
  float slide = step(0.93, h) * uTime * 0.05;
  p.y += slide;
  id = floor(p);
  h = hash(id);
  vec2 f = fract(p) - 0.5;
  vec2 centre = (vec2(hash(id + 1.1), hash(id + 2.3)) - 0.5) * 0.6;
  float radius = mix(0.05, 0.24, h * h) * step(1.0 - u_drops, hash(id + 5.5));
  vec2 d = f - centre;
  float mask = 1.0 - smoothstep(radius * 0.8, radius, length(d));
  normal = d / max(radius, 0.001) * mask;
  return mask;
}

vec4 layer() {
  vec2 normal;
  float drop = droplets(vUv, normal);
  vec3 sharp = cover(fill(vUv - normal * 0.05));
  vec3 soft = coverSoft(fill(vUv), u_blur);
  vec3 fogged = mix(soft, mix(uLight, vec3(1.0), 0.5) * 0.55, u_fog * 0.55) + 0.03 * u_fog;
  vec2 px = 2.0 / uResolution;
  float wiped = textAt(vUv) * 0.25;
  for (int i = 0; i < 8; i++) {
    float t = float(i) * PI * 0.25;
    wiped += textAt(vUv + px * vec2(cos(t), sin(t))) * 0.09375;
  }
  float clear = max(drop, wiped);
  vec3 c = mix(fogged, sharp, clear);
  c += drop * 0.12 * clamp(0.5 - normal.y, 0.0, 1.0);
  c *= mix(1.0, 0.6, smoothstep(0.35, 1.0, length((vUv - 0.5) * vec2(1.0, 1.2))));
  return vec4(c, 1.0);
}`,
};

const print: ShaderDef = {
  params: {
    zoom: { min: 1.05, max: 2, value: 1.15 },
    drift: { min: 0, max: 1, value: 0.5 },
    shade: { min: 0.3, max: 0.85, value: 0.68 },
    grain: { min: 0, max: 1, value: 0.6 },
    blur: { min: 0, max: 1, value: 0.6 },
    glitch: { min: 0, max: 1, value: 0.5 },
    ascii: { min: 0, max: 1, value: 0 },
    cell: { min: 0.006, max: 0.05, value: 0.014 },
    source: { min: 0, max: 1, value: 0 },
  },
  body: `
vec3 printSource(vec2 uv) {
  if (u_source > 0.5 && uHasImage > 0.5) return imageAt(uv, 0.0);
  vec2 a = uResolution / min(uResolution.x, uResolution.y);
  return cover((uv - 0.5) * a / max(a.x, a.y) + 0.5);
}

vec2 shotUv(vec2 uv) {
  float zoom = u_zoom * mix(1.0, 1.8, hash(vec2(uShot, 1.3))) * (1.0 + 0.01 * min(uShotAge, 6.0) * u_drift);
  float room = 0.5 - 0.5 / zoom;
  vec2 centre = 0.5 + (vec2(hash(vec2(uShot, 4.1)), hash(vec2(uShot, 7.7))) * 2.0 - 1.0) * room * 0.85;
  float t = uTime * 0.12 * u_drift;
  centre += vec2(sin(t + uShot), cos(t * 0.8 + uShot)) * room * 0.2;
  return centre + (uv - 0.5) / zoom;
}

float printLevel(vec2 uv) {
  float mean = pow(luma(u_source > 0.5 && uHasImage > 0.5 ? imageAt(vec2(0.5), 10.0) : textureLod(uCover, vec2(0.5), 10.0).rgb), 0.45);
  float fresh = (1.0 - smoothstep(0.0, 0.16, uShotAge)) * u_blur;
  vec2 smear = (vec2(hash(vec2(uShot, 2.9)), hash(vec2(uShot, 5.3))) - 0.5) * 0.05 * fresh;
  float sum = 0.0;
  for (int i = 0; i < 4; i++) sum += pow(luma(printSource(shotUv(uv) + smear * float(i))), 0.45);
  return (sum * 0.25 - mean) * 2.2 + 0.5;
}

vec4 layer() {
  vec3 khaki = vec3(0.39, 0.3, 0.11);
  vec3 key = uKey / max(max(uKey.r, uKey.g), max(uKey.b, 0.001));
  vec3 muted = mix(vec3(luma(key)), key, 0.45) * vec3(1.05, 1.0, 0.8);
  vec3 light = mix(mix(muted * 0.3 / max(luma(muted), 0.001), khaki, 0.35), uColorA, uCustom);
  vec3 dark = mix(mix(vec3(0.012, 0.012, 0.01), uDeep * 0.2, 0.25), uColorB, uCustom);

  vec2 uv = vUv;
  float row = floor(vUv.y * 26.0);
  float glitched = step(hash(vec2(uShot, 11.0)), 0.3) * (1.0 - smoothstep(0.0, 0.12, uShotAge));
  uv.x += glitched * step(0.72, hash(vec2(row, uShot))) * (hash(vec2(row, uShot + 1.0)) - 0.5) * 0.08 * u_glitch;

  float speck = (hash(gl_FragCoord.xy + floor(uTime * 12.0) * 13.7) - 0.5) * 0.14 * u_grain;
  float edge = (noise(gl_FragCoord.xy * 0.3) - 0.5) * 0.1 * u_grain;
  float tone;
  if (u_ascii > 0.5) {
    vec2 cellSize = vec2(0.6, 1.0) * u_cell * min(uResolution.x, uResolution.y);
    vec2 frag = uv * uResolution;
    float level = smoothstep(u_shade - 0.42, u_shade + 0.15, printLevel((floor(frag / cellSize) + 0.5) * cellSize / uResolution));
    vec2 inside = fract(frag / cellSize);
    float glyph = floor(level * (uGlyphCount - 1.0) + 0.5);
    tone = texture(uGlyphs, vec2((glyph + inside.x) / uGlyphCount, 1.0 - inside.y)).a;
  } else {
    tone = smoothstep(u_shade - 0.012, u_shade + 0.012, printLevel(uv) + speck + edge);
  }
  vec3 c = mix(dark, light, tone);

  vec2 at = vec2(vUv.x, 1.0 - vUv.y);
  vec4 text = texture(uText, at);
  c = mix(c, dark, textureLod(uText, at, 5.0).a * 0.45);
  c = mix(c, mix(light, dark, tone), text.a * (1.0 - text.g));
  c = mix(c, vec3(0.9), text.a * text.g);
  return vec4(c, 1.0);
}`,
};

const smoke: ShaderDef = {
  feedback: true,
  params: {
    rise: { min: 0, max: 3, value: 0.25 },
    keep: { min: 0.9, max: 0.995, value: 0.94 },
    swirl: { min: 0, max: 3, value: 2.6 },
  },
  body: `
vec4 layer() {
  vec2 p = vUv * vec2(uResolution.x / uResolution.y, 1.0) * 3.0;
  float t = uTime * 0.2;
  vec2 curl = vec2(noise(p + vec2(0.0, t)) - 0.5, noise(p + vec2(5.2, -t)) - 0.5);
  float step_ = uDelta * 60.0;
  vec2 uv = vUv - vec2(curl.x * 0.004 * u_swirl, 0.0016 * u_rise + curl.y * 0.003 * u_swirl) * step_;
  float density = max(texture(uPrev, uv).a * pow(u_keep, step_), textAt(vUv) * 0.85);
  vec3 colour = mix(uLight, vec3(1.0), 0.5);
  return vec4(colour * density, density);
}`,
};

export const SHADERS: Record<string, ShaderDef> = {
  flow,
  paper,
  type,
  columns,
  duo,
  ink,
  disc,
  orbit,
  specks,
  ridgeline,
  still,
  liquid,
  chrome,
  streak,
  treat,
  petals,
  snow,
  rain,
  film,
  glass,
  smoke,
  print,
};
