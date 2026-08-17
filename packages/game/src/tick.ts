/**
 * The turn-based clock: what counts as one "act", and what the world does when
 * the player takes one.
 *
 * **One resolved command is one tick.** The tick source is core's own
 * `CommandResolved` — Wave A rebuilt it to fire once per return to REST, for
 * `hjkl` and for a whole visual or insert command alike — so the game layer
 * never keeps a parallel keystroke counter that could drift from the one
 * scoring already trusts. The consequences, all deliberate:
 *
 * - **An insert session is ONE tick**, however many characters it types. This
 *   is the one place the rest rule and a per-keystroke tick genuinely disagree
 *   (`M2-PLAN.md`'s open call), settled here: insert mode is the mode beginners
 *   live in, and a world that advances per typed character makes `i` lethal
 *   near a threat — a punishment for the exact keys the game is teaching.
 *   Fiction agrees: while you are speaking, the world holds its breath.
 * - **A rejected key never ticks** — it resolves nothing (Wave A dropped its
 *   forfeited keys for exactly this), so a locked key can never be blamed for
 *   a threat's move.
 * - **A failed command still ticks** — `h` at column zero beeps, resolves, and
 *   the world moves. Only the key policy makes a keypress free.
 *
 * Threats chase: one step per tick along each axis, closing the gap between
 * the threat's own rectangle and the cursor. A threat whose rectangle already
 * contains the cursor has no gap to close, so it does not move — and since
 * "reaching" requires a move (see `reached` below), **standing in a threat's
 * cells is safe; the threat has to come to you.** That settles Wave B's open
 * question the way `act2-grammar-awakens` was authored: after `di(` the cursor
 * sits inside `the-aside`'s rectangle for a tick and survives it.
 *
 * Entity coordinates are STATIC with respect to buffer edits — `di(` shortens
 * a line and no rectangle re-anchors. Threats move only by their own chase
 * step. A threat converges toward a cursor that is always inside the buffer,
 * so a chase step can never carry it further out of bounds than its author put
 * it.
 */

import type { Pos } from '@vimorror/core';
import { occupies } from './entities.ts';
import type { Entity } from './schema.ts';

export type ThreatTick = {
  /** The full entity list with every threat one step further along. */
  readonly entities: readonly Entity[];
  /** The threats that moved this tick, at their NEW positions. */
  readonly moved: readonly Entity[];
  /**
   * Ids of threats that MOVED ONTO the cursor this tick. By construction a
   * subset of `moved`: a threat already covering the cursor has nothing to
   * close, does not move, and therefore never "reaches" — walking into a
   * threat is the player's business, being caught by one is a loss.
   */
  readonly reached: ReadonlySet<string>;
};

/** One step along one axis: the sign of the gap from the span [lo, hi] to target. */
function stepToward(lo: number, hi: number, target: number): number {
  return target < lo ? -1 : target > hi ? 1 : 0;
}

/** Advance every threat one chase step toward the cursor. Pure; non-threats pass through untouched. */
export function stepThreats(entities: readonly Entity[], cursor: Pos): ThreatTick {
  const moved: Entity[] = [];
  const reached = new Set<string>();
  const next = entities.map((e) => {
    if (e.kind !== 'threat') return e;
    const far = e.to ?? e.at;
    const dLine = stepToward(e.at.line, far.line, cursor.line);
    const dCol = stepToward(e.at.col, far.col, cursor.col);
    if (dLine === 0 && dCol === 0) return e;
    const shifted: Entity = {
      ...e,
      at: { line: e.at.line + dLine, col: e.at.col + dCol },
      ...(e.to === undefined ? {} : { to: { line: e.to.line + dLine, col: e.to.col + dCol } }),
    };
    moved.push(shifted);
    if (occupies(shifted, cursor)) reached.add(shifted.id);
    return shifted;
  });
  return { entities: next, moved, reached };
}
