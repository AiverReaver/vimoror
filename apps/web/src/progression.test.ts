/**
 * The unlock chain and the two sticky fields.
 *
 * The chain's interesting case is not "stage 2 opens after stage 1" — it is the
 * GAP: a progress map that has stage 3 completed and stage 2 not, which is what
 * a hand-edited save looks like and what inserting a stage into `campaign.json`
 * between two the player already finished produces. Opening everything after
 * the gap would silently skip curriculum; the chain stops instead.
 *
 * `bestKeystrokes` and `cleanRun` are asserted against a SECOND, worse win,
 * because that is the direction they can be wrong in: nothing in this game
 * takes an achievement back.
 */

import { scoreRun, type Difficulty, type Score, type Stage } from '@vimorror/game';
import { describe, expect, it } from 'vitest';

import { recordWin, unlockedIds } from './progression.ts';
import type { Progress } from './save.ts';

/** Only `id` matters here; the rest of a `Stage` is beside the point. */
const stage = (id: string) => ({ id }) as unknown as Stage;
const CAMPAIGN = ['a', 'b', 'c'].map(stage);

const done = { completed: true, bestKeystrokes: 5, cleanRun: false } as const;

/** A real `Score`, so the fields recorded are the ones `scoring.ts` produces. */
function score(keystrokes: number, difficulty: Difficulty, hintsShown = 0): Score {
  return scoreRun({ keystrokes, undos: 0, hintsShown }, 5, difficulty);
}

describe('unlockedIds', () => {
  it('opens the first stage and nothing else on an empty profile', () => {
    expect([...unlockedIds(CAMPAIGN, {})]).toEqual(['a']);
  });

  it('opens the next stage when the one before it is completed', () => {
    expect([...unlockedIds(CAMPAIGN, { a: done })]).toEqual(['a', 'b']);
  });

  it('stops at a gap rather than opening everything after it', () => {
    expect([...unlockedIds(CAMPAIGN, { a: done, c: done })]).toEqual(['a', 'b']);
  });

  it('counts a completion at ANY difficulty — nomagic is not a prerequisite', () => {
    const easy: Progress = recordWin({}, 'a', score(9, 'verymagic'));
    expect([...unlockedIds(CAMPAIGN, easy)]).toEqual(['a', 'b']);
  });

  it('reads `completed`, not merely the presence of an entry', () => {
    // Unreachable through play — `recordWin` only ever writes `true` — but a
    // hand-edited save is the trust boundary this map crosses, and a field the
    // code never actually reads is a field that is decorative rather than real.
    expect([...unlockedIds(CAMPAIGN, { a: { ...done, completed: false } })]).toEqual(['a']);
  });

  it('opens the whole campaign once every stage is done', () => {
    expect([...unlockedIds(CAMPAIGN, { a: done, b: done, c: done })]).toEqual(['a', 'b', 'c']);
  });

  it('ignores a progress entry for a stage the manifest does not list', () => {
    expect([...unlockedIds(CAMPAIGN, { ghost: done })]).toEqual(['a']);
  });
});

describe('recordWin', () => {
  it('records the first win as completed', () => {
    expect(recordWin({}, 'a', score(7, 'magic'))).toEqual({
      a: { completed: true, bestKeystrokes: 7, cleanRun: true },
    });
  });

  it('keeps the FEWER keystrokes when a later run is worse', () => {
    const first = recordWin({}, 'a', score(5, 'magic'));
    expect(recordWin(first, 'a', score(40, 'magic')).a?.bestKeystrokes).toBe(5);
  });

  it('takes the fewer keystrokes when a later run is better', () => {
    const first = recordWin({}, 'a', score(40, 'magic'));
    expect(recordWin(first, 'a', score(5, 'magic')).a?.bestKeystrokes).toBe(5);
  });

  it('keeps a clean run clean after a later assisted one', () => {
    const clean = recordWin({}, 'a', score(5, 'magic'));
    expect(clean.a?.cleanRun).toBe(true);
    // A hint on `magic` is what `scoring.ts` charges the clean flag for.
    expect(recordWin(clean, 'a', score(5, 'magic', 1)).a?.cleanRun).toBe(true);
  });

  it('does not invent a clean run out of two assisted ones', () => {
    const assisted = recordWin({}, 'a', score(5, 'magic', 1));
    expect(recordWin(assisted, 'a', score(5, 'magic', 1)).a?.cleanRun).toBe(false);
  });

  it('leaves other stages alone', () => {
    expect(recordWin({ b: done }, 'a', score(5, 'magic')).b).toEqual(done);
  });
});
