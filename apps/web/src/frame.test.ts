/**
 * The viewport clip. Most of what is below covers something a browser playtest of
 * Wave B cannot reach, which is why it exists:
 *
 * - **No shipped stage has a rectangle taller than one row**, so none of them can
 *   straddle a scroll boundary — the clamp is unreachable by hand until an author
 *   draws a two-row wall, and its failure mode is the entity vanishing rather
 *   than moving. (The plain shift, by contrast, IS reachable: see `frame.ts`.)
 * - **No shipped stage is wider than `MIN_COLS`**, so the `longest + 1` widening
 *   and the truncation both only bite on content that does not exist yet.
 * - **The canvas-stability property is invisible when broken.** A frame whose
 *   width moves resizes the canvas mid-play; it renders correctly either way, it
 *   just blanks and redraws every cell on the frames where it happens.
 */

import type { Camera } from '@vimorror/render';
import type { Entity } from '@vimorror/game';
import { describe, expect, it } from 'vitest';

import { frameCells, frameGeometry, MAX_COLS, MAX_ROWS, MIN_COLS, MIN_ROWS, shiftEntities, viewportLines } from './frame.ts';

const wall = (at: { line: number; col: number }, to?: { line: number; col: number }): Entity => ({
  id: 'w',
  kind: 'wall',
  glyph: '#',
  at,
  ...(to === undefined ? {} : { to }),
});

const camera = (topline: number, height = MIN_ROWS, width = MIN_COLS): Camera => ({ topline, height, width });

describe('frameGeometry sizes the frame once, from the stage', () => {
  it('holds the floor for a stage smaller than it', () => {
    expect(frameGeometry({ buffer: ['world'] })).toEqual({ cols: MIN_COLS, rows: MIN_ROWS });
  });

  it('widens by one past the longest line, for the end-of-line cell', () => {
    // The schema admits `col === line.length`; a frame exactly `longest` wide has
    // no cell there to tint, which is the same reason `stage-cells.ts` widens.
    const longest = 'x'.repeat(MIN_COLS + 10);
    expect(frameGeometry({ buffer: [longest] }).cols).toBe(MIN_COLS + 11);
  });

  it('caps both dimensions', () => {
    const absurd = { buffer: ['x'.repeat(50_000), ...Array.from({ length: 200 }, () => '')] };
    expect(frameGeometry(absurd)).toEqual({ cols: MAX_COLS, rows: MAX_ROWS });
  });

  it('grows rows with the buffer, plus headroom', () => {
    const buffer = Array.from({ length: MIN_ROWS + 5 }, (_, i) => `line ${i}`);
    expect(frameGeometry({ buffer }).rows).toBe(MIN_ROWS + 7);
  });
});

describe('viewportLines produces exactly the camera window', () => {
  it('is height rows of width columns, whatever the buffer is', () => {
    const lines = viewportLines(['a', 'bb'], camera(0));
    expect(lines).toHaveLength(MIN_ROWS);
    expect(new Set(lines.map((l) => l.length))).toEqual(new Set([MIN_COLS]));
    expect(lines[0]?.trimEnd()).toBe('a');
    // Past the end of the buffer is blank, not absent — a shorter buffer must not
    // shrink the canvas.
    expect(lines[7]).toBe(' '.repeat(MIN_COLS));
  });

  it('starts at topline', () => {
    const buffer = ['zero', 'one', 'two', 'three'];
    expect(viewportLines(buffer, camera(2))[0]?.trimEnd()).toBe('two');
  });

  it('TRUNCATES a line past the frame, not just pads a short one', () => {
    // Padding alone is the bug: a line the player has grown past the frame would
    // widen `stageCells`'s own longest-line measurement and resize the canvas.
    const grown = 'y'.repeat(MIN_COLS + 40);
    expect(viewportLines([grown], camera(0))[0]).toHaveLength(MIN_COLS);
  });
});

