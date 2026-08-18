/**
 * Scoring — keystrokes against par, plus the clean-run flag.
 *
 * "You did that in 7 keys, par is 3" is a core loop, and it is why `vim-core`
 * emits a `ResolvedCommand` with a keystroke count and a command SHAPE rather
 * than just "a command finished". Everything here reads that stream; nothing
 * here counts keys on its own, because a second counter is a second thing to
 * drift (`M2-PLAN.md`'s finding 2 is that trap, from the other end).
 *
 * Three rules worth stating, all of them consequences of Wave C's tick:
 *
 * - **Only resolved commands count.** A key the stage LOCKED is free — it
 *   resolves nothing, so it reaches neither the score nor the world. A key that
 *   ran and FAILED is not free: `h` at column zero beeps, resolves, and costs
 *   its keystroke at every difficulty.
 * - **A clean run is no undo and no hints.** Both are recoveries, and the flag
 *   is the whole "hints cost score" mechanic — there is no separate point
 *   penalty to invent, tune, or explain. On `verymagic` hints are always on
 *   screen, so a `verymagic` run is never clean: that is what makes the
 *   IDENTICAL solution score differently across the three presets.
 * - **Undo is detected by command SHAPE**, which is exactly what `shape` is for:
 *   `3u` and `u` are one entry, not two, and no `keys` string parsing is needed.
 *   `U` is not a Vim command this engine implements and `:undo` is not a
 *   command name it resolves — both were measured, so the four shapes below are
 *   the complete list.
 *
 * **Can a replay hide an undo?** Yes, and Wave E decided to leave it — with the
 * surface measured rather than assumed, which shrank it twice:
 *
 * - **`.` cannot hide one.** Measured: `xxu` then `.` repeats the `x`, not the
 *   `u`. An undo is not a change, so it never enters the dot record at all. The
 *   ledger listed `@a`, `.` and `:normal`; it is really `@` and `:normal`.
 * - **Recording does not hide one either.** `qauq` resolves as three commands
 *   (`qa`, `u`, `q`) and the `u` inside the recording is counted like any other.
 *   Only the REPLAY is opaque, so the hole opens on the second `@a` onward.
 *
 * And the cheap fix was measured and rejected, because it is a partial fix that
 * looks complete: watching `undoState.current` move to a node that already
 * existed catches `@a` when the body is a bare `u`, and misses it entirely when
 * the body is `xu` — measured, the pointer returns to the very node it started
 * from, so the buffer was really edited and really undone with nothing to see.
 * A detector that silently covers half its cases is worse than a named ceiling.
 *   // ponytail: an undo inside `@`/`:normal` is not counted — `@a` resolves as
 *   // `@a`, whatever its body did. The real fix is core surfacing a replay's
 *   // inner resolved commands (out of M2's bounds), not a parser here. Do it
 *   // when a stage that permits `q`/`@` or `:normal` can game its par that way.
 */

import { DIFFICULTIES, type Difficulty } from './difficulty.ts';

/** What a session tallies while it plays. */
export type RunTally = {
  /** Keystrokes across resolved commands. */
  readonly keystrokes: number;
  readonly undos: number;
  /** Hints the player actually asked for. Always-visible hints are not requests. */
  readonly hintsShown: number;
};

export type Score = {
  readonly difficulty: Difficulty;
  readonly keystrokes: number;
  readonly par: number;
  /** `keystrokes - par`: negative beats par, zero meets it, positive is over. */
  readonly delta: number;
  readonly undos: number;
  readonly hintsShown: number;
  readonly clean: boolean;
};

/** The complete set — `U` and `:undo` are not implemented by this engine (measured). */
const UNDO_SHAPES: ReadonlySet<string> = new Set(['u', '<C-r>', 'g-', 'g+']);

/**
 * A count and a register prefix, in either order and any number of times —
 * `{count}`, `"a`, `2"a`, `"a2`. Both really do reach undo: `"au` undoes (the
 * register is simply ignored, as in real Vim) and resolves with the shape
 * `"au`, so a check that only stripped counts let a player keep a clean run by
 * typing a register they never used.
 */
const UNDO_PREFIX = /^(?:\{count\}|"[\s\S])+/;

export function isUndoCommand(shape: string): boolean {
  return UNDO_SHAPES.has(shape.replace(UNDO_PREFIX, ''));
}

export function scoreRun(run: RunTally, par: number, difficulty: Difficulty): Score {
  return {
    difficulty,
    keystrokes: run.keystrokes,
    par,
    delta: run.keystrokes - par,
    undos: run.undos,
    hintsShown: run.hintsShown,
    // A hint on screen for the whole stage is a hint used, whether or not the
    // player looked. Celeste marks an assisted save the same way, and for the
    // same reason: the flag records what the run had, not what it deserved.
    clean: run.undos === 0 && run.hintsShown === 0 && DIFFICULTIES[difficulty].hints !== 'always',
  };
}
