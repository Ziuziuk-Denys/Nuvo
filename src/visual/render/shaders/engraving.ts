import type { ShaderDef } from "./library";

export const engraving: ShaderDef = {
  params: {
    lines: { min: 90, max: 190, value: 150 },
    paper: { min: 0, max: 1, value: 0 },
    relief: { min: 0, max: 2, value: 1 },
    travel: { min: 0, max: 2, value: 1 },
    tint: { min: 0, max: 1, value: 0.35 },
  },
  body: `
// a cubic filter, because bilinear mips would facet the contours the lines follow
vec4 smoothTexel(sampler2D image, vec2 at, int level) {
  float lod = float(level);
  vec2 size = vec2(textureSize(image, level));
  vec2 q = at * size - 0.5;
  vec2 f = fract(q);
  q -= f;
  vec2 f2 = f * f;
  vec2 f3 = f2 * f;
  vec2 w0 = (1.0 - f) * (1.0 - f) * (1.0 - f) / 6.0;
  vec2 w1 = (4.0 - 6.0 * f2 + 3.0 * f3) / 6.0;
  vec2 w3 = f3 / 6.0;
  vec2 w2 = 1.0 - w0 - w1 - w3;
  vec2 s0 = w0 + w1;
  vec2 s1 = w2 + w3;
  vec2 t0 = (q - 0.5 + w1 / s0) / size;
  vec2 t1 = (q + 1.5 + w3 / s1) / size;
  return textureLod(image, t0, lod) * s0.x * s0.y + textureLod(image, vec2(t1.x, t0.y), lod) * s1.x * s0.y +
    textureLod(image, vec2(t0.x, t1.y), lod) * s0.x * s1.y + textureLod(image, t1, lod) * s1.x * s1.y;
}

float tone(vec2 uv, int level) {
  float t = sqrt(luma(smoothTexel(uCover, vec2(uv.x, 1.0 - uv.y), level).rgb));
  return t * t / (t + 0.1) * 1.1;
}

float stroke(float d, float spacing, float halfWidth) {
  float off = abs(fract(d / spacing) - 0.5) * spacing;
  float px = length(vec2(dFdx(d), dFdy(d)));
  float edge = (halfWidth * spacing - off) / px;
  return clamp(edge + 0.5, 0.0, 1.0) * smoothstep(0.0, 0.5, halfWidth * spacing / px);
}

float swell(float lane, float back) {
  float sum = 0.0;
  for (int i = -4; i <= 4; i++) {
    float k = float(i);
    sum += texture(uHistory, vec2(0.04 + 0.8 * lane, uHistoryHead - back - 0.07 + k * 0.014)).r * (5.0 - abs(k));
  }
  return shaped(sum / 25.0);
}

vec4 layer() {
  float unit = min(uResolution.x, uResolution.y);
  vec2 p = (gl_FragCoord.xy - 0.5 * uResolution) / unit;
  vec2 drift = vec2(sin(uTime * 0.05), cos(uTime * 0.041)) * 0.008;
  float tall = uResolution.y / unit;
  float span = min(0.86 * tall, 1.0);
  vec2 hung = vec2(0.0, 0.5 * tall - 0.48 * span);
  vec2 uv = (p - hung + drift) / span + 0.5;
  // past the cover its edge tones run on and thin out, the way an engraver leaves a vignette
  vec2 held = clamp(uv, 0.03, 0.97);
  vec2 gone = abs(uv - held);
  float inside = smoothstep(0.1, 0.0, max(gone.x, gone.y));
  float fade = smoothstep(0.0, 0.42, max(gone.x, gone.y));
  float spacing = max(1.0 / floor(u_lines), clamp(unit / 60.0, 3.0, 6.0) / unit);
  float dark = 1.0 - u_paper;
  float beyond = mix(0.8, 0.14, dark);
  float shape = mix(tone(held, 4), beyond, fade);
  float middle = mix(shape, tone(held, 2), inside);
  float fine = mix(shape, tone(held, 1), inside);
  float t = clamp((fine - 0.5) * 1.18 + 0.5 + (fine - middle) * 0.5, 0.0, 1.0);
  float amount = mix(1.0 - t, t, dark);

  float turn = -0.34;
  vec2 across = vec2(-sin(turn), cos(turn));
  vec2 along = vec2(cos(turn), sin(turn));
  float bend = u_relief * (0.05 * (shape - 0.5) + 0.014 * (middle - shape));
  float d = dot(p, across) + bend;
  float pulse = u_travel * swell(clamp(dot(p, across) * 0.6 + 0.5, 0.0, 1.0), (dot(p, along) + 1.0) * 0.2);
  float w = mix(0.03, 0.4, pow(amount, 1.15)) * (1.0 + 0.5 * pulse);

  vec2 at = vec2(vUv.x, 1.0 - vUv.y);
  // the plate ends above the caption, so the words stand on clean ground
  float ground = smoothstep(0.25, 0.4, vUv.y);
  int far = int(clamp(log2(unit / 34.0), 1.0, 8.0));
  ground *= 1.0 - smoothstep(0.03, 0.2, smoothTexel(uText, at, far).a);
  w *= ground;
  float ink = stroke(d, spacing, min(w, 0.44));

  float hatch = smoothstep(0.62, 0.95, amount) * ground;
  vec2 crossing = vec2(-sin(turn + 1.02), cos(turn + 1.02));
  ink = max(ink, stroke(dot(p, crossing) - bend * 0.6, spacing * 1.15, 0.22 * hatch));

  vec3 key = uKey / max(max(uKey.r, uKey.g), max(uKey.b, 0.02));
  vec3 night = uDeep * 0.12 + 0.002;
  vec3 light = mix(vec3(0.88), key, u_tint * (0.35 + 0.65 * (1.0 - t)));
  vec3 sheet = mix(vec3(0.9, 0.885, 0.855), uLight, 0.2);
  sheet *= 1.0 + (fbm(gl_FragCoord.xy / unit * vec2(260.0, 70.0)) - 0.5) * 0.025;
  vec3 pigment = mix(vec3(0.016, 0.018, 0.026), key * 0.1, u_tint * 0.7);
  vec3 c = mix(mix(sheet, pigment, ink), mix(night, light * (0.5 + 0.5 * amount + 0.25 * pulse), ink), dark);
  vec3 word = inkOr(mix(vec3(0.016, 0.018, 0.026), vec3(0.97), dark));
  return vec4(mix(c, word, textAt(vUv)), 1.0);
}`,
};
