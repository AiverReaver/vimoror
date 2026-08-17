/**
 * WebGL2 CRT post-FX. One fullscreen pass over the glyph-grid canvas doing
 * curvature, chromatic aberration, scanlines, vignette, glitch and phosphor
 * persistence — every one of them multiplied by a single 0..1 intensity, so
 * intensity 0 samples the grid texture at exact texel centres with nothing
 * added and is a straight blit (M1-PLAN's Wave D done-line: "intensity=0 on
 * WebGL2 visually ~= the fallback").
 *
 * Impure (GPU), so manual/visual-verified only, per M1-PLAN's testing split.
 */

/** Fullscreen triangle from `gl_VertexID` alone — no VBO, no attributes. */
const VERT_SRC = `#version 300 es
out vec2 v_uv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  v_uv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const FRAG_SRC = `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_grid;       // this frame's glyph-grid canvas
uniform sampler2D u_prev;       // last frame's own output (the phosphor accumulator)
uniform float u_time;           // seconds
uniform float u_intensity;      // 0..1, scales every effect to identity at 0
uniform vec2 u_resolution;      // drawing-buffer pixels

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

void main() {
  float k = clamp(u_intensity, 0.0, 1.0);

  // Glitch: a few horizontal bands slip sideways, reshuffled 12x/sec. Bands
  // are picked by a hash of (band, tick) so which ones tear keeps changing
  // without needing any CPU-side state.
  float tick = floor(u_time * 12.0);
  float band = floor(v_uv.y * 48.0);
  float slip = step(0.93, hash(vec2(band, tick)))
             * (hash(vec2(tick, band)) - 0.5) * 0.06 * k;

  // Barrel curvature, in centred [-1,1] space.
  vec2 c = vec2(v_uv.x + slip, v_uv.y) * 2.0 - 1.0;
  c *= 1.0 + (0.18 * k) * vec2(c.y * c.y, c.x * c.x);
  vec2 uv = c * 0.5 + 0.5;

  // Off the curved tube face is bezel, not clamped edge pixels smeared out.
  vec3 cur = vec3(0.0);
  if (uv.x >= 0.0 && uv.x <= 1.0 && uv.y >= 0.0 && uv.y <= 1.0) {
    // Chromatic aberration: R and B sampled off-axis, G on-axis.
    float ab = 0.0035 * k;
    cur = vec3(
      texture(u_grid, uv + vec2(ab, 0.0)).r,
      texture(u_grid, uv).g,
      texture(u_grid, uv - vec2(ab, 0.0)).b
    );

    float scan = 1.0 - 0.28 * k * (0.5 + 0.5 * sin(uv.y * u_resolution.y * 3.14159265));
    vec2 d = uv - 0.5;
    float vignette = 1.0 - 1.1 * k * dot(d, d);
    cur *= scan * vignette;
  }

  // Phosphor persistence. The accumulator is last frame's FINAL output and is
  // sampled at the plain screen uv, not the curved one — so the trail decays
  // in place instead of re-warping itself a little further every frame.
  vec3 prev = texture(u_prev, v_uv).rgb * (0.72 * k);
  fragColor = vec4(max(cur, prev), 1.0);
}`;

export type CrtPass = {
  readonly kind: 'webgl2';
  present(source: HTMLCanvasElement, intensity: number, timeSec: number): void;
  resize(width: number, height: number): void;
  dispose(): void;
};

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('WebGL2 createShader returned null');
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`CRT shader compile failed: ${log}`);
  }
  return shader;
}

function createTexture(gl: WebGL2RenderingContext): WebGLTexture {
  const tex = gl.createTexture();
  if (!tex) throw new Error('WebGL2 createTexture returned null');
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  return tex;
}

export function createCrtPass(gl: WebGL2RenderingContext): CrtPass {
  const vert = compile(gl, gl.VERTEX_SHADER, VERT_SRC);
  const frag = compile(gl, gl.FRAGMENT_SHADER, FRAG_SRC);
  const program = gl.createProgram();
  if (!program) throw new Error('WebGL2 createProgram returned null');
  gl.attachShader(program, vert);
  gl.attachShader(program, frag);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(`CRT program link failed: ${gl.getProgramInfoLog(program)}`);
  }
  // Linked; the shader objects themselves are no longer needed.
  gl.deleteShader(vert);
  gl.deleteShader(frag);

  const uGrid = gl.getUniformLocation(program, 'u_grid');
  const uPrev = gl.getUniformLocation(program, 'u_prev');
  const uTime = gl.getUniformLocation(program, 'u_time');
  const uIntensity = gl.getUniformLocation(program, 'u_intensity');
  const uResolution = gl.getUniformLocation(program, 'u_resolution');

  const gridTex = createTexture(gl);
  const prevTex = createTexture(gl);

  // The glyph-grid canvas is top-down; GL texture space is bottom-up. Flipping
  // on upload puts it in the same orientation the accumulator arrives in
  // (copied straight off the framebuffer), so one uv convention serves both.
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);

  let width = 0;
  let height = 0;

  function resize(nextWidth: number, nextHeight: number): void {
    width = nextWidth;
    height = nextHeight;
    gl.viewport(0, 0, width, height);
    // Reallocated (not sub-copied) so it is zero-filled: a fresh accumulator
    // must be black, or frame one blends against garbage.
    gl.bindTexture(gl.TEXTURE_2D, prevTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  }

  resize(gl.drawingBufferWidth, gl.drawingBufferHeight);

  return {
    kind: 'webgl2',

    present(source, intensity, timeSec) {
      gl.bindTexture(gl.TEXTURE_2D, gridTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);

      gl.useProgram(program);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, gridTex);
      gl.uniform1i(uGrid, 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, prevTex);
      gl.uniform1i(uPrev, 1);
      gl.uniform1f(uTime, timeSec);
      gl.uniform1f(uIntensity, intensity);
      gl.uniform2f(uResolution, width, height);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      // ponytail: the accumulator is copied straight off the default
      // framebuffer rather than kept in an FBO ping-pong — two textures and
      // one pass instead of two FBOs, two programs and a swap. Valid because
      // the copy happens in the same task as the draw, before the browser
      // composites. Move to FBOs if the persistence pass ever needs to run at
      // a different resolution than the canvas.
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, prevTex);
      gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 0, 0, width, height);
    },

    resize,

    dispose() {
      gl.deleteTexture(gridTex);
      gl.deleteTexture(prevTex);
      gl.deleteProgram(program);
    },
  };
}
