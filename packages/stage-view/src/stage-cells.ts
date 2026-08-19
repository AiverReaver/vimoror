/**
 * The one pure render module: a stage's text plus its entity overlay, as a
 * `CellBuffer` the glyph grid can blit.
 *
 * Text goes through render's own `linesToCells` rather than a second copy of the
 * character-to-cell loop, and the rectangle test is `entities.ts`'s `occupies`
 * rather than a second copy of the `<C-v>`-shaped bounds — which is the same
 * rule that file's own header states, and the reason the schema's refinements
 * call `occupies` too. Nothing here is a rule; it is a skin over rules that live
 * one package down.
 *
 * **This file is the seam M4 lifted.** It was the editor's until the runner
 * needed the same stage-to-cells drawing; it moved to this package then, verbatim
 * and with its tests, because game must not depend on render and render must not
 * know stages — so neither of them could hold it and an app-to-app source import
 * would be an undeclared dependency between two things that are not libraries.
 *
 * Two things were measured against render before choosing the palette below,
 * and both shape it:
 *
 * - **Every colour pair is dark background, bright foreground.** `GlyphGrid`
 *   draws its cursor with a `difference` blend against white — an exact
 *   inversion — so a cell whose background sits near mid-grey inverts to within
 *   a couple of values of itself and the cursor becomes *invisible* on it. The
 *   danger band is roughly 112..143 per channel, and a stage's spawn very often
 *   sits on a painted cell. Dark backgrounds keep the inversion at full range,
 *   and they read as a terminal besides.
 * - **The anchor cell carries the entity's glyph.** That is the project's
 *   "never colour alone" invariant arriving in pixels: an author who cannot
 *   distinguish the four tints still reads `X`, `#`, `?`, `*`. The glyph
 *   *replaces* the buffer character underneath it, which is the cost — and it is
 *   why selection is spelt as an inversion rather than as a second glyph, so a
 *   single-cell entity still changes visibly when it is picked. Both halves of
 *   that judgment call were compared on the real fixtures on screen; the
 *   repeated glyph reads a painted rectangle beautifully and a one-cell goal not
 *   at all, and most goals and pickups are one cell.
 */

import type { Pos } from '@vimorror/core';
import { occupies, type Entity, type EntityKind } from '@vimorror/game';
import { linesToCells, type CellBuffer } from '@vimorror/render';

export const TEXT_FG = '#c9c9c9';
export const TEXT_BG = '#0b0b0e';

export const ENTITY_SKIN: Record<EntityKind, { readonly fg: string; readonly bg: string }> = {
  goal: { fg: '#5fe07a', bg: '#0d3d18' },
  wall: { fg: '#c3c9d8', bg: '#2a2a34' },
  threat: { fg: '#ff7b6b', bg: '#4a0f12' },
  pickup: { fg: '#ffd452', bg: '#3d3208' },
};

/**
 * The frame is where an unbounded number becomes an unbounded ALLOCATION — one
 * `Cell` object per cell — so it is the one place a ceiling belongs.
 *
 * Measured, not hypothetical: a hand-edited `col` of `1e9` made `padEnd` throw
 * `RangeError: Invalid string length` out of a React effect, which unmounts the
 * tree and destroys the issues pane that was about to say
 * `entities.0.at: 0:1000000000 is outside the buffer`. One million built
 * eighteen million cells and then set `canvas.width` past the 65535 a browser
 * will accept, so the canvas was dead either way. 512 columns is far past
 * anything a human authors, which is why the no-truncation property below holds
 * for all real content and gives way only here.
 */
const MAX_FRAME_COLS = 512;

const isIndex = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0;

function isCell(pos: unknown): pos is Pos {
  if (pos === null || typeof pos !== 'object') return false;
  const { line, col } = pos as { line?: unknown; col?: unknown };
  // Integers, because a fractional col makes `line * width + col` a STRING key
  // on the cells array — the entity then renders with neither tint nor glyph and
  // the buffer quietly stops being row-major.
  return isIndex(line) && isIndex(col);
}

/**
 * Can this be DRAWN? Not "is it valid" — `schema.ts` is the only judge of that,
 * and it is already reporting on the same draft.
 *
 * The two questions have to be asked separately because the editor keeps
 * rendering while the parse fails, which is the whole point of the preview: the
 * renderer therefore receives entities straight off a hand-edited file. Measured
 * against the shipped code before this existed, all three from one typo class:
 * `kind: "walls"` made `ENTITY_SKIN[kind]` undefined and threw
 * `Cannot read properties of undefined (reading 'fg')`; a missing `at` threw on
 * `.col`; and `glyph: 7` survived to `GlyphGrid`, which calls
 * `cell.char.charCodeAt(0)`. Each one unmounted the whole React tree and took
 * the issues pane — the thing about to say `entities.0.kind: Invalid enum
 * value` — down with it. A blank page is the worst possible answer to a typo.
 *
 * Same reasoning as `readDraft`'s buffer check, one door further in: a
 * structural precondition of drawing, not a duplicate of a schema rule.
 * `Object.hasOwn` rather than a bare index for the same reason `schema.ts` uses
 * it on `KEY_MACROS` — `kind: "toString"` would otherwise find an inherited
 * function and pass.
 */
