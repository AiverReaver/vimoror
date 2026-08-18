/**
 * scoring.ts — keystrokes against par, and the clean-run flag.
 *
 * The undo-shape list is the part worth pinning hard: it was measured against
 * the engine rather than guessed (`U` is rejected as an unknown key and
 * `:undo` resolves as an unknown command, so neither belongs), and a shape it
 * misses is an undo the clean flag silently forgives.
 */

import { describe, expect, it } from 'vitest';
import { isUndoCommand, scoreRun, type RunTally } from './index.ts';

const tally = (over: Partial<RunTally> = {}): RunTally => ({ keystrokes: 5, undos: 0, hintsShown: 0, ...over });

describe('isUndoCommand', () => {
  it('knows the four shapes, counted or not', () => {
    for (const shape of ['u', '<C-r>', 'g-', 'g+', '{count}u', '{count}<C-r>', '{count}g-', '{count}g+']) {
      expect(isUndoCommand(shape)).toBe(true);
    }
  });

  it('sees through a register prefix, which really does reach undo', () => {
    // Measured: `"au` undoes (the register is ignored, as in real Vim) and
    // resolves as `"au`. Counts and registers arrive in either order.
    for (const shape of ['"au', '{count}"au', '"a{count}u', '"a<C-r>', '"ag-']) {
      expect(isUndoCommand(shape)).toBe(true);
    }
  });

  it('is not fooled by a command that merely contains one', () => {
    // `gu` is lowercase-an-object, `qa`/`q` bracket a recording, `@a` may well
    // have undone something inside — none of them is the player pressing undo.
    for (const shape of ['x', 'dw', 'd{count}w', 'gu{count}w', 'qa', 'q', '@a', 'U', ':undo<CR>', '"ap', '"ayy']) {
      expect(isUndoCommand(shape)).toBe(false);
    }
  });
});

describe('scoreRun', () => {
  it('reports the delta against par, signed', () => {
    expect(scoreRun(tally({ keystrokes: 3 }), 5, 'magic').delta).toBe(-2);
    expect(scoreRun(tally({ keystrokes: 5 }), 5, 'magic').delta).toBe(0);
    expect(scoreRun(tally({ keystrokes: 9 }), 5, 'magic').delta).toBe(4);
  });

  it('a clean run is no undo and no hints', () => {
    expect(scoreRun(tally(), 5, 'magic').clean).toBe(true);
    expect(scoreRun(tally({ undos: 1 }), 5, 'magic').clean).toBe(false);
    expect(scoreRun(tally({ hintsShown: 1 }), 5, 'magic').clean).toBe(false);
  });

  it('an always-visible hint costs the flag outright — this is what "hints cost score" means', () => {
    // Nothing was requested and nothing was undone, and the run still is not
    // clean: on `verymagic` the hint was on screen the whole time.
    expect(scoreRun(tally(), 5, 'verymagic').clean).toBe(false);
    expect(scoreRun(tally(), 5, 'nomagic').clean).toBe(true);
  });

  it('carries the difficulty, so a score is never read out of context', () => {
    expect(scoreRun(tally(), 5, 'nomagic')).toEqual({
      difficulty: 'nomagic',
      keystrokes: 5,
      par: 5,
      delta: 0,
      undos: 0,
      hintsShown: 0,
      clean: true,
    });
  });
});
