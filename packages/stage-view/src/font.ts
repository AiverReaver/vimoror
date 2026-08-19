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
 * One geometry, shared, because "what you author is exactly what ships" is a
 * claim about the atlas and the cell size as much as about the glyph grid. A
 * caller that wants a different cell size wants a different atlas, and can take
 * `bakeFontAtlas` directly — nothing here stops it.
 */

import { bakeFontAtlas, type FontAtlas } from '@vimorror/render';

export const CELL_W = 9;
export const CELL_H = 18;
const FONT_SIZE_PX = 15;

/**
 * Render's woff2 is not in its package `exports`, so it is reached by path —
 * exactly as `packages/render/demo/main.ts` reaches it. Vite rewrites the URL
 * and serves the file from outside any app root on its own.
 */
const FONT_URL = new URL('../../render/assets/fonts/JetBrainsMono-Regular.woff2', import.meta.url).href;

let atlasOnce: Promise<FontAtlas> | undefined;

export function getFontAtlas(): Promise<FontAtlas> {
  atlasOnce ??= bakeFontAtlas(FONT_URL, CELL_W, CELL_H, FONT_SIZE_PX).catch((e: unknown) => {
    atlasOnce = undefined;
    throw e;
  });
  return atlasOnce;
}
