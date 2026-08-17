/**
 * rules.ts — condition evaluation and the outcome order.
 *
 * The one decision pinned here rather than anywhere else: LOSE BEFORE WIN on
 * the same tick. Flip that order and exactly one test fails, by name.
 */

import { describe, expect, it } from 'vitest';
import { evalCondition, evaluate, type Entity, type RuleContext } from './index.ts';

const goal: Entity = { id: 'goal', kind: 'goal', at: { line: 1, col: 3 }, glyph: 'X' };

const ctx = (patch: Partial<RuleContext> = {}): RuleContext => ({
  lines: ['ab', 'cdef'],
  cursor: { line: 0, col: 0 },
  entities: [goal],
  keystrokes: 0,
  reached: new Set(),
  ...patch,
});

describe('evalCondition', () => {
  it('cursor-on tests the LIVE entity position handed to it', () => {
    const c = { kind: 'cursor-on', entity: 'goal' } as const;
    expect(evalCondition(c, ctx({ cursor: { line: 1, col: 3 } }))).toBe(true);
    expect(evalCondition(c, ctx())).toBe(false);
    // A moved copy of the entity wins over the authored coordinates.
    const movedGoal: Entity = { ...goal, at: { line: 0, col: 0 } };
    expect(evalCondition(c, ctx({ entities: [movedGoal] }))).toBe(true);
  });

  it('cursor-on an unknown entity is false, not a crash', () => {
    expect(evalCondition({ kind: 'cursor-on', entity: 'ghost' }, ctx())).toBe(false);
  });

  it('buffer-equals is exact, length included', () => {
    expect(evalCondition({ kind: 'buffer-equals', lines: ['ab', 'cdef'] }, ctx())).toBe(true);
    expect(evalCondition({ kind: 'buffer-equals', lines: ['ab'] }, ctx())).toBe(false);
    expect(evalCondition({ kind: 'buffer-equals', lines: ['ab', 'cdeF'] }, ctx())).toBe(false);
  });

  it('keystrokes-over is strictly over — winning on the budget itself is safe', () => {
    const c = { kind: 'keystrokes-over', max: 5 } as const;
    expect(evalCondition(c, ctx({ keystrokes: 5 }))).toBe(false);
    expect(evalCondition(c, ctx({ keystrokes: 6 }))).toBe(true);
  });

  it('threat-reaches-cursor reads the transient reached set', () => {
    const c = { kind: 'threat-reaches-cursor' } as const;
    expect(evalCondition(c, ctx())).toBe(false);
    expect(evalCondition(c, ctx({ reached: new Set(['t']) }))).toBe(true);
  });
});

describe('evaluate', () => {
  const winOnGoal = [{ kind: 'cursor-on', entity: 'goal' } as const];

  it('win requires ALL conditions', () => {
    const stage = {
      win: [...winOnGoal, { kind: 'buffer-equals' as const, lines: ['nope'] }],
      lose: [],
    };
    expect(evaluate(stage, ctx({ cursor: { line: 1, col: 3 } }))).toEqual({ status: 'playing' });
  });

  it('lose fires on ANY condition and names which one', () => {
    const budget = { kind: 'keystrokes-over', max: 3 } as const;
    const stage = { win: winOnGoal, lose: [{ kind: 'threat-reaches-cursor' } as const, budget] };
    expect(evaluate(stage, ctx({ keystrokes: 4 }))).toEqual({ status: 'lost', by: budget });
  });

  it('wins when every condition holds and nothing fires', () => {
    const stage = { win: winOnGoal, lose: [{ kind: 'threat-reaches-cursor' } as const] };
    expect(evaluate(stage, ctx({ cursor: { line: 1, col: 3 } }))).toEqual({ status: 'won' });
  });

  it('lose beats win on the same tick — the threat gets you at the exit', () => {
    const reach = { kind: 'threat-reaches-cursor' } as const;
    const stage = { win: winOnGoal, lose: [reach] };
    const tied = ctx({ cursor: { line: 1, col: 3 }, reached: new Set(['t']) });
    expect(evaluate(stage, tied)).toEqual({ status: 'lost', by: reach });
  });
});
