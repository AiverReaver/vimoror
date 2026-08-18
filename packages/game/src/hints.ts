/**
 * Hints — the live state diffed against the golden solution's prefix.
 *
 * A stage ships a `solution` in key notation, and M3's recorder will produce it
 * from real play — one action yielding par, the hint data and a regression test
 * at once. This file is the "hint data" third of that, and it derives EVERYTHING
 * from the recorded solution: there is no second hint field in the schema to
 * drift from the route the stage actually ships. (`M2-PLAN.md` left that choice
 * open for this wave; deriving it is what keeps one recording authoritative.)
 *
 * The mechanism, and why it is a replay rather than a key-prefix match:
 *
 * Comparing what the player has TYPED against the solution's keys breaks the
 * moment a player reaches the same place by another route — `2j` versus `jj`,
 * or a wander out and back. So the solution is replayed once through a real
 * `VimEngine`, recording the buffer and cursor after each RESOLVED command, and
 * the hint is chosen by matching the player's live state against that path.
 * Grouping by resolved command is what makes a hint say `di(` rather than `d`,
 * and it costs nothing: core's `CommandResolved` already fires once per return
 * to rest, insert sessions included.
 *
 * Two tiers, because a lost player is exactly who asks for a hint:
 *
 * 1. **On path** — buffer AND cursor match a state the solution passes through.
 *    The LAST such state wins, so a solution that revisits a position hints the
 *    later work rather than sending the player back through it.
 * 2. **Off path** — only the buffer matches. The FIRST such state wins: the
 *    player has the right text and has wandered, so the earliest command that
 *    fits is the one that gets them moving again rather than the last.
 *
 * With neither matching there is no honest hint, and this returns `undefined`
 * rather than inventing one — a stage whose buffer the player has edited off the
 * solution's route needs `u`, not a keystroke from a path they are not on.
 */

import { VimEngine, tokenize, type Pos } from '@vimorror/core';
import type { Stage } from './schema.ts';

/** What the solution is at after one of its resolved commands. */
export type SolutionStep = {
  /** The command as typed, e.g. `di(` — never a bare `d`. */
  readonly keys: string;
  readonly lines: readonly string[];
  readonly cursor: Pos;
};

export type LiveState = {
  readonly lines: readonly string[];
  readonly cursor: Pos;
};

export type Hint = {
  /** The next command of the solution, as keys to press. */
  readonly keys: string;
  /** How many of the solution's commands are already behind this hint. */
  readonly index: number;
  readonly total: number;
  /** False when only the buffer matched — the player has wandered off the route. */
  readonly onPath: boolean;
};

/** The stage fields a hint needs: everything the engine starts from, plus the route. */
export type Hintable = Pick<Stage, 'buffer' | 'cursor' | 'options' | 'solution'>;

/**
 * Replay the solution, capturing the state after each resolved command.
 *
 * No key policy is attached: `stageSchema` has already proven every key of the
 * solution is one the stage permits, so gating here could only fail in ways the
 * stage is already guaranteed against.
 */
export function solutionPath(stage: Hintable): readonly SolutionStep[] {
  const engine = new VimEngine([...stage.buffer], stage.cursor, stage.options);
  const steps: SolutionStep[] = [];
  for (const key of tokenize(stage.solution)) {
    for (const e of engine.feed(key)) {
      if (e.type !== 'CommandResolved') continue;
      steps.push({ keys: e.command.keys, lines: [...engine.lines], cursor: engine.cursor });
    }
  }
  return steps;
}

function sameLines(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((line, i) => line === b[i]);
}

export function hintFor(stage: Hintable, live: LiveState): Hint | undefined {
  // ponytail: the path is replayed per request. A stage-sized solution is a
  // handful of keys; memoize per stage if a long recorded solution ever makes
  // this measurable.
  const steps = solutionPath(stage);
  // states[k] is where the solution stands BEFORE steps[k] — so states[0] is
  // the spawn, and the hint from any matched state k is steps[k] itself.
  const states: readonly LiveState[] = [{ lines: stage.buffer, cursor: stage.cursor }, ...steps];

  // Backwards for tier 1, forwards for tier 2 — `findLastIndex` is ES2023 and
  // the workspace's `lib` is not, which is not worth a root tsconfig edit.
  let index = -1;
  for (let k = states.length - 1; k >= 0 && index < 0; k--) {
    const s = states[k]!;
    if (s.cursor.line === live.cursor.line && s.cursor.col === live.cursor.col && sameLines(s.lines, live.lines)) index = k;
  }
  const onPath = index >= 0;
  if (!onPath) index = states.findIndex((s) => sameLines(s.lines, live.lines));

  // Past the end is the solved case, not a failure: there is nothing left to hint.
  const next = index < 0 ? undefined : steps[index];
  return next === undefined ? undefined : { keys: next.keys, index, total: steps.length, onPath };
}
