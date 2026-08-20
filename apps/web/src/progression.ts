/**
 * What is open, and what a win is worth remembering.
 *
 * Two functions, both pure, both over the `Progress` map `save.ts` stores. The
 * policy is deliberately the dullest one that can exist — **stage n+1 opens
 * when stage n has been completed, at any difficulty, and the first stage is
 * always open** — and that is the point rather than a placeholder apology: M6
 * replaces the *policy* with a placement skill-check, not the seam. A player who
 * can already do half the curriculum should skip it, and that is a different
 * decision than "is the next room open", made in a different milestone.
 *
 * **Any difficulty counts.** `nomagic` is not a prerequisite for anything —
 * difficulty is a dial on how the same content is enforced, never a second
 * curriculum, and gating the next room behind a harder run would make it one.
 * `bestKeystrokes` and `cleanRun` are where difficulty shows, and neither gates.
 *
 * `cleanRun` is sticky and `bestKeystrokes` is a minimum, for the same reason:
 * a later scrappy win is a thing you did, not a thing that un-does what you did
 * before. Nothing in this game takes an achievement back.
 */

import type { Score, Stage } from '@vimorror/game';

import type { Progress, StageProgress } from './save.ts';

/**
 * The ids the player may open, in one pass over the campaign in curriculum
 * order.
 *
 * A `Set` rather than a filtered stage list, because every caller asks the
 * question the other way round: the select screen renders EVERY stage and needs
 * to know which rows are locked. A list of the open ones would make the locked
 * ones a second computation.
 */
export function unlockedIds(stages: readonly Stage[], progress: Progress): ReadonlySet<string> {
  const open = new Set<string>();
  for (const stage of stages) {
    open.add(stage.id);
    // The chain stops at the first stage that has not been completed — so a
    // save whose progress skips one (hand-edited, or a stage inserted into the
    // manifest between two the player already finished) locks from there rather
    // than opening everything after it.
    if (progress[stage.id]?.completed !== true) break;
  }
  return open;
}

/** Fold a winning run into the map. Never called for a loss — losing costs
 * nothing but the run, which is `current` being cleared and not this. */
export function recordWin(progress: Progress, stageId: string, score: Score): Progress {
  const previous: StageProgress | undefined = progress[stageId];
  return {
    ...progress,
    [stageId]: {
      completed: true,
      bestKeystrokes: Math.min(previous?.bestKeystrokes ?? Infinity, score.keystrokes),
      cleanRun: (previous?.cleanRun ?? false) || score.clean,
    },
  };
}
