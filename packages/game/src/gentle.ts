/**
 * Comfort — Gentle Mode and the separate jump-scare toggle.
 *
 * Comfort is not difficulty. **They are independent axes and never gate each
 * other**: a player may want `nomagic` and Gentle Mode at once, and neither
 * setting is allowed to imply the other. Difficulty is how much challenge you
 * want; comfort is what your body and history can tolerate.
 *
 * Two switches, deliberately, because they answer different questions:
 *
 * - **Gentle Mode** — Celeste's Assist Mode. All mechanics and story intact;
 *   startle beats and look-away tricks off. No penalty, no judgmental copy —
 *   which is a constraint on this file too: nothing here reports that Gentle
 *   Mode was on, and `scoring.ts` never reads it.
 * - **The jump-scare toggle** — dread without startle, for a player who wants
 *   the full difficulty and the full story and not the sudden noise.
 *
 * The filter is a constraint on the DATA, not a switch buried in a renderer:
 * `schema.ts` makes `startling` a REQUIRED field precisely so a beat declares
 * itself and this predicate stays a one-liner. A non-startling beat is never
 * filtered by either switch — the story is not the thing being disabled.
 *
 * **Where the filter runs is load-bearing.** `session.ts` marks a beat fired
 * whether or not it emits it, so a suppressed beat is suppressed at the
 * EMISSION point only: the buffer, the tick, the threat positions and the
 * outcome are byte-identical with either switch in either position. That is the
 * property test, and it is what lets a replay recorded by one player reproduce
 * under another player's comfort settings.
 */

import type { Beat } from './schema.ts';

export type Comfort = {
  /** All mechanics and story intact; startle beats and look-away tricks off. */
  readonly gentle: boolean;
  /** Dread without startle. Independent of `gentle`, which also implies it. */
  readonly jumpScares: boolean;
};

/** The game as authored: nothing suppressed. Both switches are opt-IN. */
export const DEFAULT_COMFORT: Comfort = { gentle: false, jumpScares: true };

export function allowsBeat(beat: Pick<Beat, 'startling'>, comfort: Comfort): boolean {
  if (!beat.startling) return true;
  return comfort.jumpScares && !comfort.gentle;
}
