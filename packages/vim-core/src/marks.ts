/**
 * Marks and the jumplist.
 *
 * `m{a-z}` records a position; `` ` `` returns to it exactly and `'` returns to
 * its line's first non-blank. That difference is the whole distinction between
 * the two keys, and it is why `` d`a `` and `d'a` delete different amounts.
 *
 * The part that is easy to skip and expensive to retrofit is **adjustment**: a
 * mark is a position in a buffer that keeps changing underneath it. Insert a
 * line above a mark and the mark must move down; delete the mark's own line and
 * the mark is *destroyed*, not relocated. Both measured against real Vim.
 *
 * Narratively this is Act III's "places you swore you'd return to": a mark can
 * be quietly invalidated by an edit somewhere else entirely, and the only way
 * you find out is by trying to go back.
 */

import type { Lines } from './buffer.ts';
import type { Pos } from './types.ts';

/** Vim keeps 100 jumplist entries per window. */
const JUMPLIST_SIZE = 100;

export type Marks = Readonly<Record<string, Pos>>;

/**
 * `idx` is the cursor INTO the list, and it may legitimately equal
 * `list.length`, which means "not currently navigating". The first `<C-o>` from
 * that state appends the present position so `<C-i>` has somewhere to return
 * to — which is why a single `<C-o>` grows the list by one.
 */
export type JumpList = {
  readonly list: readonly Pos[];
  readonly idx: number;
};

export const EMPTY_JUMPS: JumpList = { list: [], idx: 0 };

/** Lowercase and uppercase marks are settable; within one buffer they behave alike. */
export function isMarkName(key: string): boolean {
  return /^[a-zA-Z]$/.test(key);
}

/** `` ` `` and `'` name the previous-context mark rather than a letter. */
export function isPreviousContext(key: string): boolean {
  return key === '`' || key === "'";
}

// --- adjustment -------------------------------------------------------------

/**
 * How an edit moved the lines below it. `null` when the line COUNT did not
 * change, which is also the answer for every intra-line edit — deleting a
 * character does not drag a mark on the same line sideways, measured.
 *
 * The edit is characterised by its first differing line plus the net change in
 * line count. That is exact for the pure insertions and pure deletions marks
 * actually care about (`dd`, `o`, `p`, `2dd`, `2p`), and it is a deliberate
 * approximation for an edit that deletes and inserts at once (`2cc`), where
 * Vim adjusts against the real removed range rather than the net one.
 */
export type LineShift = {
  /** First line the edit touched. */
  readonly from: number;
  /** Net change in line count; negative for a net deletion. */
  readonly delta: number;
};

export function lineShift(before: Lines, after: Lines): LineShift | null {
  const delta = after.length - before.length;
  if (delta === 0) return null;
  let from = 0;
  while (from < before.length && from < after.length && before[from] === after[from]) from += 1;
  return { from, delta };
}

/** The last line a net deletion removed; meaningless when `delta >= 0`. */
function deletedThrough(shift: LineShift): number {
  return shift.from - shift.delta - 1;
}

/**
 * Marks whose own line was deleted are **dropped**, not relocated — a later
 * `` `a `` then raises E20 exactly as Vim does. This is the half that a
 * shift-everything implementation gets wrong, and it is invisible until
 * something jumps.
 */
export function adjustMarks(marks: Marks, shift: LineShift): Marks {
  const gone = deletedThrough(shift);
  const out: Record<string, Pos> = {};
  for (const [name, p] of Object.entries(marks)) {
    if (p.line < shift.from) {
      out[name] = p;
      continue;
    }
    if (shift.delta < 0 && p.line <= gone) continue;
    out[name] = { line: p.line + shift.delta, col: p.col };
  }
  return out;
}

/**
 * The jumplist is adjusted by the same shift but with the opposite rule for a
 * deleted range: an entry inside it CLAMPS to the start of the deletion rather
 * than being dropped. Vim uses `one_adjust_nodel` here precisely so the list
 * never develops holes — measured, and different from marks.
 */
export function adjustJumps(jumps: JumpList, shift: LineShift): JumpList {
  const gone = deletedThrough(shift);
  return { ...jumps, list: jumps.list.map((p) => adjustPos(p, shift, gone)) };
}

export function adjustPos(p: Pos, shift: LineShift, gone = deletedThrough(shift)): Pos {
  if (p.line < shift.from) return p;
  if (shift.delta < 0 && p.line <= gone) return { line: shift.from, col: p.col };
  return { line: p.line + shift.delta, col: p.col };
}

// --- the jumplist ------------------------------------------------------------

/**
 * Vim's `setpcmark`: append the position and park `idx` past the end. Note it
 * does NOT de-duplicate here — that happens on the way out, in `cleanupJumps`,
 * which is why the list can briefly hold two entries for one line.
 */
export function pushJump(jumps: JumpList, at: Pos): JumpList {
  const list = [...jumps.list, at].slice(-JUMPLIST_SIZE);
  return { list, idx: list.length };
}

/**
 * Vim's `cleanup_jumplist`: drop entries whose LINE appears again later,
 * keeping the last occurrence, and slide `idx` down past whatever was removed.
 * Columns are not part of the comparison — two visits to different columns of
 * one line are one entry.
 */
export function cleanupJumps(jumps: JumpList): JumpList {
  const list: Pos[] = [];
  let idx = jumps.idx;
  for (let i = 0; i < jumps.list.length; i += 1) {
    const entry = jumps.list[i]!;
    const supersededLater = jumps.list.some((other, k) => k > i && other.line === entry.line);
    if (supersededLater) {
      if (i < jumps.idx) idx -= 1;
    } else {
      list.push(entry);
    }
  }
  return { list, idx: Math.max(0, Math.min(idx, list.length)) };
}

export type JumpStep = {
  readonly jumps: JumpList;
  readonly to: Pos;
  /**
   * True when this step recorded the present position first — Vim reaches
   * `setpcmark()` there, so the previous-context mark moves too.
   */
  readonly recorded: boolean;
};

/**
 * Vim's `movemark`. `count` is negative for `<C-o>` and positive for `<C-i>`.
 * Returns null when there is nowhere to go, which beeps.
 */
export function moveJump(jumps: JumpList, cursor: Pos, count: number): JumpStep | null {
  let cur = cleanupJumps(jumps);
  if (cur.list.length === 0) return null;
  if (cur.idx + count < 0 || cur.idx + count >= cur.list.length) return null;

  let recorded = false;
  if (cur.idx === cur.list.length) {
    // First `<C-o>` after a jump: record where we are, then step back over the
    // entry just added. Without this `<C-i>` could never return.
    cur = pushJump(cur, cursor);
    cur = { ...cur, idx: cur.idx - 1 };
    recorded = true;
    if (cur.idx + count < 0) return null;
  }

  const idx = cur.idx + count;
  const to = cur.list[idx];
  if (to === undefined) return null;
  return { jumps: { ...cur, idx }, to, recorded };
}
