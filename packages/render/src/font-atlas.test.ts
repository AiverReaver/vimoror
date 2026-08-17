/**
 * font-atlas.ts's pure half only — UV/grid math, no FontFace/canvas.
 * Covers exactly what docs/M1-PLAN.md's Testing section calls for: index
 * math plus the column-wrap boundary.
 */

import { describe, expect, it } from 'vitest';

import {
  ATLAS_COLS,
  ATLAS_FIRST_CHAR_CODE,
  ATLAS_GLYPH_COUNT,
  ATLAS_LAST_CHAR_CODE,
  atlasDimensions,
  atlasRectFor,
} from './font-atlas.ts';

describe('atlasRectFor', () => {
  it('places the first glyph (space) at the atlas origin', () => {
    expect(atlasRectFor(ATLAS_FIRST_CHAR_CODE, 10, 20)).toEqual({ x: 0, y: 0, width: 10, height: 20 });
  });

  it('walks across a row before wrapping', () => {
    const code = ATLAS_FIRST_CHAR_CODE + 3;
    expect(atlasRectFor(code, 10, 20, 8)).toEqual({ x: 30, y: 0, width: 10, height: 20 });
  });

  it('wraps to the next row exactly at atlasCols', () => {
    const lastOfRow = atlasRectFor(ATLAS_FIRST_CHAR_CODE + 7, 10, 20, 8);
    const firstOfNextRow = atlasRectFor(ATLAS_FIRST_CHAR_CODE + 8, 10, 20, 8);
    expect(lastOfRow).toEqual({ x: 70, y: 0, width: 10, height: 20 });
    expect(firstOfNextRow).toEqual({ x: 0, y: 20, width: 10, height: 20 });
  });

  it('places the last glyph using the default atlasCols', () => {
    const index = ATLAS_GLYPH_COUNT - 1;
    const expectedCol = index % ATLAS_COLS;
    const expectedRow = Math.floor(index / ATLAS_COLS);
    expect(atlasRectFor(ATLAS_LAST_CHAR_CODE, 10, 20)).toEqual({
      x: expectedCol * 10,
      y: expectedRow * 20,
      width: 10,
      height: 20,
    });
  });

  it('falls back to slot 0 for a charCode outside the baked range, rather than throwing', () => {
    expect(atlasRectFor(0x00, 10, 20)).toEqual({ x: 0, y: 0, width: 10, height: 20 });
    expect(atlasRectFor(ATLAS_LAST_CHAR_CODE + 1, 10, 20)).toEqual({ x: 0, y: 0, width: 10, height: 20 });
  });
});

describe('atlasDimensions', () => {
  it('sizes the atlas to exactly fit every glyph with no partial trailing row uncounted', () => {
    const { width, height } = atlasDimensions(10, 20, 8);
    const rows = Math.ceil(ATLAS_GLYPH_COUNT / 8);
    expect(width).toBe(8 * 10);
    expect(height).toBe(rows * 20);
  });

  it('the default ATLAS_COLS is a near-square grid that fits all 95 glyphs', () => {
    expect(ATLAS_COLS * ATLAS_COLS).toBeGreaterThanOrEqual(ATLAS_GLYPH_COUNT);
    const { width, height } = atlasDimensions(1, 1);
    expect(width * height).toBeGreaterThanOrEqual(ATLAS_GLYPH_COUNT);
  });
});