describe('shiftEntities moves entities into frame space', () => {
  it('is identity at topline 0, by reference', () => {
    const entities = [wall({ line: 1, col: 2 })];
    expect(shiftEntities(entities, 0)).toBe(entities);
  });

  it('shifts `at` and `to` together', () => {
    const [shifted] = shiftEntities([wall({ line: 5, col: 2 }, { line: 6, col: 9 })], 4);
    expect(shifted?.at).toEqual({ line: 1, col: 2 });
    expect(shifted?.to).toEqual({ line: 2, col: 9 });
  });

  it('leaves a single-cell entity single rather than giving it an undefined `to`', () => {
    // `occupies` reads `to ?? at`, so this is about the property really being
    // absent — an explicit `undefined` would survive `exactOptionalPropertyTypes`
    // only by accident and reads as a rectangle to anything checking `in`.
    const [shifted] = shiftEntities([wall({ line: 3, col: 0 })], 2);
    expect('to' in (shifted as object)).toBe(false);
  });

  it('shifts columns not at all — there is no horizontal camera', () => {
    const [shifted] = shiftEntities([wall({ line: 9, col: 40 })], 9);
    expect(shifted?.at).toEqual({ line: 0, col: 40 });
  });

  it('clamps a straddling rectangle to row 0 so `drawable` does not refuse it', () => {
    // Buffer rows 4-7 at topline 6: rows 6-7 are visible. The un-clamped answer
    // is `at.line: -2`, which `stage-cells.ts`'s `isIndex` rejects — the whole
    // wall then vanishes instead of clipping.
    const [shifted] = shiftEntities([wall({ line: 4, col: 0 }, { line: 7, col: 1 })], 6);
    expect(shifted?.at).toEqual({ line: 0, col: 0 });
    expect(shifted?.to).toEqual({ line: 1, col: 1 });
  });

  it('does NOT clamp a rectangle lying wholly above the frame', () => {
    const [shifted] = shiftEntities([wall({ line: 1, col: 0 }, { line: 2, col: 1 })], 6);
    expect(shifted?.at.line).toBe(-5);
  });

  it('does NOT clamp a single cell scrolled above the frame', () => {
    // A one-cell goal must disappear when it scrolls off, not stick to the top
    // row — where it would be a goal the player could reach at the wrong place.
    const [shifted] = shiftEntities([wall({ line: 2, col: 3 })], 6);
    expect(shifted?.at).toEqual({ line: -4, col: 3 });
  });
});

describe('frameCells draws entities where the player is looking', () => {
  it('puts a scrolled entity on its frame row, not its buffer row', () => {
    const buffer = Array.from({ length: 12 }, (_, i) => `line ${i}`);
    const cells = frameCells(buffer, [wall({ line: 9, col: 0 })], camera(6));
    // Buffer line 9 with topline 6 is frame row 3. The glyph replaces the buffer
    // character, which is what makes this visible at all.
    expect(cells.cells[3 * cells.width]?.char).toBe('#');
    // And NOT on row 9 — the un-shifted answer, which lands inside this frame
    // too (9 < MIN_ROWS) and so would have looked perfectly plausible.
    expect(cells.cells[9 * cells.width]?.char).not.toBe('#');
  });

  it('clips a rectangle that straddles the top edge instead of dropping it', () => {
    const buffer = Array.from({ length: 12 }, () => 'aaaa');
    const cells = frameCells(buffer, [wall({ line: 4, col: 0 }, { line: 7, col: 1 })], camera(6));
    const plain = cells.cells[2 * cells.width + 2]!.bg;
    // Buffer rows 4-5 are above the frame; 6-7 are frame rows 0-1 and must still
    // tint. Before the clamp in `shiftEntities` every one of these was `plain` —
    // the wall was gone, and nothing said so.
    expect(cells.cells[0]?.bg).not.toBe(plain);
    expect(cells.cells[1]?.bg).not.toBe(plain);
    expect(cells.cells[cells.width]?.bg).not.toBe(plain);
    // And it stops where the rectangle does, rather than tinting the whole frame.
    expect(cells.cells[2]?.bg).toBe(plain);
    expect(cells.cells[2 * cells.width]?.bg).toBe(plain);
    // The glyph marks the topmost VISIBLE row, keeping the redundant marker for a
    // wall that continues off-screen.
    expect(cells.cells[0]?.char).toBe('#');
  });

  it('keeps the frame the same size as the buffer changes under it', () => {
    // Both axes, because the two have different mechanisms: extra ROWS are cut by
    // `camera.height`, an over-long LINE only by the slice. A frame that moves
    // renders correctly and resizes the canvas mid-play, blanking it and
    // redrawing every cell on the frames where it happens.
    const before = frameCells(['world'], [], camera(0));
    const taller = frameCells(['world', ...Array.from({ length: 30 }, () => 'more')], [], camera(0));
    const wider = frameCells(['w'.repeat(MIN_COLS + 25)], [], camera(0));
    expect([taller.width, taller.height]).toEqual([before.width, before.height]);
    expect([wider.width, wider.height]).toEqual([before.width, before.height]);
  });
});
