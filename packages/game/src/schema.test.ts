/**
 * schema.ts — the stage contract.
 *
 * Wave B's done-line is "a human can author a stage as JSON and get a precise
 * error for every way of getting it wrong", so most of this file is negative
 * cases. Each one names, in its title or a comment, what would SILENTLY pass
 * without it — Wave A's lesson was that on this surface wrong looks exactly
 * like right, and a schema test that only proves valid stages parse is the same
 * mistake in a new file.
 *
 * Imports run through `index.ts` rather than the modules directly, so the
 * barrel cannot go stale unnoticed (M1 Wave E's lesson).
 */

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEFAULT_OPTIONS, VimEngine } from '@vimorror/core';

import { expandKeySpecs, formatIssues, parseStage, safeParseStage } from './index.ts';

type RawStage = Record<string, unknown>;

/** Valid. Every negative case below is this with exactly one thing broken. */
const base: RawStage = {
  id: 'test-stage',
  act: 1,
  title: 'Test',
  buffer: ['alpha beta', 'gamma'],
  cursor: { line: 0, col: 0 },
  entities: [{ id: 'goal', kind: 'goal', at: { line: 1, col: 0 }, glyph: 'X' }],
  allowedKeys: ['hjkl', 'G', '$'],
  teachesKeys: ['G'],
  par: 2,
  solution: 'G',
  win: [{ kind: 'cursor-on', entity: 'goal' }],
};

const withBase = (patch: RawStage): RawStage => ({ ...base, ...patch });

/** `path: message` for every issue, which is what an author actually reads. */
function issues(input: RawStage): string[] {
  const result = safeParseStage(input);
  return result.success ? [] : result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
}

const rejects = (input: RawStage, pattern: RegExp): void => {
  const found = issues(input);
  expect(found.some((i) => pattern.test(i))).toBe(true);
};

describe('a valid stage', () => {
  it('parses', () => {
    expect(safeParseStage(base).success).toBe(true);
  });

  it('resolves every default, so consumers never see undefined for them', () => {
    const stage = parseStage({
      id: 'm',
      act: 1,
      title: 'M',
      buffer: ['x'],
      par: 1,
      solution: 'x',
      win: [{ kind: 'buffer-equals', lines: [''] }],
    });
    expect(stage.cursor).toEqual({ line: 0, col: 0 });
    expect(stage.entities).toEqual([]);
    expect(stage.teachesKeys).toEqual([]);
    expect(stage.lose).toEqual([]);
    expect(stage.beats).toEqual([]);
    expect(stage.options).toEqual(DEFAULT_OPTIONS);
    // NOT defaulted: `[]` and "absent" mean different things to a KeyPolicy, so
    // the field stays undefined rather than a default picking one silently.
    expect(stage.allowedKeys).toBeUndefined();
  });
});

describe('shape', () => {
  it('rejects an unrecognised field', () => {
    // Without .strict(), a typo'd "beat"/"beats" drops the whole array and the
    // stage plays with no story at all.
    rejects(withBase({ beat: [] }), /Unrecognized key/);
  });

  it('rejects a buffer line containing a newline', () => {
    // Reaches vim-core as ONE line holding a literal \n, which every motion,
    // operator and golden-verified rule then disagrees with.
    rejects(withBase({ buffer: ['one\ntwo'] }), /^buffer\.0: .*newline/);
  });

  it('rejects a zero-line buffer', () => {
    rejects(withBase({ buffer: [] }), /^buffer: .*at least one line/);
  });

  it('rejects a glyph that is not exactly one character', () => {
    const patch = { entities: [{ id: 'goal', kind: 'goal', at: { line: 1, col: 0 }, glyph: 'XY' }] };
    rejects(withBase(patch), /^entities\.0\.glyph:/);
  });

  it('rejects a stage with no win condition', () => {
    rejects(withBase({ win: [] }), /^win: .*at least one win condition/);
  });
});

