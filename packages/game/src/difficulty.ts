/**
 * Difficulty — `:set verymagic` / `magic` / `nomagic`, as pure modifier config.
 *
 * **The invariant, non-negotiable: difficulty never forks the engine.**
 * `vim-core` is always strict — one code path, one test surface — which is what
 * keeps "muscle memory transfers to real Vim" true at every level. Everything
 * here is a value the game layer reads while running the SAME engine: a
 * condition it declines to enforce, a tick it declines to give a threat, an
 * event it declines to surface. Nothing below reaches into core, and nothing
 * below is allowed to.
 *
 * Difficulty and comfort are two separate axes and never gate each other
 * (`gentle.ts` is the other one): a player may want `nomagic` AND Gentle Mode.
 *
 * The four dials, and what each one is grounded in:
 *
 * - **`silenceFailedMotions`** — `MergedPlan.md`'s "motions clamp instead of
 *   failing" on Easy. Measured first, and the measurement shrank the job: core
 *   already clamps every POSITION the table names (`w` past the last word lands
 *   on the last character and reports no failure at all; `3w` overshooting does
 *   the same), and `l` at EOL / `h` at column 0 / `j` on the last line cannot
 *   move anywhere a clamp would put them. So the only thing left to ease is the
 *   in-character failure LINE, which Easy swallows.
 *   Two consequences worth stating plainly rather than discovering later: this
 *   is cosmetic — a failed command still resolves, still costs its keystrokes
 *   and still ticks the world at EVERY difficulty (Wave C's rule: only the key
 *   policy makes a keypress free) — and an aborted operator reports
 *   `motion-failed` too (`dfz` on a line with no `z`), so Easy silences that as
 *   well.
 *   // ponytail: real pre-dispatch clamping would need a second motion
 *   // implementation in the game layer — the exact drift trap `dot.ts` was
 *   // designed to avoid. Revisit only if a stage needs a motion core does not
 *   // already clamp.
 * - **`enforceBudget`** — Easy has "no keystroke budgets", Normal scores the
 *   budget "not enforced", Hard makes it "a hard fail". So a `keystrokes-over`
 *   lose condition is live on `nomagic` ALONE, and `scoring.ts` reports the
 *   overrun at every level. This is the one dial that changes an OUTCOME, which
 *   is why it is expressed as a filtered condition list rather than a branch:
 *   `rules.ts` never learns that difficulty exists.
 * - **`threatPeriod`** — "threats at half speed" on Easy: one chase step every
 *   N ticks. The world still moves only when the player acts.
 * - **`hints`** — always visible / on request / none. `always` costs the
 *   clean-run flag outright, since a hint on screen is a hint used; that is
 *   what makes the identical solution score differently across presets.
 *
 * Deliberately NOT modelled: the table's undo dials ("unlimited" / "limited per
 * stage" / `'undolevels'=-1`). Core has no undo limit and the stage schema has
 * no field to carry one, so there is nothing here to switch.
 * // ponytail: add an undo budget when a stage actually needs one — it wants a
 * // schema field and a core option, not a modifier that lies about both.
 */

import type { Condition, Stage } from './schema.ts';

export type Difficulty = 'verymagic' | 'magic' | 'nomagic';

/** How hints are offered. `on-request` is the only one that costs a clean run per use. */
export type HintPolicy = 'always' | 'on-request' | 'none';

export type Modifiers = {
  /** Swallow `motion-failed` — Easy's "motions clamp instead of failing". */
  readonly silenceFailedMotions: boolean;
  /** Whether a `keystrokes-over` lose condition can actually end the stage. */
  readonly enforceBudget: boolean;
  /** Ticks per threat chase step. 2 is "half speed"; 1 is full. */
  readonly threatPeriod: number;
  readonly hints: HintPolicy;
};

export const DIFFICULTIES: Readonly<Record<Difficulty, Modifiers>> = {
  verymagic: { silenceFailedMotions: true, enforceBudget: false, threatPeriod: 2, hints: 'always' },
  magic: { silenceFailedMotions: false, enforceBudget: false, threatPeriod: 1, hints: 'on-request' },
  nomagic: { silenceFailedMotions: false, enforceBudget: true, threatPeriod: 1, hints: 'none' },
};

/** Normal. Exact Vim semantics, budget scored but not enforced, hints on request. */
export const DEFAULT_DIFFICULTY: Difficulty = 'magic';

export function modifiersFor(difficulty: Difficulty): Modifiers {
  return DIFFICULTIES[difficulty];
}

/**
 * The lose conditions this difficulty actually enforces — the whole of
 * "difficulty is modifier config" in one function. A dropped condition is
 * invisible to `rules.ts`, so easing the budget adds no branch anywhere
 * downstream and cannot ease anything else by accident.
 */
export function enforcedLose(stage: Pick<Stage, 'lose'>, mods: Modifiers): readonly Condition[] {
  return mods.enforceBudget ? stage.lose : stage.lose.filter((c) => c.kind !== 'keystrokes-over');
}
