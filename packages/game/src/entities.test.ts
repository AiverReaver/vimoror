/**
 * entities.ts — the overlay's position math.
 *
 * The load-bearing case is `occupies` over a RECTANGLE: an entity spanning two
 * lines covers only the columns between its corners, not every character from
 * the start position to the end position the way a charwise range would. A
 * charwise implementation passes every other test in this file, so that one has
 * its own case.
 */

import { describe, expect, it } from 'vitest';

import { entitiesOfKind, entityById, occupies } from './index.ts';
import type { Entity } from './index.ts';

const cell: Entity = { id: 'goal', kind: 'goal', at: { line: 1, col: 3 }, glyph: 'X' };
const block: Entity = {
  id: 'wall',
  kind: 'wall',
  at: { line: 1, col: 2 },
  to: { line: 3, col: 5 },
  glyph: '#',
};

describe('occupies', () => {
  it('covers exactly one cell when there is no "to"', () => {
    expect(occupies(cell, { line: 1, col: 3 })).toBe(true);
    expect(occupies(cell, { line: 1, col: 4 })).toBe(false);
    expect(occupies(cell, { line: 0, col: 3 })).toBe(false);
  });

  it('includes BOTH corners of a rectangle', () => {
    expect(occupies(block, { line: 1, col: 2 })).toBe(true);
    expect(occupies(block, { line: 3, col: 5 })).toBe(true);
  });

  it('is a rectangle, not a charwise span', () => {
    // Line 2 is inside the row range, but columns 0-1 and 6+ are outside the
    // column range. A charwise range would swallow the whole of line 2.
    expect(occupies(block, { line: 2, col: 4 })).toBe(true);
    expect(occupies(block, { line: 2, col: 1 })).toBe(false);
    expect(occupies(block, { line: 2, col: 6 })).toBe(false);
  });

  it('excludes lines outside the row range', () => {
    expect(occupies(block, { line: 0, col: 3 })).toBe(false);
    expect(occupies(block, { line: 4, col: 3 })).toBe(false);
  });
});

describe('entityById', () => {
  it('finds by id and returns undefined for an unknown one', () => {
    expect(entityById([cell, block], 'wall')).toBe(block);
    expect(entityById([cell, block], 'nope')).toBeUndefined();
  });
});

describe('entitiesOfKind', () => {
  it('filters by kind', () => {
    expect(entitiesOfKind([cell, block], 'wall')).toEqual([block]);
    expect(entitiesOfKind([cell, block], 'threat')).toEqual([]);
  });
});