describe('key specs', () => {
  it('rejects a misspelled macro instead of silently tokenizing it', () => {
    // `{printabl}` tokenizes without throwing into `{`, `p`, `r`, ... — the
    // stage would gate on eleven ordinary keys and the author never find out.
    rejects(withBase({ allowedKeys: ['{printabl}'] }), /^allowedKeys\.0: unknown key macro/);
  });

  it('rejects notation vim-core cannot tokenize', () => {
    rejects(withBase({ allowedKeys: ['<Bogus>'] }), /^allowedKeys\.0: not valid key notation/);
  });

  it('expands a spec to the tokens the key policy is actually checked against', () => {
    expect([...expandKeySpecs(['hjkl'])]).toEqual(['h', 'j', 'k', 'l']);
    // The policy is per-keystroke, so `gg` contributes one distinct key.
    expect([...expandKeySpecs(['gg'])]).toEqual(['g']);
    expect([...expandKeySpecs(['<Esc>', '<Esc>'])]).toEqual(['<Esc>']);
  });

  it('expands {printable} to all 95 printable characters', () => {
    const tokens = expandKeySpecs(['{printable}']);
    expect(tokens.size).toBe(95);
    expect(tokens.has(' ')).toBe(true);
    expect(tokens.has('~')).toBe(true);
  });

  it('rejects an explicitly empty allowedKeys', () => {
    // `[]` permits NO key. Treating it as "ungated" would be the opposite of
    // what it says, so it is an error and omission is the way to say ungated.
    rejects(withBase({ allowedKeys: [] }), /^allowedKeys: .*omit the field/);
  });
});

describe('positions', () => {
  it('rejects a spawn outside the buffer', () => {
    // VimEngine CLAMPS a bad cursor rather than refusing it, so without this
    // the player silently starts somewhere the author did not choose.
    rejects(withBase({ cursor: { line: 0, col: 40 } }), /^cursor: .*silently clamp/);
    rejects(withBase({ cursor: { line: 9, col: 0 } }), /^cursor: /);
  });

  it('rejects an entity outside the buffer', () => {
    const patch = { entities: [{ id: 'goal', kind: 'goal', at: { line: 9, col: 0 }, glyph: 'X' }] };
    rejects(withBase(patch), /^entities\.0\.at: 9:0 is outside the buffer/);
  });

  it('rejects a rectangle whose far corner is before its origin', () => {
    const patch = {
      entities: [
        { id: 'goal', kind: 'goal', at: { line: 1, col: 0 }, glyph: 'X' },
        { id: 'w', kind: 'wall', at: { line: 0, col: 5 }, to: { line: 0, col: 2 }, glyph: '#' },
      ],
    };
    rejects(withBase(patch), /^entities\.1\.to: must be at or after/);
  });
});

describe('references', () => {
  it('rejects duplicate entity ids', () => {
    const patch = {
      entities: [
        { id: 'goal', kind: 'goal', at: { line: 1, col: 0 }, glyph: 'X' },
        { id: 'goal', kind: 'wall', at: { line: 0, col: 0 }, glyph: '#' },
      ],
    };
    rejects(withBase(patch), /^entities: duplicate entity id "goal"/);
  });

  it('rejects a condition naming an entity that does not exist', () => {
    // A win condition that can never fire is an unwinnable stage that parses.
    rejects(withBase({ win: [{ kind: 'cursor-on', entity: 'nope' }] }), /^win\.0\.entity: no entity with id/);
  });

  it('checks a beat trigger reference too, not only win and lose', () => {
    const patch = {
      beats: [{ id: 'b', text: 'x', startling: false, on: { kind: 'cursor-on', entity: 'nope' } }],
    };
    rejects(withBase(patch), /^beats\.0\.on\.entity: no entity with id/);
  });

  it('rejects a threat condition in a stage with no threat', () => {
    // Named for the threat doing the reaching, so with none drawn it never
    // fires: dead config in `lose`, an unwinnable stage in `win`. `base` has
    // only a goal.
    rejects(withBase({ lose: [{ kind: 'threat-reaches-cursor' }] }), /^lose\.0: .*no threat entity/);
    rejects(withBase({ win: [{ kind: 'threat-reaches-cursor' }] }), /^win\.0: .*no threat entity/);
  });

  it('rejects duplicate beat ids', () => {
    const beat = { text: 'x', startling: false, on: { kind: 'cursor-on', entity: 'goal' } };
    rejects(withBase({ beats: [{ id: 'b', ...beat }, { id: 'b', ...beat }] }), /^beats: duplicate beat id/);
  });
});

describe('comfort', () => {
  it('requires every beat to declare whether it is startling', () => {
    // A default of `false` is the dangerous direction: an author who forgets
    // the flag ships a startle beat that fires for a player who asked for none.
    const patch = { beats: [{ id: 'b', text: 'x', on: { kind: 'cursor-on', entity: 'goal' } }] };
    rejects(withBase(patch), /^beats\.0\.startling: Required/);
  });
});

