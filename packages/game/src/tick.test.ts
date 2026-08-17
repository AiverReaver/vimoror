/**
 * tick.ts — the chase step and the "reached" rule.
 *
 * The load-bearing case is the LAST one: a threat whose rectangle already
 * contains the cursor does not move and therefore never "reaches". That is the
 * settled answer to Wave B's open question — standing in a threat is safe, the
 * threat has to come to you — and it is what lets `act2-grammar-awakens`
 * survive the first command of its own solution.
 */

import { describe, expect, it } from 'vitest';
import { stepThreats, type Entity } from './index.ts';

const threat = (at: { line: number; col: number }, to?: { line: number; col: number }): Entity => ({
  id: 't',
  kind: 'threat',
  at,
  ...(to === undefined ? {} : { to }),
  glyph: '?',
});

describe('stepThreats', () => {
  it('steps one cell toward the cursor on each axis at once', () => {
    const { entities, moved, reached } = stepThreats([threat({ line: 0, col: 0 })], { line: 3, col: 5 });
    expect(entities[0]!.at).toEqual({ line: 1, col: 1 });
    expect(moved).toHaveLength(1);
    expect(reached.size).toBe(0);
  });

  it('moves a rectangle as a rigid block, both corners together', () => {
    const { entities } = stepThreats([threat({ line: 2, col: 4 }, { line: 3, col: 6 })], { line: 0, col: 0 });
    expect(entities[0]!.at).toEqual({ line: 1, col: 3 });
    expect(entities[0]!.to).toEqual({ line: 2, col: 5 });
  });

  it('does not move along an axis whose span already contains the cursor', () => {
    // Cursor line 1 is inside lines 0..2, so only the column axis steps.
    const { entities } = stepThreats([threat({ line: 0, col: 4 }, { line: 2, col: 5 })], { line: 1, col: 0 });
    expect(entities[0]!.at).toEqual({ line: 0, col: 3 });
    expect(entities[0]!.to).toEqual({ line: 2, col: 4 });
  });

  it('reaches when its step lands on the cursor', () => {
    const { reached } = stepThreats([threat({ line: 0, col: 1 })], { line: 0, col: 0 });
    expect(reached).toEqual(new Set(['t']));
  });

  it('a rectangle reaches with its BODY, not just its corner', () => {
    // (2,3)-(2,5) chasing (1,4) steps to (1,3)-(1,5): the corner never touches
    // the cursor but the body covers it — the player is caught. A corner-only
    // equality check passes every single-cell case in this file.
    const { reached } = stepThreats([threat({ line: 2, col: 3 }, { line: 2, col: 5 })], { line: 1, col: 4 });
    expect(reached).toEqual(new Set(['t']));
  });

  it('passes non-threats through untouched, same object', () => {
    const goal: Entity = { id: 'g', kind: 'goal', at: { line: 0, col: 5 }, glyph: 'X' };
    const { entities, moved } = stepThreats([goal], { line: 0, col: 0 });
    expect(entities[0]).toBe(goal);
    expect(moved).toHaveLength(0);
  });

  it('never overshoots: an adjacent threat lands on the cursor and stops there', () => {
    const first = stepThreats([threat({ line: 0, col: 1 })], { line: 0, col: 0 });
    expect(first.reached.has('t')).toBe(true);
    const second = stepThreats(first.entities, { line: 0, col: 0 });
    expect(second.entities[0]!.at).toEqual({ line: 0, col: 0 });
    expect(second.moved).toHaveLength(0);
  });

  it('a threat already containing the cursor does not move and does NOT reach', () => {
    // The settled decision: walking into a threat is the player's business;
    // "reaching" requires the threat to have taken the step itself.
    const { entities, moved, reached } = stepThreats(
      [threat({ line: 0, col: 2 }, { line: 0, col: 6 })],
      { line: 0, col: 4 },
    );
    expect(entities[0]!.at).toEqual({ line: 0, col: 2 });
    expect(moved).toHaveLength(0);
    expect(reached.size).toBe(0);
  });
});
