/**
 * stage-cells.ts — the entity overlay as cells.
 *
 * Several of these are here because the failure is SILENT rather than because
 * the behaviour is subtle. A row-major buffer indexed by `line * width + col`
 * does not throw for an out-of-frame anchor; it lands on some other row, or
 * extends the array past `width * height` and leaves `diffCells` iterating cells
 * no position maps to. And the palette assertions exist because a colour pair is
 * the one thing a test can only check against a REQUIREMENT — comparing a cell to
 * `ENTITY_SKIN[kind]` is self-referential and passes for any table at all,
 * including one where the foreground equals its own background and "never colour
 * alone" quietly becomes colour alone.
 *
 * Everything below drawn from a draft that is mid-error is deliberate: that is
 * the state this module is required to keep rendering in, and the state a
 * hand-edited file arrives in.
 */

import type { Entity } from '@vimorror/game';
import { describe, expect, it } from 'vitest';

import { ENTITY_SKIN, TEXT_BG, TEXT_FG, drawableEntities, entityAt, inFrame, stageCells } from './stage-cells.ts';

const goal: Entity = { id: 'exit', kind: 'goal', at: { line: 0, col: 1 }, glyph: 'X' };

const wall: Entity = {
  id: 'sealed',
  kind: 'wall',
  at: { line: 0, col: 1 },
  to: { line: 1, col: 2 },
  glyph: '#',
};

/** Row-major lookup, so a test reads a cell the way `GlyphGrid` does. */
const cellAt = (cells: ReturnType<typeof stageCells>, line: number, col: number) =>
  cells.cells[line * cells.width + col]!;

const channelsOf = (hex: string): number[] => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));

/** How far `difference`-against-white moves a channel: |c - (255 - c)|. */
const inversionDelta = (channel: number): number => Math.abs(255 - channel - channel);

const distance = (a: string, b: string): number =>
  channelsOf(a).reduce((sum, channel, i) => sum + Math.abs(channel - channelsOf(b)[i]!), 0);

describe('stageCells', () => {
  it('tints every cell of a rectangle and stamps the glyph on the anchor only', () => {
    const cells = stageCells(['abc', 'def'], [wall]);
    const skin = ENTITY_SKIN.wall;

    expect(cellAt(cells, 0, 1)).toEqual({ char: '#', fg: skin.fg, bg: skin.bg });
    expect(cellAt(cells, 0, 2)).toEqual({ char: 'c', fg: skin.fg, bg: skin.bg });
    expect(cellAt(cells, 1, 1)).toEqual({ char: 'e', fg: skin.fg, bg: skin.bg });
    expect(cellAt(cells, 1, 2)).toEqual({ char: 'f', fg: skin.fg, bg: skin.bg });
  });

  it('never colours alone — a glyph reaches the anchor of every kind', () => {
    for (const kind of ['goal', 'wall', 'threat', 'pickup'] as const) {
      const entity: Entity = { id: 'e', kind, at: { line: 0, col: 0 }, glyph: '@' };
      const cells = stageCells(['abc'], [entity]);
      expect(cellAt(cells, 0, 0)).toEqual({ char: '@', fg: ENTITY_SKIN[kind].fg, bg: ENTITY_SKIN[kind].bg });
    }
  });

  it('leaves text alone where no entity sits', () => {
    const cells = stageCells(['abc'], [goal]);
    expect(cellAt(cells, 0, 0)).toEqual({ char: 'a', fg: TEXT_FG, bg: TEXT_BG });
    expect(cellAt(cells, 0, 2)).toEqual({ char: 'c', fg: TEXT_FG, bg: TEXT_BG });
  });

  it('gives a cell to an entity at the end-of-line position, which linesToCells alone would not', () => {
    // The schema admits `col === line.length` — the end-of-line position is real
    // — while `linesToCells` sizes itself from the longest LINE, so that cell
    // would have nothing to tint.
    const eol: Entity = { id: 'e', kind: 'goal', at: { line: 0, col: 3 }, glyph: 'X' };
    const cells = stageCells(['abc'], [eol]);

    expect(cells.width).toBe(4);
    expect(cellAt(cells, 0, 3)).toEqual({ char: 'X', fg: ENTITY_SKIN.goal.fg, bg: ENTITY_SKIN.goal.bg });
  });

  it('widens for a RECTANGLE\'s far column too, not just its anchor', () => {
    // `to` is admitted at `col === line.length` exactly as `at` is, and the far
    // corner is the one that decides the width — an axis typo reading `to.line`
    // here is invisible to every test whose longest line is already wide enough.
    const wide: Entity = { id: 'w', kind: 'wall', at: { line: 0, col: 1 }, to: { line: 0, col: 8 }, glyph: '#' };
    const cells = stageCells(['abcdefgh'], [wide]);

    expect(cells.width).toBe(9);
    expect(cellAt(cells, 0, 8)).toEqual({ char: ' ', fg: ENTITY_SKIN.wall.fg, bg: ENTITY_SKIN.wall.bg });
  });

  it('inverts the SELECTED entity across its whole rectangle', () => {
    const plain = stageCells(['abc', 'def'], [wall]);
    const picked = stageCells(['abc', 'def'], [wall], 'sealed');
    const skin = ENTITY_SKIN.wall;

    // The anchor AND a cell that is only tinted, not stamped: an inversion applied
    // to the stamp alone leaves a picked rectangle reading three-quarters unpicked.
    expect(cellAt(picked, 0, 1)).toEqual({ char: '#', fg: skin.bg, bg: skin.fg });
    expect(cellAt(picked, 1, 2)).toEqual({ char: 'f', fg: skin.bg, bg: skin.fg });
    expect(cellAt(picked, 1, 2)).not.toEqual(cellAt(plain, 1, 2));
  });

  it('inverts a ONE-cell entity visibly, which is why selection is not a second glyph', () => {
    const plain = stageCells(['abc'], [goal]);
    const picked = stageCells(['abc'], [goal], 'exit');

    expect(cellAt(picked, 0, 1)).toEqual({ char: 'X', fg: ENTITY_SKIN.goal.bg, bg: ENTITY_SKIN.goal.fg });
    expect(cellAt(picked, 0, 1)).not.toEqual(cellAt(plain, 0, 1));
  });

  it('ignores a selection naming nothing', () => {
    expect(stageCells(['abc'], [goal], 'gone')).toEqual(stageCells(['abc'], [goal]));
  });

  it('paints later entities over earlier ones', () => {
    const cells = stageCells(['abc'], [goal, { ...goal, id: 'over', kind: 'threat', glyph: '?' }]);
    expect(cellAt(cells, 0, 1)).toEqual({ char: '?', fg: ENTITY_SKIN.threat.fg, bg: ENTITY_SKIN.threat.bg });
  });

  it('keeps a one-line buffer from producing a zero-width frame', () => {
    const cells = stageCells([''], []);
    expect([cells.width, cells.height]).toEqual([1, 1]);
  });
});

