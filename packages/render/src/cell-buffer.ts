/**
 * CellBuffer construction and the dirty-cell diff. Pure, DOM-free — only
 * depends on `./types.ts`; glyph-grid.ts (a later wave) is the sole consumer
 * of `diffCells`, redrawing just the cells it reports.
 */

import type { Cell, CellBuffer } from './types.ts';

/** Default cell: a space on transparent-ish black, matching an empty terminal. */
const BLANK_CELL: Cell = { char: ' ', fg: '#ffffff', bg: '#000000' };

export function createCellBuffer(width: number, height: number): CellBuffer {
  const cells = new Array<Cell>(width * height);
  for (let i = 0; i < cells.length; i += 1) cells[i] = { ...BLANK_CELL };
  return { width, height, cells };
}

/**
 * `VimEngine.lines` (plain text) -> a monochrome `CellBuffer`, one `Cell` per
 * character. Width is the longest line's length so no line gets truncated;
 * shorter lines pad with blank cells out to that width.
 */
export function linesToCells(lines: readonly string[], fg: string, bg: string): CellBuffer {
  const height = lines.length;
  const width = lines.reduce((max, line) => Math.max(max, line.length), 0);
  const buffer = createCellBuffer(width, height);
  for (let row = 0; row < height; row += 1) {
    const line = lines[row]!;
    for (let col = 0; col < width; col += 1) {
      const char = col < line.length ? line[col]! : ' ';
      buffer.cells[row * width + col] = { char, fg, bg };
    }
  }
  return buffer;
}

/** A single differing cell, identified by grid position and its new content. */
export type CellDiff = { row: number; col: number; cell: Cell };

/**
 * Dirty-cell scan between two same-sized buffers. Returns `{row,col}[]` (not
 * flat indices) since glyph-grid.ts needs row/col to address the canvas, and
 * bundling the new `cell` alongside saves it re-indexing `next.cells`.
 */
export function diffCells(prev: CellBuffer, next: CellBuffer): CellDiff[] {
  const diffs: CellDiff[] = [];
  if (prev.width !== next.width || prev.height !== next.height) {
    for (let row = 0; row < next.height; row += 1) {
      for (let col = 0; col < next.width; col += 1) {
        diffs.push({ row, col, cell: next.cells[row * next.width + col]! });
      }
    }
    return diffs;
  }
  for (let i = 0; i < next.cells.length; i += 1) {
    const a = prev.cells[i]!;
    const b = next.cells[i]!;
    if (a.char !== b.char || a.fg !== b.fg || a.bg !== b.bg || a.glitch !== b.glitch) {
      diffs.push({ row: Math.floor(i / next.width), col: i % next.width, cell: b });
    }
  }
  return diffs;
}