function drawable(entity: Entity): boolean {
  const e = entity as Partial<Entity> | null | undefined;
  if (e === null || e === undefined) return false;
  return (
    typeof e.kind === 'string' &&
    Object.hasOwn(ENTITY_SKIN, e.kind) &&
    typeof e.glyph === 'string' &&
    isCell(e.at) &&
    (e.to === undefined || isCell(e.to))
  );
}

/**
 * Exported so a caller that reads an entity's own fields — the selection
 * readout, today — narrows through the same filter the renderer does, instead of
 * growing a second opinion about what is safe to touch.
 */
export function drawableEntities(entities: readonly Entity[]): readonly Entity[] {
  return entities.every(drawable) ? entities : entities.filter(drawable);
}

/**
 * Wide enough for the longest line, plus one column when an entity needs the
 * end-of-line position.
 *
 * That one extra column is not defensive padding: the schema's `inBuffer`
 * explicitly admits `col === line.length` for `to` as much as for `at`, and
 * `linesToCells` sizes itself from the longest LINE, so the end-of-line cell
 * would otherwise have nothing to tint.
 *
 * **It is one column and not the entity's own column, which is the fix for a
 * measured layout failure.** Widening to `at.col + 1` let a single hand-edited
 * number size the whole preview: an entity at `col: 1e9` produced a frame of
 * `MAX_FRAME_COLS`, a 4608-pixel canvas, and a buffer pane squeezed to nothing —
 * all to reach a cell `inFrame` then drops anyway, because a column past the
 * end-of-line position is outside the buffer and the issues pane is already
 * saying so. Nothing legal is lost: an entity that far out has no cell to draw
 * in at any frame size.
 *
 * A floor of one keeps a single empty line from producing a zero-width buffer.
 */
function frameWidth(lines: readonly string[], entities: readonly Entity[]): number {
  const longest = lines.reduce((max, line) => Math.max(max, line.length), 0);
  const wantsEndOfLine = entities.some((e) => e.at.col >= longest || (e.to ?? e.at).col >= longest);
  return Math.min(MAX_FRAME_COLS, Math.max(1, wantsEndOfLine ? longest + 1 : longest));
}

/**
 * `selectedId` inverts that entity's own colours, across its whole rectangle
 * rather than only the anchor.
 *
 * Later entities paint over earlier ones, so the array is the author's own
 * z-order. `entityAt` below resolves a click the same way round, and the two
 * must agree or clicking a cell would select something other than what is drawn
 * on it.
 */
export function stageCells(
  lines: readonly string[],
  entities: readonly Entity[],
  selectedId?: string,
): CellBuffer {
  const drawn = drawableEntities(entities);
  const width = frameWidth(lines, drawn);
  const buffer = linesToCells(
    lines.map((line) => line.slice(0, width).padEnd(width, ' ')),
    TEXT_FG,
    TEXT_BG,
  );

  for (const entity of drawn) {
    const skin = ENTITY_SKIN[entity.kind];
    const selected = entity.id === selectedId;
    const fg = selected ? skin.bg : skin.fg;
    const bg = selected ? skin.fg : skin.bg;

    for (let line = 0; line < buffer.height; line += 1) {
      for (let col = 0; col < width; col += 1) {
        if (!occupies(entity, { line, col })) continue;
        const cell = buffer.cells[line * width + col]!;
        buffer.cells[line * width + col] = { char: cell.char, fg, bg };
      }
    }

    // Guarded rather than trusted: a draft is edited live and reaches here
    // mid-error, and `at.line * width + at.col` for an out-of-frame anchor does
    // not fall off the end of a row-major array — it silently lands on the NEXT
    // row, or GROWS the array past `width * height` and leaves `diffCells`
    // walking cells no row/col maps to.
    if (inFrame(buffer, entity.at)) {
      buffer.cells[entity.at.line * width + entity.at.col] = { char: entity.glyph, fg, bg };
    }
  }

  return buffer;
}

/** Shared with `grid-pane.tsx`, which asks the same question about the spawn. */
export function inFrame(cells: CellBuffer, pos: Pos): boolean {
  return pos.line >= 0 && pos.line < cells.height && pos.col >= 0 && pos.col < cells.width;
}

/**
 * Which entity is drawn on `pos` — the topmost, matching `stageCells`'s own
 * paint order, so a click selects what the author can see rather than whatever
 * happens to be first in the array.
 */
export function entityAt(entities: readonly Entity[], pos: Pos): Entity | undefined {
  const drawn = drawableEntities(entities);
  for (let i = drawn.length - 1; i >= 0; i -= 1) {
    const entity = drawn[i]!;
    if (occupies(entity, pos)) return entity;
  }
  return undefined;
}
