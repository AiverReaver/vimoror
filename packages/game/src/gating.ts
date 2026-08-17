/**
 * Key gating — the pedagogy, rendered in character.
 *
 * Two jobs. First, turn a stage's `allowedKeys` into the `KeyPolicy` core
 * already enforces per keystroke — the schema has proven every spec tokenizes,
 * so this is pure expansion. Second, give every `InvalidReason` an in-fiction
 * line, because "rejected in character, never a silent no-op" is the whole
 * point of gating: a locked key teaches, a beep does not.
 *
 * The map is a total `Record<InvalidReason, string>`, deliberately: core's
 * union is 16 members wide and documented as load-bearing for exactly this
 * file, so a 17th reason added later is a COMPILE error here rather than a
 * silent generic message. These lines are the mechanical layer's defaults,
 * written in Acts I–III's restrained register; M5/M6 own the real copy and
 * per-stage overrides are a content-milestone concern, not a Wave C one.
 */

import type { InvalidReason, KeyPolicy } from '@vimorror/core';
import { ALWAYS_ALLOWED, expandKeySpecs, type Stage } from './schema.ts';

/** `undefined` when the stage is ungated — `allowedKeys` omitted means no policy at all. */
export function stageKeyPolicy(stage: Pick<Stage, 'allowedKeys'>): KeyPolicy | undefined {
  if (stage.allowedKeys === undefined) return undefined;
  const allowed = expandKeySpecs(stage.allowedKeys);
  // <Esc> is never lockable. A stage that permits `i` but not `<Esc>` — the
  // shipped act2 fixture was exactly that shape — soft-locks the player in
  // insert mode: no return to rest, no tick, no win, no lose, forever. The
  // schema's playability checks count these keys as allowed for the same
  // reason (`ALWAYS_ALLOWED` there), so the two surfaces cannot disagree.
  for (const key of ALWAYS_ALLOWED) allowed.add(key);
  return { allowed };
}

export const REJECTION_LINES: Readonly<Record<InvalidReason, string>> = {
  'key-locked': 'You have not been given that key yet.',
  'unknown-key': 'Nothing in this place answers to that.',
  'no-such-motion': 'That is not a direction the cursor knows.',
  'motion-failed': 'The way is shut.',
  'not-in-mode': 'Not here. Not like this.',
  'nothing-to-undo': 'There is nothing left to take back.',
  'nothing-to-redo': 'What was undone stays undone.',
  'empty-register': 'You reach into the register and find nothing.',
  'mark-not-set': 'No mark answers. Perhaps its line is gone.',
  'no-jump': 'The jumplist ends here. There is no further back.',
  'nothing-to-repeat': 'You have done nothing worth repeating. Yet.',
  'invalid-range': 'Those lines are not in this buffer.',
  'unknown-command': 'The command line considers it, and declines.',
  'pattern-not-found': 'Nothing here matches that. Nothing wants to.',
  'invalid-substitute': 'The substitution will not take that shape.',
  'invalid-global': 'That will not run inside a global. Some doors do not nest.',
  'recursive-macro': 'The macro calls itself, and the call does not come back.',
};

export function rejectionLine(reason: InvalidReason): string {
  return REJECTION_LINES[reason];
}
