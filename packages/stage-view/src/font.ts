/**
 * The one font atlas this page will ever bake, and the cell geometry both apps
 * measure against.
 *
 * Lifted out of `apps/editor/src/grid-pane.tsx` when the runner became the
 * second consumer — the seam that file's header named, arriving as a module
 * rather than as a second copy. It matters that it is one copy: both failure
 * modes below were found on real hardware at M3 Wave B, and a second inlined
 * memo is a second place to re-learn them.
 *
 * **Baked once per page, not per mount.** Every `bakeFontAtlas` call constructs
 * a fresh `FontFace`, adds it to `document.fonts` (a set of OBJECTS, so the
 * duplicate is kept, never replaced) and allocates an `OffscreenCanvas` — none
 * of which is ever released. Under `StrictMode`'s deliberate double-invoke that
 * is two of each on the first mount alone.
 *
 * **The memo is CLEARED on failure.** Caching a rejected promise would make one
 * missing font file permanent for the life of the page: `bakeFontAtlas` awaits
 * `font.load()`, so a moved or unshipped woff2 rejects, and without the reset a
 * remount would replay the same rejection forever.
 *
 * One LOGICAL geometry, shared, because "what you author is exactly what ships"
 * is a claim about the atlas and the cell size as much as about the glyph grid.
 * `CELL_W`/`CELL_H` are that geometry in CSS pixels and never change; `scale`
 * below is how many device pixels one of them is baked at.
 *
 * **`scale` exists because a device-pixel-ratio canvas cannot be got any other
 * way, which is not what M4-PLAN.md's fact 4 says.** That fact prescribes
 * "sizes the canvas at `cells × cellSize × devicePixelRatio`, calls
 * `renderer.resize()`" — measured against `GlyphGrid.#drawCell`, which blits
 * every cell at `atlas.cellW`x`atlas.cellH` and nothing else, that draws a 1x
 * frame into a 2x buffer and leaves three quarters of the canvas blank. The
 * scale has to reach the ATLAS, so the grid's own cells really are device
 * pixels; the visible canvas then takes its CSS box from `CELL_W`x`CELL_H` and
 * its backing store from `atlas.cellW`x`atlas.cellH`.
 *
 * Memoised per scale rather than once, keeping both semantics above intact —
 * and integer scales only, because a fractional cell size puts every glyph blit
 * on a fractional pixel boundary, which is the blur the whole exercise exists to
 * remove. A 1.5x display therefore renders at 2x and downsamples, which is
 * sharper than 1x either way. There are at most three entries.
 */

import { bakeFontAtlas, type FontAtlas } from '@vimorror/render';

export const CELL_W = 9;
export const CELL_H = 18;
const FONT_SIZE_PX = 15;

/** 3x covers every shipping display; past it the atlas grows for nothing. */
const MAX_SCALE = 3;

/**
 * Render's woff2 is not in its package `exports`, so it is reached by path —
 * exactly as `packages/render/demo/main.ts` reaches it. Vite rewrites the URL
 * and serves the file from outside any app root on its own.
 */
const FONT_URL = new URL('../../render/assets/fonts/JetBrainsMono-Regular.woff2', import.meta.url).href;

const atlasOnce = new Map<number, Promise<FontAtlas>>();

/** The integer device-pixel scale to bake at, from a `devicePixelRatio`. */
export function atlasScaleFor(devicePixelRatio: number): number {
  const rounded = Math.round(devicePixelRatio);
  return Number.isFinite(rounded) ? Math.min(MAX_SCALE, Math.max(1, rounded)) : 1;
}

export function getFontAtlas(scale = 1): Promise<FontAtlas> {
  const key = atlasScaleFor(scale);
  let once = atlasOnce.get(key);
  if (once === undefined) {
    once = bakeFontAtlas(FONT_URL, CELL_W * key, CELL_H * key, FONT_SIZE_PX * key).catch((e: unknown) => {
      atlasOnce.delete(key);
      throw e;
    });
    atlasOnce.set(key, once);
  }
  return once;
}
