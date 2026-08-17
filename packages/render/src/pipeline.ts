/**
 * The public façade — render's `engine.ts`-equivalent. Owns the glyph grid, an
 * offscreen 2D canvas for it to draw into, and whichever post-FX path this
 * machine can run.
 *
 * A canvas can only ever hand out ONE context type, which is what forces the
 * two-canvas split: the caller's visible canvas becomes the WebGL2 surface (or
 * the fallback's 2D blit target), and the glyph grid gets a private 2D canvas
 * of the same size that the post-FX pass samples as a texture.
 */

import type { Mode, Pos } from '@vimorror/core';

import { bufferPosToScreen } from './camera.ts';
import { createCanvasFallback } from './canvas-fallback.ts';
import { createCrtPass } from './crt-shader.ts';
import { cursorShapeForMode } from './cursor-shape.ts';
import type { FontAtlas } from './font-atlas.ts';
import { GlyphGrid } from './glyph-grid.ts';
import type { Camera, CellBuffer } from './types.ts';

/** What `crt-shader.ts` and `canvas-fallback.ts` both structurally satisfy. */
export type PostFx = {
  readonly kind: 'webgl2' | 'fallback';
  present(source: HTMLCanvasElement, intensity: number, timeSec: number): void;
  resize(width: number, height: number): void;
  dispose(): void;
};

export type RendererOptions = {
  readonly atlas: FontAtlas;
  /** Take the fallback path even where WebGL2 is available (demo/comparison). */
  readonly forceFallback?: boolean;
};

export type DrawArgs = {
  /** Already clipped to the viewport by the caller — one row per `camera` row. */
  readonly cells: CellBuffer;
  readonly camera: Camera;
  readonly cursor: { readonly pos: Pos; readonly mode: Mode };
  /**
   * 0..1, wired end-to-end to the shader uniform. Never defaulted here: this
   * is MergedPlan's "wired from day one" knob, and deciding its value (or a
   * `prefers-reduced-motion` policy) is M4's comfort-settings layer, not this
   * one's.
   */
  readonly effectsIntensity: number;
};

export type Renderer = {
  /** Which post-FX path was actually taken, after the WebGL2 probe. */
  readonly kind: 'webgl2' | 'fallback';
  draw(args: DrawArgs): void;
  resize(width: number, height: number): void;
  dispose(): void;
};

export function createRenderer(canvas: HTMLCanvasElement, options: RendererOptions): Renderer {
  const { atlas, forceFallback = false } = options;

  const gridCanvas = document.createElement('canvas');
  gridCanvas.width = canvas.width;
  gridCanvas.height = canvas.height;
  const grid = new GlyphGrid(gridCanvas, atlas.cellW, atlas.cellH);

  // Deliberately no context attributes. `{alpha: false}` looks like a free win
  // here and silently kills phosphor persistence: the drawing buffer then has
  // no alpha channel to source, so `crt-shader.ts`'s `copyTexSubImage2D` into
  // the RGBA8 accumulator raises INVALID_OPERATION (measured — default attrs
  // copy fine, `{alpha: false}` does not) and the accumulator stays black. The
  // shader writes alpha 1.0 everywhere, so the canvas composites opaque anyway.
  const gl = forceFallback ? null : canvas.getContext('webgl2');
  const post: PostFx = gl ? createCrtPass(gl) : createCanvasFallback(canvas);

  return {
    kind: post.kind,

    draw({ cells, camera, cursor, effectsIntensity }) {
      grid.render(cells, atlas, {
        pos: bufferPosToScreen(camera, cursor.pos),
        shape: cursorShapeForMode(cursor.mode),
      });
      post.present(gridCanvas, effectsIntensity, performance.now() / 1000);
    },

    resize(width, height) {
      canvas.width = width;
      canvas.height = height;
      gridCanvas.width = width;
      gridCanvas.height = height;
      // Assigning `width` blanks the 2D canvas, so the grid's dirty-cell cache
      // now describes pixels that are gone.
      grid.invalidate();
      post.resize(width, height);
    },

    dispose() {
      post.dispose();
    },
  };
}
