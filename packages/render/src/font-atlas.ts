/**
 * Font atlas: printable ASCII (0x20-0x7E, 95 glyphs — no accents, no
 * box-drawing, no bold/italic until content needs them) baked from JetBrains
 * Mono into an OffscreenCanvas, plus the pure grid math to find a glyph's
 * rect inside it.
 *
 * Font: `assets/fonts/JetBrainsMono-Regular.woff2`, JetBrains Mono v2.304
 * (github.com/JetBrains/JetBrainsMono), licensed OFL-1.1 — see
 * `assets/fonts/OFL.txt`.
 */

import type { Rect } from './types.ts';

export const ATLAS_FIRST_CHAR_CODE = 0x20;
export const ATLAS_LAST_CHAR_CODE = 0x7e;
export const ATLAS_GLYPH_COUNT = ATLAS_LAST_CHAR_CODE - ATLAS_FIRST_CHAR_CODE + 1;

/** Columns per row: a near-square grid for 95 glyphs (10x10, 5 slots unused). */
export const ATLAS_COLS = Math.ceil(Math.sqrt(ATLAS_GLYPH_COUNT));

/** Pixel size of the atlas canvas needed to hold every glyph at `cellW`x`cellH`. */
export function atlasDimensions(
  cellW: number,
  cellH: number,
  atlasCols: number = ATLAS_COLS,
): { width: number; height: number } {
  const rows = Math.ceil(ATLAS_GLYPH_COUNT / atlasCols);
  return { width: atlasCols * cellW, height: rows * cellH };
}

/**
 * The pixel rect of `charCode`'s glyph inside the atlas. A code outside the
 * baked range falls back to slot 0 (space) rather than throwing — an unbaked
 * char is a caller bug, not worth crashing a render frame over.
 */
export function atlasRectFor(
  charCode: number,
  cellW: number,
  cellH: number,
  atlasCols: number = ATLAS_COLS,
): Rect {
  const inRange = charCode >= ATLAS_FIRST_CHAR_CODE && charCode <= ATLAS_LAST_CHAR_CODE;
  const index = inRange ? charCode - ATLAS_FIRST_CHAR_CODE : 0;
  const col = index % atlasCols;
  const row = Math.floor(index / atlasCols);
  return { x: col * cellW, y: row * cellH, width: cellW, height: cellH };
}

export type FontAtlas = {
  readonly canvas: OffscreenCanvas;
  readonly cellW: number;
  readonly cellH: number;
  readonly atlasCols: number;
};

/**
 * Loads `fontUrl` (the vendored woff2) and renders every printable-ASCII
 * glyph into an `OffscreenCanvas` grid laid out by `atlasRectFor`. Caller
 * picks `cellW`/`cellH`/`fontSizePx` (font metrics are a rendering policy,
 * not this module's job) and owns the resulting canvas.
 */
export async function bakeFontAtlas(
  fontUrl: string,
  cellW: number,
  cellH: number,
  fontSizePx: number,
): Promise<FontAtlas> {
  const font = new FontFace('JetBrains Mono', `url(${fontUrl})`);
  await font.load();
  document.fonts.add(font);

  const atlasCols = ATLAS_COLS;
  const { width, height } = atlasDimensions(cellW, cellH, atlasCols);
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('OffscreenCanvas 2D context unavailable');

  ctx.font = `${fontSizePx}px "JetBrains Mono"`;
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#ffffff';

  for (let code = ATLAS_FIRST_CHAR_CODE; code <= ATLAS_LAST_CHAR_CODE; code += 1) {
    const rect = atlasRectFor(code, cellW, cellH, atlasCols);
    ctx.fillText(String.fromCharCode(code), rect.x, rect.y);
  }

  return { canvas, cellW, cellH, atlasCols };
}
