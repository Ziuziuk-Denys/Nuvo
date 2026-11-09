const VERTEX = `#version 300 es
in vec2 position;
out vec2 uv;
void main() {
  uv = position * 0.5 + 0.5;
  gl_Position = vec4(position, 0.0, 1.0);
}`;

const FRAGMENT = `#version 300 es
precision highp float;
in vec2 uv;
out vec4 color;
uniform sampler2D current;
uniform sampler2D previous;
uniform float blend;
uniform float time;
uniform vec2 aspect;

const float ZOOM = 1.35;

vec2 flow(vec2 p, float t) {
  vec2 wide = vec2(sin(p.y * 2.3 + t * 0.23), cos(p.x * 2.9 - t * 0.19));
  vec2 fine = vec2(sin((p.y + wide.x * 0.4) * 4.7 - t * 0.13), cos((p.x + wide.y * 0.4) * 4.1 + t * 0.16));
  return p + wide * 0.18 + fine * 0.06;
}

vec3 soft(sampler2D image, vec2 p) {
  const float r = 0.02;
  vec3 sum = texture(image, p).rgb * 0.36;
  sum += texture(image, p + vec2(r, r)).rgb * 0.16;
  sum += texture(image, p + vec2(-r, r)).rgb * 0.16;
  sum += texture(image, p + vec2(r, -r)).rgb * 0.16;
  sum += texture(image, p + vec2(-r, -r)).rgb * 0.16;
  return sum;
}

void main() {
  float angle = sin(time * 0.053) * 0.6;
  mat2 turn = mat2(cos(angle), -sin(angle), sin(angle), cos(angle));
  vec2 p = flow(turn * ((uv - 0.5) * aspect / ZOOM) + 0.5, time);
  vec3 c = mix(soft(previous, p), soft(current, p), blend);
  c = mix(vec3(dot(c, vec3(0.299, 0.587, 0.114))), c, 1.15);
  float corner = smoothstep(0.3, 1.4, length((uv - 0.5) * 2.0));
  color = vec4(c * mix(1.0, 0.94, corner), 1.0);
}`;

/** The cover is drawn this small; the blur and the flow hide everything finer. */
const TEXTURE_PX = 64;

export interface FlowRenderer {
  setCover(image: TexImageSource, fadeMs?: number): boolean;
  settle(): void;
  draw(timeMs: number): void;
  resize(width: number, height: number): void;
  dispose(): void;
}

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  return gl.getShaderParameter(shader, gl.COMPILE_STATUS) ? shader : null;
}

function createTexture(gl: WebGL2RenderingContext): WebGLTexture | null {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.MIRRORED_REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.MIRRORED_REPEAT);
  return texture;
}

export function createFlowRenderer(canvas: HTMLCanvasElement): FlowRenderer | null {
  const gl = canvas.getContext("webgl2", { antialias: false, alpha: false, depth: false, powerPreference: "low-power" });
  if (!gl) return null;
  const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT);
  const program = gl.createProgram();
  if (!vertex || !fragment || !program) return null;
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
  gl.useProgram(program);

  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, "position");
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

  let current = createTexture(gl);
  let previous = createTexture(gl);
  gl.uniform1i(gl.getUniformLocation(program, "current"), 0);
  gl.uniform1i(gl.getUniformLocation(program, "previous"), 1);
  const timeAt = gl.getUniformLocation(program, "time");
  const aspectAt = gl.getUniformLocation(program, "aspect");
  const blendAt = gl.getUniformLocation(program, "blend");
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);

  const small = document.createElement("canvas");
  small.width = TEXTURE_PX;
  small.height = TEXTURE_PX;
  const smallContext = small.getContext("2d");
  const origin = performance.now();
  let hasCover = false;
  let fadeFrom = 0;
  let fadeMs = 0;

  return {
    setCover(image, fade = 0) {
      if (!smallContext) return false;
      [current, previous] = [previous, current];
      try {
        // drawn past the edges so the blur has no dark rim
        const bleed = TEXTURE_PX / 8;
        smallContext.filter = `blur(${TEXTURE_PX / 32}px)`;
        smallContext.drawImage(image as CanvasImageSource, -bleed, -bleed, TEXTURE_PX + bleed * 2, TEXTURE_PX + bleed * 2);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, current);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, small);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, previous);
        if (!hasCover) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, small);
      } catch {
        // a cross-origin cover taints the canvas and the upload throws; the old cover stays
        [current, previous] = [previous, current];
        return false;
      }
      fadeMs = hasCover ? fade : 0;
      fadeFrom = performance.now();
      hasCover = true;
      return true;
    },
    settle() {
      fadeMs = 0;
    },
    draw(timeMs) {
      const blend = fadeMs > 0 ? Math.min(1, Math.max(0, (timeMs - fadeFrom) / fadeMs)) : 1;
      gl.uniform1f(blendAt, blend);
      gl.uniform1f(timeAt, (timeMs - origin) / 1000);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    },
    resize(width, height) {
      canvas.width = Math.max(1, Math.round(width));
      canvas.height = Math.max(1, Math.round(height));
      gl.viewport(0, 0, canvas.width, canvas.height);
      const long = Math.max(canvas.width, canvas.height);
      gl.uniform2f(aspectAt, canvas.width / long, canvas.height / long);
    },
    dispose() {
      gl.deleteTexture(current);
      gl.deleteTexture(previous);
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
    },
  };
}