describe('the palette answers to a requirement, not to itself', () => {
  const backgrounds = [...Object.values(ENTITY_SKIN).map((skin) => skin.bg), TEXT_BG];

  it('every background inverts far enough for the cursor to be seen on it', () => {
    // `GlyphGrid` draws its cursor as an exact inversion (`difference` against
    // white), so a background near mid-grey inverts to within a value or two of
    // itself and the cursor vanishes — measured danger band, roughly 112..143 per
    // channel. TEXT_BG belongs in this loop as much as the four skins do: it is
    // the background of every unpainted cell, where the cursor spends most of
    // its life.
    for (const bg of backgrounds) {
      for (const channel of channelsOf(bg)) expect(inversionDelta(channel)).toBeGreaterThan(64);
    }
  });

  it('every foreground is far enough from its own background to READ', () => {
    // Without this, "never colour alone" collapses: the glyph is still stamped,
    // in the background colour, and the redundant-glyph invariant becomes
    // colour alone with nothing able to tell.
    for (const skin of Object.values(ENTITY_SKIN)) {
      expect(distance(skin.fg, skin.bg)).toBeGreaterThan(120);
    }
    expect(distance(TEXT_FG, TEXT_BG)).toBeGreaterThan(120);
  });
});

describe('an entity that cannot be drawn is skipped, not thrown on', () => {
  // Measured against the shipped code before `drawable` existed: each of these
  // threw out of a React effect, which unmounts the whole tree and destroys the
  // issues pane that was about to name the very same field. A blank page is the
  // worst possible answer to a typo.
  const undrawable: readonly [string, unknown][] = [
    ['a kind typo', { id: 'e', kind: 'walls', at: { line: 0, col: 0 }, glyph: '#' }],
    ['an inherited key as kind', { id: 'e', kind: 'toString', at: { line: 0, col: 0 }, glyph: '#' }],
    ['no at', { id: 'e', kind: 'wall', glyph: '#' }],
    ['a null at', { id: 'e', kind: 'wall', at: null, glyph: '#' }],
    ['a non-string glyph', { id: 'e', kind: 'wall', at: { line: 0, col: 0 }, glyph: 7 }],
    ['a fractional col', { id: 'e', kind: 'wall', at: { line: 0, col: 1.5 }, glyph: '#' }],
    ['a negative col', { id: 'e', kind: 'wall', at: { line: 0, col: -1 }, glyph: '#' }],
    ['a broken far corner', { id: 'e', kind: 'wall', at: { line: 0, col: 0 }, to: { line: 0 }, glyph: '#' }],
    ['not an object at all', 'wall'],
    ['null', null],
  ];

  for (const [what, entity] of undrawable) {
    it(what, () => {
      const entities = [entity as Entity];
      expect(drawableEntities(entities)).toEqual([]);
      expect(stageCells(['abc'], entities)).toEqual(stageCells(['abc'], []));
      expect(entityAt(entities, { line: 0, col: 0 })).toBeUndefined();
    });
  }

  it('keeps the drawable ones beside an undrawable one', () => {
    expect(drawableEntities([goal, 'junk' as unknown as Entity, wall])).toEqual([goal, wall]);
  });

  it('returns the SAME array when nothing needs filtering', () => {
    // Filtering unconditionally would hand React a fresh array every render.
    const entities = [goal, wall];
    expect(drawableEntities(entities)).toBe(entities);
  });
});