describe('playability', () => {
  it('rejects a stage that teaches a key it locks', () => {
    rejects(withBase({ teachesKeys: ['dd'] }), /^teachesKeys\.0: teaches "d", which allowedKeys locks/);
  });

  it('rejects a solution the stage would reject', () => {
    rejects(withBase({ solution: 'dw', par: 5 }), /^solution: uses "d", "w", which allowedKeys locks/);
  });

  it('rejects a par the shipped solution cannot reach', () => {
    rejects(withBase({ solution: 'hjkl', par: 2 }), /^par: par is 2 but the solution takes 4 keystrokes/);
  });

  it('rejects a solution that is not valid key notation', () => {
    rejects(withBase({ solution: '<Bogus>' }), /^solution: not valid key notation/);
  });

  it('rejects a stage already won at spawn', () => {
    // Parses, renders, and is over before the player presses anything.
    rejects(withBase({ cursor: { line: 1, col: 0 } }), /^win: every win condition already holds at spawn/);
    rejects(
      withBase({ win: [{ kind: 'buffer-equals', lines: ['alpha beta', 'gamma'] }] }),
      /^win: every win condition already holds at spawn/,
    );
  });

  it('does not flag a stage whose win set includes a runtime-only condition', () => {
    // Conservative by design: one undecidable condition means "not yet won".
    const patch = {
      cursor: { line: 1, col: 0 },
      entities: [
        { id: 'goal', kind: 'goal', at: { line: 1, col: 0 }, glyph: 'X' },
        { id: 't', kind: 'threat', at: { line: 0, col: 0 }, glyph: '?' },
      ],
      win: [{ kind: 'cursor-on', entity: 'goal' }, { kind: 'threat-reaches-cursor' }],
    };
    expect(issues(withBase(patch))).toEqual([]);
  });

  it('rejects a keystroke budget below the shipped solution', () => {
    // par is a target; a `lose` budget is a hard floor, so a budget under the
    // solution's own length loses the stage before that solution can win it.
    rejects(withBase({ solution: 'hjkl', par: 4, lose: [{ kind: 'keystrokes-over', max: 3 }] }), /^lose\.0\.max: .*lost before its own solution/);
  });
});

describe('options', () => {
  it('fills every :set option from core defaults, overriding only what the stage names', () => {
    // A COMPLETE EditorOptions, not a partial — see the seam test below.
    expect(parseStage(withBase({ options: { shiftwidth: 2 } })).options).toEqual({
      ...DEFAULT_OPTIONS,
      shiftwidth: 2,
    });
  });

  it('rejects an option vim-core does not have', () => {
    rejects(withBase({ options: { shiftwidht: 2 } }), /^options: Unrecognized key/);
  });
});

describe('parseStage', () => {
  it('throws with a readable path per issue', () => {
    expect(() => parseStage(withBase({ act: 9 }))).toThrow(/act: Number must be less than or equal to 6/);
  });

  it('safeParseStage never throws', () => {
    expect(safeParseStage(null).success).toBe(false);
    expect(safeParseStage(undefined).success).toBe(false);
    expect(safeParseStage([]).success).toBe(false);
  });

  it('formatIssues renders one line per issue', () => {
    const result = safeParseStage(withBase({ act: 9, title: '' }));
    expect(result.success).toBe(false);
    if (!result.success) expect(formatIssues(result.error).split('\n')).toHaveLength(2);
  });
});

describe('content/stages', () => {
  const dir = fileURLToPath(new URL('../../../content/stages', import.meta.url));
  const files = readdirSync(dir).filter((f) => f.endsWith('.json'));

  it('has fixtures to check', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)('%s validates', (file) => {
    const raw: unknown = JSON.parse(readFileSync(`${dir}/${file}`, 'utf8'));
    expect(() => parseStage(raw)).not.toThrow();
  });

  /**
   * The seam Wave C's `session.ts` will use, and the reason `options` parses to
   * a complete `EditorOptions` instead of a partial: a parsed stage must drop
   * straight into `new VimEngine(...)` with no merge step. This test is also
   * the honest half of M3's validator — it proves the shipped solution runs
   * under the stage's OWN key policy without a single rejection. Asserting it
   * actually WINS needs `rules.ts`, which is Wave C.
   */
  it.each(files)('%s plays its own solution with no key rejected', (file) => {
    const stage = parseStage(JSON.parse(readFileSync(`${dir}/${file}`, 'utf8')));
    const engine = new VimEngine(stage.buffer, stage.cursor, stage.options);
    if (stage.allowedKeys !== undefined) {
      engine.setKeyPolicy({ allowed: expandKeySpecs(stage.allowedKeys) });
    }
    const rejected = engine.feedKeys(stage.solution).filter((e) => e.type === 'KeyRejected');
    expect(rejected).toEqual([]);
    // At rest, so the solution is a whole command and not a half-typed one.
    expect(engine.pending.keyBuffer).toEqual([]);
  });
});
