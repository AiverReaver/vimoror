/**
 * difficulty.ts — the modifier table and the one function that applies it.
 *
 * The invariant these tests defend is the architectural one: **difficulty never
 * forks the engine.** Nothing here constructs a `VimEngine` differently per
 * preset, because nothing is allowed to — the last case is the property that
 * says so from the outside, by winning the same stage with the same keys at
 * every level.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { DIFFICULTIES, GameSession, enforcedLose, modifiersFor, parseStage, type Condition, type Difficulty, type Stage } from './index.ts';

const PRESETS: readonly Difficulty[] = ['verymagic', 'magic', 'nomagic'];

const budget: Condition = { kind: 'keystrokes-over', max: 20 };
const threat: Condition = { kind: 'threat-reaches-cursor' };

describe('the table', () => {
  it('eases in one direction only, dial by dial', () => {
    const [easy, normal, hard] = [DIFFICULTIES.verymagic, DIFFICULTIES.magic, DIFFICULTIES.nomagic];
    // Budget: hard-fail on nomagic ALONE. This is the dial that changes an
    // outcome, and the one that changed Wave C's default behaviour.
    expect([easy.enforceBudget, normal.enforceBudget, hard.enforceBudget]).toEqual([false, false, true]);
    expect([easy.hints, normal.hints, hard.hints]).toEqual(['always', 'on-request', 'none']);
    expect([easy.threatPeriod, normal.threatPeriod, hard.threatPeriod]).toEqual([2, 1, 1]);
    // Only Easy bends anything about a failure, and only its wording.
    expect([easy.silenceFailedMotions, normal.silenceFailedMotions, hard.silenceFailedMotions]).toEqual([true, false, false]);
  });

  it('modifiersFor is the table, not a copy of it', () => {
    for (const preset of PRESETS) expect(modifiersFor(preset)).toBe(DIFFICULTIES[preset]);
  });
});

describe('enforcedLose', () => {
  it('drops an unenforced keystroke budget and keeps everything else', () => {
    const stage = { lose: [budget, threat] };
    expect(enforcedLose(stage, DIFFICULTIES.magic)).toEqual([threat]);
    expect(enforcedLose(stage, DIFFICULTIES.verymagic)).toEqual([threat]);
    expect(enforcedLose(stage, DIFFICULTIES.nomagic)).toEqual([budget, threat]);
  });

  it('returns the stage list itself when everything is enforced', () => {
    const stage = { lose: [budget, threat] };
    expect(enforcedLose(stage, DIFFICULTIES.nomagic)).toBe(stage.lose);
  });

  it('leaves a stage with no budget identical at every preset', () => {
    const stage = { lose: [threat] };
    for (const preset of PRESETS) expect(enforcedLose(stage, DIFFICULTIES[preset])).toEqual([threat]);
  });
});

describe('difficulty never forks the engine', () => {
  /** Ungated, unthreatened, unbudgeted: nothing a preset can reach. */
  const plain = (): Stage =>
    parseStage({
      id: 'plain',
      act: 1,
      title: 'Plain',
      buffer: ['alpha beta gamma'],
      par: 4,
      solution: 'wwde',
      win: [{ kind: 'buffer-equals', lines: ['alpha beta '] }],
    });

  it('PROPERTY: the same keys reach the same buffer, cursor and score at every preset', () => {
    const keys = fc.array(fc.constantFrom('h', 'l', 'w', 'b', 'e', 'x', 'u', '2'), { maxLength: 12 });
    fc.assert(
      fc.property(keys, (typed) => {
        const runs = PRESETS.map((difficulty) => {
          const session = new GameSession(plain(), { difficulty });
          for (const k of typed) session.feed(k);
          return {
            lines: [...session.engine.lines],
            cursor: session.engine.cursor,
            keystrokes: session.keystrokes,
            outcome: session.outcome,
          };
        });
        expect(runs[1]).toEqual(runs[0]);
        expect(runs[2]).toEqual(runs[0]);
      }),
    );
  });

  it('a stage winnable by its own solution stays winnable at every preset', () => {
    for (const difficulty of PRESETS) {
      const session = new GameSession(plain(), { difficulty });
      session.feedKeys('wwde');
      expect(session.outcome).toEqual({ status: 'won' });
    }
  });
});