describe('the frame is bounded, because it is an allocation', () => {
  it('does not widen at all for a runaway entity column', () => {
    // Measured: `col: 1e9` made `padEnd` throw `RangeError: Invalid string
    // length` out of a React effect; `col: 1e6` built eighteen million cells and
    // then set `canvas.width` past the 65535 a browser accepts. Even capped at
    // MAX_FRAME_COLS it squeezed the buffer pane to nothing on screen, so the
    // frame stops at the end-of-line position instead.
    const far: Entity = { id: 'e', kind: 'goal', at: { line: 0, col: 1_000_000_000 }, glyph: 'X' };
    const cells = stageCells(['abc'], [far]);

    expect(cells.width).toBe(4);
    expect(cells.cells).toHaveLength(4);
    expect(cells.cells.every((cell) => cell.char !== 'X')).toBe(true);
  });

  it('caps a runaway LINE the same way, since either can be hand-edited', () => {
    const cells = stageCells(['x'.repeat(100_000)], []);
    expect(cells.width).toBe(512);
    expect(cells.cells).toHaveLength(512);
  });
});

describe('an anchor outside the frame is dropped, not wrapped', () => {
  it('does not extend the cell array at exactly buffer.height', () => {
    // `cells[1 * width + 0] = …` on a one-row buffer does not throw — it grows
    // the array, and `diffCells` then walks cells no row/col maps to. The
    // boundary is the value that matters: a far-away line is rejected by any
    // comparison at all, `height` itself only by the right one.
    const stray: Entity = { id: 'e', kind: 'goal', at: { line: 1, col: 0 }, glyph: 'X' };
    const cells = stageCells(['abc'], [stray]);

    expect(cells.cells).toHaveLength(cells.width * cells.height);
    expect(cellAt(cells, 0, 0)).toEqual({ char: 'a', fg: TEXT_FG, bg: TEXT_BG });
  });

  it('draws nothing at all into a zero-row frame', () => {
    const stray: Entity = { id: 'e', kind: 'goal', at: { line: 0, col: 0 }, glyph: 'X' };
    expect(stageCells([], [stray]).cells).toHaveLength(0);
  });
});

describe('inFrame', () => {
  it('is exclusive at both far edges and rejects negatives', () => {
    const cells = stageCells(['abc', 'def'], []);
    expect([
      inFrame(cells, { line: 0, col: 0 }),
      inFrame(cells, { line: 1, col: 2 }),
      inFrame(cells, { line: 2, col: 0 }),
      inFrame(cells, { line: 0, col: 3 }),
      inFrame(cells, { line: -1, col: 0 }),
      inFrame(cells, { line: 0, col: -1 }),
    ]).toEqual([true, true, false, false, false, false]);
  });
});

describe('entityAt', () => {
  it('resolves the topmost entity, matching the paint order', () => {
    const over: Entity = { ...goal, id: 'over', kind: 'threat', glyph: '?' };
    expect(entityAt([goal, over], { line: 0, col: 1 })?.id).toBe('over');
    expect(entityAt([over, goal], { line: 0, col: 1 })?.id).toBe('exit');
  });

  it('is undefined on a bare text cell', () => {
    expect(entityAt([goal], { line: 0, col: 0 })).toBeUndefined();
  });

  it('covers a rectangle both corners inclusive', () => {
    expect(entityAt([wall], { line: 1, col: 2 })?.id).toBe('sealed');
    expect(entityAt([wall], { line: 1, col: 3 })).toBeUndefined();
  });
});
