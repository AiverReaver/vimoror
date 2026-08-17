/**
 * Pure data types for the glyph-grid renderer. Zero DOM/canvas/GPU-API types —
 * Wave A's done-line is a repo-wide typecheck with no canvas code in the
 * tree yet, so nothing in here may reach for the 2D canvas context type,
 * `ImageBitmap`, or similar.
 */

/** A single grid cell. `glitch` is unused until M2's director wires it up. */
export type Cell = {
  char: string;
  fg: string;
  bg: string;
  glitch?: number;
};

/**
 * A row-major grid of `Cell`, index = `row * width + col`. Deliberately
 * mutable-friendly, not immutable like vim-core's style — this runs once
 * per frame over ~4,000 cells with no undo/replay consumer, so
 * structural-copy immutability would just be wasted allocation.
 */
export type CellBuffer = {
  width: number;
  height: number;
  cells: Cell[];
};

/**
 * The viewport window. This exact shape is load-bearing: `docs/CHECKLIST.md`
 * already specifies `{topline, height}` as what vim-core's future `H`/`M`/`L`
 * motions will consume from here. Don't add fields or restructure this.
 */
export type Camera = {
  readonly topline: number;
  readonly height: number;
  readonly width: number;
};

/** The mode -> shape mapping lives in cursor-shape.ts, not here. */
export type CursorShape = 'block' | 'bar' | 'underline' | 'hollow-block';

/** A pixel/UV rectangle locating a glyph in the font atlas texture. */
export type Rect = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};
