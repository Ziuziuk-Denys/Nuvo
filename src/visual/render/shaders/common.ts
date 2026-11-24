export const COMMON = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform vec2 uResolution;
uniform float uTime;
uniform float uDelta;
uniform float uDrive;
uniform vec3 uDeep;
uniform vec3 uKey;
uniform vec3 uCool;
uniform vec3 uLight;
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform float uCustom;
uniform vec3 uInk;
uniform float uInkOn;
uniform float uBass;
uniform float uMid;
uniform float uHigh;
uniform float uLevel;
uniform float uFlux;
uniform float uOnset;
uniform float uBeat;
uniform float uCut;
uniform float uCutAge;
uniform float uShot;
uniform float uShotAge;
uniform vec2 uFocus;
uniform float uScale;
uniform float uHistoryHead;
uniform float uFlash;
uniform float uStrobe;
uniform float uBlackout;
uniform sampler2D uCover;
uniform sampler2D uBands;
uniform sampler2D uWave;
uniform sampler2D uHistory;
uniform sampler2D uText;
uniform sampler2D uPrev;
uniform sampler2D uImage;
uniform sampler2D uGlyphs;
uniform sampler2D uRing;
uniform sampler2D uBackdrop;
uniform float uImageAspect;
uniform float uHasImage;
uniform float uHasCover;
uniform float uGlyphCount;

const float PI = 3.14159265;

float hash(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

float fbm(vec2 p) {
  float sum = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 4; i++) {
    sum += amp * noise(p);
    p = p * 2.03 + 17.1;
    amp *= 0.5;
  }
  return sum;
}

vec2 centred() {
  return (gl_FragCoord.xy - uFocus * uResolution) / min(uResolution.x, uResolution.y) / uScale;
}

float luma(vec3 c) {
  return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

float shaped(float level) {
  return smoothstep(0.42, 0.95, level);
}

float band(float x) {
  return shaped(texture(uBands, vec2(x, 0.5)).r);
}

float wave(float x) {
  return texture(uWave, vec2(x, 0.5)).r;
}

float line(float distance, float halfWidth) {
  float f = fwidth(distance);
  return 1.0 - smoothstep(halfWidth - f, halfWidth + f, abs(distance));
}

vec3 cover(vec2 uv) {
  return texture(uCover, vec2(uv.x, 1.0 - uv.y)).rgb;
}

vec3 coverSoft(vec2 uv, float lod) {
  const float r = 0.03;
  uv.y = 1.0 - uv.y;
  vec3 sum = textureLod(uCover, uv, lod).rgb * 0.36;
  sum += textureLod(uCover, uv + vec2(r, r), lod).rgb * 0.16;
  sum += textureLod(uCover, uv + vec2(-r, r), lod).rgb * 0.16;
  sum += textureLod(uCover, uv + vec2(r, -r), lod).rgb * 0.16;
  sum += textureLod(uCover, uv + vec2(-r, -r), lod).rgb * 0.16;
  return sum;
}

vec2 imageFill(vec2 uv) {
  float frame = uResolution.x / uResolution.y;
  vec2 scale = frame < uImageAspect ? vec2(frame / uImageAspect, 1.0) : vec2(1.0, uImageAspect / frame);
  vec2 q = (uv - 0.5) * scale + 0.5;
  return vec2(q.x, 1.0 - q.y);
}

vec3 imageAt(vec2 uv, float lod) {
  return textureLod(uImage, imageFill(uv), lod).rgb;
}

vec3 inkOr(vec3 own) {
  return mix(own, uInk, uInkOn);
}

float textAt(vec2 uv) {
  return texture(uText, vec2(uv.x, 1.0 - uv.y)).a;
}

float bandSmooth(float x) {
  float sum = 0.0;
  for (int i = -2; i <= 2; i++) sum += texture(uBands, vec2(x + float(i) * 0.012, 0.5)).r * (3.0 - abs(float(i)));
  return shaped(sum / 9.0);
}
`;
