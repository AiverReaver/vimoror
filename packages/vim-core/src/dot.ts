/**
 * `.` — repeat the last change.
 *
 * This is the subtlest thing in the engine, and the reason is that `.` does not
 * repeat what you TYPED. It repeats the last *change*, which is a different and
 * smaller thing:
 *
 *   `f,x`   repeats only the `x` — the `f,` was navigation, not a change
 *   `df,`   repeats the whole delete, re-running the search for `,`
 *   `yw`    is not a change at all, so `.` still repeats whatever came before it
 *   `u`     likewise: `dw u .` re-does the delete rather than repeating the undo
 *
 * So the record is built from the RESOLVED COMMAND rather than from the key
 * stream. The one part that genuinely is raw-key replay is the insert half:
 * `ciwfoo<Esc>` has to replay `foo<Esc>` keystroke for keystroke, `<BS>` and
 * all, exactly as Vim's redo buffer does. Hence a record with two halves.
 *
 * Narratively this is Act III: `.` is compulsion — the same edit reaching
 * forward into text it was never aimed at.
 */

import type { KeyToken, Mode, Pos } from './types.ts';

/**
 * A visual-mode change repeats by SHAPE, not by position: the same size of
 * selection is rebuilt at wherever the cursor now is.
 *
 * `lines` and `cols` are relative, but `endCol` is absolute and is what a
 * MULTI-line charwise repeat uses for its far end — `vjld` repeated does not
 * end `cols` past the new cursor, it ends at the column the original did.
 * Measured; Vim carries the same split in `redo_VIsual`.
 */
export type VisualShape = {
  readonly mode: Mode;
  readonly lines: number;
  readonly cols: number;
  readonly endCol: number;
};

export type DotRecord = {
  /**
   * The resolved command's tokens with every COUNT digit removed — `2d3w` and
   * `dw` both record `['d','w']`. Register prefixes stay (`"add` records the
   * `"a`), because repeating it really does write that register again.
   */
  readonly keys: readonly KeyToken[];
  /** The effective count that was typed, or 0 for none. */
  readonly count: number;
  /** Raw insert keystrokes including the terminating `<Esc>`; empty otherwise. */
  readonly insertKeys: readonly KeyToken[];
  /** Present when the change was made from visual mode. */
  readonly visual: VisualShape | undefined;
};

function countDigits(count: number): KeyToken[] {
  return count > 0 ? String(count).split('') : [];
}

/**
 * The key sequence `.` should feed.
 *
 * A count typed on the `.` itself REPLACES the recorded one outright rather
 * than multiplying it — measured: `2d3w` deleted six words, and `2.` after it
 * deletes two, not four and not six. That is why the count is stored apart
 * from the keys instead of being left embedded in them.
 */
export function replayKeys(record: DotRecord, newCount: number): readonly KeyToken[] {
  const count = newCount > 0 ? newCount : record.count;
  return [...countDigits(count), ...record.keys, ...record.insertKeys];
}

/** The record as it stands after a `.` that carried its own count — it sticks. */
export function withCount(record: DotRecord, newCount: number): DotRecord {
  return newCount > 0 ? { ...record, count: newCount } : record;
}

/** Rebuild a recorded selection shape at the cursor. Returns [anchor, cursor]. */
export function replaySelection(shape: VisualShape, cursor: Pos): readonly [Pos, Pos] {
  if (shape.mode === 'visual-line') {
    return [cursor, { line: cursor.line + shape.lines, col: cursor.col }];
  }
  if (shape.mode === 'visual-block') {
    return [cursor, { line: cursor.line + shape.lines, col: cursor.col + shape.cols - 1 }];
  }
  // Charwise: a single-line selection keeps its WIDTH, a multi-line one keeps
  // the absolute column it ended on.
  const end =
    shape.lines === 0
      ? { line: cursor.line, col: cursor.col + shape.cols - 1 }
      : { line: cursor.line + shape.lines, col: shape.endCol };
  return [cursor, end];
}
