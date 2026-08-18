/**
 * gentle.ts — the comfort predicate.
 *
 * Small file, small tests, one thing that matters: a NON-startling beat is
 * never filtered by either switch. Gentle Mode disables startle, not story —
 * "all mechanics and story intact" is the whole framing, and a predicate that
 * quietly swallowed ordinary beats would still pass a test that only ever
 * checks the startling ones.
 */

import { describe, expect, it } from 'vitest';
import { DEFAULT_COMFORT, allowsBeat, type Comfort } from './index.ts';

const startling = { startling: true };
const dread = { startling: false };

const comfort = (gentle: boolean, jumpScares: boolean): Comfort => ({ gentle, jumpScares });

describe('allowsBeat', () => {
  it('lets an ordinary beat through under every combination', () => {
    for (const gentle of [true, false]) {
      for (const jumpScares of [true, false]) {
        expect(allowsBeat(dread, comfort(gentle, jumpScares))).toBe(true);
      }
    }
  });

  it('gentle mode disables startle even with jump scares left on', () => {
    // The two switches are independent inputs, but gentle is the stronger one:
    // a player who turned it on has not consented to startle by leaving the
    // narrower toggle where it was.
    expect(allowsBeat(startling, comfort(true, true))).toBe(false);
    expect(allowsBeat(startling, comfort(true, false))).toBe(false);
  });

  it('the jump-scare toggle disables startle on its own — dread without startle', () => {
    expect(allowsBeat(startling, comfort(false, false))).toBe(false);
  });

  it('only the fully-permissive combination lets a startle beat through', () => {
    expect(allowsBeat(startling, comfort(false, true))).toBe(true);
  });

  it('the default is the game as authored: both kinds fire', () => {
    expect(DEFAULT_COMFORT).toEqual({ gentle: false, jumpScares: true });
    expect(allowsBeat(startling, DEFAULT_COMFORT)).toBe(true);
    expect(allowsBeat(dread, DEFAULT_COMFORT)).toBe(true);
  });
});
