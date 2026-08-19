/**
 * The viewport clip: buffer plus live entities, into the one `CellBuffer` the
 * renderer draws.
 *
 * Pure, and split out of `runner.tsx` for the reason M4-PLAN.md states as the
 * whole file breakdown — *pure modules that vitest can hold, thin React
 * components the browser verifies* — but also for a specific one. **No shipped
 * stage scrolls.** All four fit inside their own viewport, so `topline` is 0 in
 * every run a person can play today, and the entity shift below is the one piece
 * of Wave B that a browser playtest cannot reach. It is also the piece whose
 * failure is silent: an unshifted entity still draws, still tints, still reads as
 * a wall — on the wrong row.
 *
 * `DrawArgs.cells` is documented "already clipped to the viewport by the caller —
 * one row per `camera` row", and that contract has three halves, not one:
 *
 * 1. **Exactly `camera.height` rows**, padded with blanks past the end of the
 *    buffer — `linesToCells` sizes the buffer from what it is given, so a short
 *    stage would otherwise produce a canvas that changes height as lines appear.
 * 2. **Every row sliced AND padded to `camera.width`.** Padding alone is not
 *    enough: a line the player has grown past the frame would widen
 *    `stageCells`'s own longest-line measurement and resize the canvas mid-play.
 * 3. **Entities shifted by `topline`**, because `stageCells` indexes them against
 *    the lines array it is handed rather than against the buffer.
 *
 * The cursor is NOT clipped here and must not be: `pipeline.ts` maps it through
 * `bufferPosToScreen` itself, so it travels in buffer space and a second
 * translation would double-count `topline`.
 */

import type { Pos } from '@vimorror/core';
import type { Entity, Stage } from '@vimorror/game';
import { stageCells } from '@vimorror/stage-view';
import type { Camera, CellBuffer } from '@vimorror/render';

/**
 * A floor, so a one-line stage is a terminal rather than a sliver, and a ceiling
 * on the rows so a tall buffer scrolls instead of growing the canvas. Both are
 * frame geometry, not content — a stage taller than its viewport is what
 * `followCursor` is for.
 */
export const MIN_COLS = 64;
export const MIN_ROWS = 8;
export const MAX_ROWS = 24;

/**
 * The same ceiling `stage-cells.ts` documents at length — a hand-edited `col`
 * once made `padEnd` throw `RangeError: Invalid string length` and set
 * `canvas.width` past the 65535 a browser accepts. Repeated rather than imported
 * because that one is private to the module owning the cell buffer, and this is
 * the other place a frame width gets chosen. A parsed stage cannot reach it
 * through an ENTITY (`schema.ts` refuses one outside the buffer), but nothing
 * stops an author from writing a 10,000-character line.
 */
export const MAX_COLS = 512;

/**
 * The frame, fixed for the whole run so the canvas is sized once.
 *
 * `longest + 1` rather than `longest` for the reason `stage-cells.ts` widens by
 * one: the schema admits `col === line.length` as a real position, and a frame
 * exactly as wide as its longest line has no cell to tint there. Deciding it up
 * front is what keeps `stageCells`'s own width calculation still — every row is
 * cut to `cols`, so the longest line it ever sees is `cols` whatever the player
 * types.
 */
export function frameGeometry(stage: Pick<Stage, 'buffer'>): { readonly cols: number; readonly rows: number } {
  const longest = stage.buffer.reduce((max, line) => Math.max(max, line.length), 0);
  return {
    cols: Math.min(MAX_COLS, Math.max(MIN_COLS, longest + 1)),
    rows: Math.min(MAX_ROWS, Math.max(MIN_ROWS, stage.buffer.length + 2)),
  };
}

/** Exactly `camera.height` rows, each exactly `camera.width` columns. */
export function viewportLines(lines: readonly string[], camera: Camera): string[] {
  const out: string[] = [];
  for (let row = 0; row < camera.height; row += 1) {
    out.push((lines[camera.topline + row] ?? '').slice(0, camera.width).padEnd(camera.width, ' '));
  }
  return out;
}

/**
 * Buffer space to frame space.
 *
 * **A rectangle straddling the top edge has its anchor clamped to row 0, and
 * that is a fix rather than a convenience.** `stage-cells.ts`'s `drawable` filter
 * refuses a negative `at.line` outright — its `isIndex` requires `n >= 0` — so
 * the obvious implementation (subtract `topline`, hand it over) makes a wall
 * spanning buffer rows 4–7 disappear completely at `topline: 6` instead of
 * clipping to the two rows the player can see. An invisible wall the cursor
 * cannot pass is the worst failure this module has available, and it is silent:
 * measured, not reasoned about, by the test that now pins it.
 *
 * Clamping moves the GLYPH to the topmost visible row, which is a real change to
 * what is drawn and the right one: the glyph is the "never colour alone"
 * redundant marker, so a wall continuing off-screen keeps saying `#` to a player
 * who cannot see the tint. A SINGLE-cell entity is deliberately not clamped — one
 * scrolled above the frame must vanish, not stick to the top row — and neither is
 * a rectangle lying wholly above it.
 *
 * Nothing is filtered: a rectangle straddling the BOTTOM edge already clips for
 * free, since `occupies` is only ever asked about rows inside the frame.
 *
 * The conditional spread is `exactOptionalPropertyTypes`, and it is load-bearing
 * beyond the types: `occupies` branches on `to === undefined` to decide
 * single-cell versus rectangle, so an entity that grew an explicit `undefined`
 * would still work while the distinction itself must survive the map.
 */
export function shiftEntities(entities: readonly Entity[], topline: number): readonly Entity[] {
  if (topline === 0) return entities;
  const shift = (pos: Pos): Pos => ({ line: pos.line - topline, col: pos.col });
  return entities.map((entity) => {
    const at = shift(entity.at);
    if (entity.to === undefined) return { ...entity, at };
    const to = shift(entity.to);
    return { ...entity, at: to.line < 0 ? at : { line: Math.max(0, at.line), col: at.col }, to };
  });
}

/** The whole clip, in one call: what the runner hands to `renderer.draw`. */
export function frameCells(
  lines: readonly string[],
  entities: readonly Entity[],
  camera: Camera,
): CellBuffer {
  return stageCells(viewportLines(lines, camera), shiftEntities(entities, camera.topline));
}
