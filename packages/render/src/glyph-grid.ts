/**
 * Owns a `<canvas>` 2D context and the previous frame's `CellBuffer`.
 * `render()` diffs against it and blits only the changed cells from the font
 * atlas, then draws the cursor overlay. No concept of "selection" or
 * "highlight" — that's just the caller setting `Cell.fg`/`bg`/`glitch` per
 * frame. Impure (canvas), so it's manual/visual-verified only, per
 * `docs/M1-PLAN.md`'s testing split.
 */

import { diffCells } from './cell-buffer.ts';
import { atlasRectFor, type FontAtlas } from './font-atlas.ts';
import type { Cell, CellBuffer, CursorShape } from './types.ts';

export type GridCursor = {
  /** Screen-relative row/col, or `null` when scrolled out of view. */
  readonly pos: { row: number; col: number } | null;
  readonly shape: CursorShape;
};

/** Never equal to a real buffer, so the first `render()` redraws every cell. */
const NEVER_RENDERED: CellBuffer = { width: -1, height: -1, cells: [] };

export class GlyphGrid {
  readonly #ctx: CanvasRenderingContext2D;
  readonly #cellW: number;
  readonly #cellH: number;
  #prev: CellBuffer = NEVER_RENDERED;
  #cursorPos: { row: number; col: number } | null = null;

  constructor(canvas: HTMLCanvasElement, cellW: number, cellH: number) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas context unavailable');
    this.#ctx = ctx;
    this.#cellW = cellW;
    this.#cellH = cellH;
  }

  render(next: CellBuffer, atlas: FontAtlas, cursor: GridCursor): void {
    const diffs = diffCells(this.#prev, next);
    const redrawn = new Set(diffs.map((d) => `${d.row},${d.col}`));

    // The previous cursor overlay was drawn with an invertible blend, but
    // only over the cell it actually landed on — if that cell isn't in this
    // frame's diff (unchanged content, cursor just moved off it), it must be
    // redrawn plain or the inverted pixels stick around.
    const old = this.#cursorPos;
    if (old !== null && !redrawn.has(`${old.row},${old.col}`)) {
      const cell = next.cells[old.row * next.width + old.col];
      if (cell) this.#drawCell(old.row, old.col, cell, atlas);
    }

    for (const { row, col, cell } of diffs) this.#drawCell(row, col, cell, atlas);

    if (cursor.pos) this.#drawCursor(cursor.pos, cursor.shape);
    this.#cursorPos = cursor.pos;
    this.#prev = next;
  }

  #drawCell(row: number, col: number, cell: Cell, atlas: FontAtlas): void {
    const x = col * this.#cellW;
    const y = row * this.#cellH;
    const ctx = this.#ctx;
    const rect = atlasRectFor(cell.char.charCodeAt(0), atlas.cellW, atlas.cellH, atlas.atlasCols);

    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, this.#cellW, this.#cellH);
    ctx.clip();
    ctx.clearRect(x, y, this.#cellW, this.#cellH);

    // Atlas glyphs are baked white-on-transparent. Composite the cell's own
    // fg/bg onto that mask rather than re-shaping text every frame: 'source-atop'
    // recolors only the glyph's opaque pixels, then 'destination-over' fills
    // the still-transparent rest with the background.
    ctx.drawImage(atlas.canvas, rect.x, rect.y, rect.width, rect.height, x, y, this.#cellW, this.#cellH);
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = cell.fg;
    ctx.fillRect(x, y, this.#cellW, this.#cellH);
    ctx.globalCompositeOperation = 'destination-over';
    ctx.fillStyle = cell.bg;
    ctx.fillRect(x, y, this.#cellW, this.#cellH);
    ctx.restore();
  }

  #drawCursor(pos: { row: number; col: number }, shape: CursorShape): void {
    const x = pos.col * this.#cellW;
    const y = pos.row * this.#cellH;
    const ctx = this.#ctx;

    ctx.save();
    // 'difference' inverts whatever is already there, so the cursor stays
    // visible on any fg/bg combination without needing its own color, and
    // drawing it a second time (next frame's erase-old-position pass) is a
    // clean no-op rather than needing a separate restore path.
    ctx.globalCompositeOperation = 'difference';
    ctx.fillStyle = '#ffffff';
    switch (shape) {
      case 'block':
        ctx.fillRect(x, y, this.#cellW, this.#cellH);
        break;
      case 'bar':
        ctx.fillRect(x, y, Math.max(1, Math.round(this.#cellW * 0.15)), this.#cellH);
        break;
      case 'underline': {
        const h = Math.max(1, Math.round(this.#cellH * 0.15));
        ctx.fillRect(x, y + this.#cellH - h, this.#cellW, h);
        break;
      }
      case 'hollow-block':
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, y + 0.5, this.#cellW - 1, this.#cellH - 1);
        break;
    }
    ctx.restore();
  }
}
