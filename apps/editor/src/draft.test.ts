/**
 * draft.ts — the document model, and the one property the whole input-type
 * decision exists for: **a fixture imported and exported unedited comes back
 * byte-identical.**
 *
 * That test is the wave's real gate. It is also written so that it FAILS the way
 * the plan predicts it would fail if the model were the parsed `Stage` instead:
 * the same export run over a parsed stage is asserted to gain the seven `options`
 * and the four empty arrays the author never wrote, so the identity test above it
 * is provably not vacuous.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENTITY_KINDS, GameSession, parseStage } from '@vimorror/game';
import { describe, expect, it } from 'vitest';

import {
  blankBeat,
  blankCondition,
  blankEntity,
  blankStage,
  CONDITION_KINDS,
  exportStage,
  listOf,
  nextId,
  parseDraft,
  readDraft,
  rectFrom,
  specsOrAbsent,
  stageFileName,
  withField,
  withOption,
  type DraftEntity,
  type StageDraft,
} from './draft.ts';

const stagesDir = fileURLToPath(new URL('../../../content/stages', import.meta.url));

const fixtures = readdirSync(stagesDir).filter((f) => f.endsWith('.json'));

const readFixture = (file: string): string => readFileSync(join(stagesDir, file), 'utf8');

describe('a fixture survives import and export unchanged', () => {
  for (const file of fixtures) {
    it(file, () => {
      const original: unknown = JSON.parse(readFixture(file));
      const exported: unknown = JSON.parse(exportStage(readDraft(readFixture(file))));

      expect(exported).toEqual(original);
      // Key order too, in the same assertion set: the fixtures are already in
      // schema order, so this pins BOTH that no field was materialized or
      // dropped and that an exported stage diffs against `content/stages/` the
      // way the hand-authored ones read.
      expect(Object.keys(exported as object)).toEqual(Object.keys(original as object));
    });
  }
});

describe('exporting the PARSED stage is the failure this model avoids', () => {
  it('bakes in every default the author never wrote', () => {
    const raw: unknown = JSON.parse(readFixture('act1-two-worlds.json'));
    const authored = Object.keys(raw as object);
    const parsed = Object.keys(JSON.parse(exportStage(parseStage(raw))) as object);

    expect(authored).toEqual(['id', 'act', 'title', 'buffer', 'par', 'solution', 'win']);
    expect(parsed.filter((k) => !authored.includes(k))).toEqual([
      'cursor',
      'entities',
      'teachesKeys',
      'lose',
      'beats',
      'options',
    ]);
  });

  it('cannot represent an omitted allowedKeys at all', () => {
    // The one that changes MEANING rather than verbosity: omitted is ungated,
    // `[]` is rejected outright, and the parse has already collapsed the first
    // into the same `undefined` as everything else.
    const raw: unknown = JSON.parse(readFixture('act1-two-worlds.json'));
    expect(parseStage(raw).allowedKeys).toBeUndefined();
    expect(Object.keys(JSON.parse(exportStage(parseStage(raw))) as object)).not.toContain('allowedKeys');
  });
});

describe('readDraft', () => {
  it('is exportStage inverted', () => {
    const draft = blankStage();
    expect(readDraft(exportStage(draft))).toEqual(draft);
  });

  it('rejects a file whose buffer is not lines of text', () => {
    const rejects = (text: string): void => {
      expect(() => readDraft(text)).toThrow(/expected a JSON object whose "buffer" is an array of strings/);
    };
    rejects('null');
    rejects('42');
    rejects('"a string"');
    rejects('[]');
    rejects('{}');
    rejects('{"buffer": "one line"}');
    rejects('{"buffer": ["ok", 7]}');
  });

  it('leaves a JSON syntax error as itself', () => {
    // The author needs to know it is not JSON, which is a different problem from
    // it not being a stage — SyntaxError's own message names the position.
    expect(() => readDraft('{')).toThrow(SyntaxError);
  });

  it('refuses a line break INSIDE a line, which the editor cannot hold without renumbering', () => {
    // Not a duplicate of `lineSchema`: a textarea normalises its own value's line
    // breaks, so this file would load, report the schema's error correctly, and
    // then have that line split in two by the author's first keystroke — moving
    // every `cursor` and `entities[].at.line` below it onto different content.
    for (const text of ['{"buffer": ["a\\nb"]}', '{"buffer": ["a\\rb"]}', '{"buffer": ["ok", "a\\r\\nb"]}']) {
      expect(() => readDraft(text)).toThrow(/line break inside a buffer line/);
    }
  });

  it('accepts a buffer-shaped file that the schema will still reject', () => {
    // The door is narrower than the schema on purpose: this loads, and the
    // issues pane is what tells the author about the missing id, act and title.
    const draft = readDraft('{"buffer": ["hello"]}');
    expect(draft.buffer).toEqual(['hello']);
    expect(parseDraft(draft).ok).toBe(false);
  });
});

describe('an exported stage is a text file someone will diff', () => {
  it('is indented and newline-terminated', () => {
    // Both survived a mutation sweep, and both are invisible to the identity test
    // above because it parses the JSON before comparing. Neither is cosmetic: an
    // un-indented export is one unreviewable line in a `content/stages/` diff, and
    // a missing trailing newline makes every future edit show as a two-line change.
    const text = exportStage(blankStage());
    expect(text.endsWith('\n')).toBe(true);
    expect(text.split('\n')[1]).toBe('  "id": "new-stage",');
  });

  it('does not reproduce the fixtures\' own hand-formatting, only their content', () => {
    // Worth knowing before diffing an export against a fixture: the committed
    // stages were formatted with inline positions (`{ "line": 0, "col": 0 }`) and
    // `JSON.stringify` spreads those over three lines. Content and key order match
    // exactly — which is what `validate:stages` and the identity test check — and
    // the whitespace does not. Wave E's export polish is where that would change.
    const round = exportStage(readDraft(readFixture('act2-grammar-awakens.json')));
    expect(round).toContain('"line": 0');
    expect(round).not.toContain('{ "line": 0, "col": 0 }');
  });
});

describe('stageFileName', () => {
  it('is the validator\'s own rule — the id, and nothing else', () => {
    expect(stageFileName(blankStage())).toBe('new-stage.json');
  });

  it('never offers a name built from a missing or non-string id', () => {
    // `id` is required in `StageInput` at the TYPE level and absent at RUNTIME
    // for anything `readDraft` admits, which used to produce literally
    // `undefined.json` and `[object Object].json` — the two names the rule exists
    // to prevent.
    const named = (id: unknown): string => stageFileName({ ...blankStage(), id } as ReturnType<typeof blankStage>);
    expect([named(undefined), named(''), named({ a: 1 }), named(7)]).toEqual([
      'untitled-stage.json',
      'untitled-stage.json',
      'untitled-stage.json',
      'untitled-stage.json',
    ]);
  });
});

describe('blankStage', () => {
  it('parses', () => {
    expect(parseDraft(blankStage()).ok).toBe(true);
  });

  it('writes only the required fields, so a blank export materializes nothing', () => {
    expect(Object.keys(JSON.parse(exportStage(blankStage())) as object)).toEqual([
      'id',
      'act',
      'title',
      'buffer',
      'entities',
      'par',
      'solution',
      'win',
    ]);
  });

  it('ships a placeholder solution that deliberately does NOT win', () => {
    // Honest scaffolding: an exported stage whose solution was never recorded has
    // to fail `validate:stages` loudly. A placeholder that happened to win would
    // ship a stage nobody had playtested.
    const stage = parseStage(blankStage());
    const session = new GameSession(stage);
    session.feedKeys(stage.solution);
    expect(session.outcome.status).toBe('playing');
  });

  it('puts the goal on a cell a resting cursor can actually reach', () => {
    // `col === line.length` is inside the buffer as far as the schema is
    // concerned, and unreachable by a normal-mode cursor — a `cursor-on` win
    // naming a goal drawn there could never fire and nothing would say so.
    const stage = parseStage(blankStage());
    const goal = stage.entities[0]!;
    expect(goal.at.col).toBe(stage.buffer[0]!.length - 1);
  });
});

// ---------------------------------------------------------------------------
// Wave C — the shapes the panels build, and the two rules that keep an export
// honest while they do it
// ---------------------------------------------------------------------------

describe('the blank factories parse', () => {
  // Each one is what an author gets from a click, so a factory that lands on an
  // error is the editor handing them a problem they did not cause. The whole
  // point of `blankCondition`'s entity argument, and of writing `startling`
  // explicitly rather than defaulting it.
  it('a painted entity of every kind', () => {
    for (const kind of ENTITY_KINDS) {
      const draft: StageDraft = {
        ...blankStage(),
        entities: [...listOf<DraftEntity>(blankStage().entities), blankEntity(kind, { at: { line: 0, col: 0 } }, ['exit'])],
      };
      const parse = parseDraft(draft);
      expect(parse.ok ? 'ok' : parse.issues).toBe('ok');
    }
  });

  it('a condition of every kind, once its entity exists', () => {
    for (const kind of CONDITION_KINDS) {
      const base = blankStage();
      const draft: StageDraft = {
        ...base,
        // `threat-reaches-cursor` is the one kind that needs a drawn threat
        // before it can fire, and the schema says so — so the fixture supplies
        // one rather than the factory pretending the condition is standalone.
        entities: [...listOf<DraftEntity>(base.entities), blankEntity('threat', { at: { line: 0, col: 0 } }, ['exit'])],
        lose: [blankCondition(kind, 'exit')],
      };
      const parse = parseDraft(draft);
      expect(parse.ok ? 'ok' : parse.issues).toBe('ok');
    }
  });

  it('a beat', () => {
    const draft: StageDraft = { ...blankStage(), beats: [blankBeat([], 'exit')] };
    const parse = parseDraft(draft);
    expect(parse.ok ? 'ok' : parse.issues).toBe('ok');
    // Not defaulted, and not defaultable: the schema requires the flag because a
    // forgotten one ships a startle to a player who asked for none.
    expect(draft.beats?.[0]?.startling).toBe(false);
  });
});

describe('rectFrom', () => {
  it('normalises both axes independently', () => {
    // Dragging up-and-left is the ordinary way to paint, and `at.col > to.col`
    // is the one rectangle shape `schema.ts` rejects outright.
    expect(rectFrom({ line: 3, col: 9 }, { line: 1, col: 2 })).toEqual({
      at: { line: 1, col: 2 },
      to: { line: 3, col: 9 },
    });
    // Per axis, not by corner: a drag down-and-left is neither corner as given.
    expect(rectFrom({ line: 1, col: 9 }, { line: 3, col: 2 })).toEqual({
      at: { line: 1, col: 2 },
      to: { line: 3, col: 9 },
    });
  });

  it('a single cell has no `to` at all', () => {
    // Both occupy the same one cell, so this is a claim about the exported JSON:
    // a one-cell goal reads as `at` alone, the way the fixtures write it.
    expect(rectFrom({ line: 2, col: 4 }, { line: 2, col: 4 })).toEqual({ at: { line: 2, col: 4 } });
    expect(Object.keys(rectFrom({ line: 2, col: 4 }, { line: 2, col: 4 }))).toEqual(['at']);
  });
});

describe('nextId', () => {
  it('takes the bare prefix first, then numbers', () => {
    expect(nextId('wall', [])).toBe('wall');
    expect(nextId('wall', ['wall'])).toBe('wall-2');
    expect(nextId('wall', ['wall', 'wall-2', 'wall-3'])).toBe('wall-4');
  });

  it('skips a gap rather than colliding with what is past it', () => {
    // The taken list is the author's, not the editor's: they may have renamed
    // `wall-2` and left `wall-3` behind.
    expect(nextId('wall', ['wall', 'wall-3'])).toBe('wall-2');
  });
});

describe('withField', () => {
  it('removes the key rather than storing undefined', () => {
    // The distinction the input-type decision rests on: `allowedKeys` present but
    // undefined is not the same document as `allowedKeys` absent, even though
    // both export identically today.
    const gated: StageDraft = { ...blankStage(), allowedKeys: ['hjkl'] };
    const ungated = withField(gated, 'allowedKeys', undefined);
    expect(Object.hasOwn(ungated, 'allowedKeys')).toBe(false);
    expect(exportStage(ungated)).not.toContain('allowedKeys');
  });

  it('clearing a REQUIRED field reports the gap, not a substituted value', () => {
    const parse = parseDraft(withField(blankStage(), 'par', undefined));
    expect(parse.ok).toBe(false);
    expect(parse.ok ? '' : parse.issues).toMatch(/^ {2}par: /m);
  });

  it('never mutates the draft it is given', () => {
    const before = blankStage();
    const snapshot = structuredClone(before);
    withField(before, 'title', 'changed');
    expect(before).toEqual(snapshot);
  });
});

describe('withOption', () => {
  it('overrides one option and leaves the other six unwritten', () => {
    expect(withOption(undefined, 'shiftwidth', 2)).toEqual({ shiftwidth: 2 });
  });

  it('the last override cleared takes the whole field with it', () => {
    // Otherwise the export keeps an `"options": {}` the author is not writing —
    // harmless to the parse, and exactly the drift the import→export identity
    // test above exists to catch.
    expect(withOption({ shiftwidth: 2 }, 'shiftwidth', undefined)).toBeUndefined();
    expect(withOption({ shiftwidth: 2, expandtab: true }, 'expandtab', undefined)).toEqual({ shiftwidth: 2 });
  });
});

describe('specsOrAbsent', () => {
  it('an empty textarea leaves the stage ungated', () => {
    // `''.split('\n')` is `['']`, so this is the shape an empty box really has.
    expect(specsOrAbsent([''])).toBeUndefined();
  });

  it('never produces the one value the schema rejects', () => {
    const emptied = withField({ ...blankStage(), allowedKeys: ['hjkl'] }, 'allowedKeys', specsOrAbsent(['']));
    expect(parseDraft(emptied).ok).toBe(true);
    // The alternative, spelt out: `[]` is not "no gating", it is "no keys".
    expect(parseDraft({ ...blankStage(), allowedKeys: [] }).ok).toBe(false);
  });

  it('keeps a blank line the author actually typed', () => {
    // Dropping it would delete the newline out from under the caret, since the
    // textarea's value is derived from state on every render.
    expect(specsOrAbsent(['hjkl', ''])).toEqual(['hjkl', '']);
  });
});

describe('listOf', () => {
  it('substitutes for a list field that is not a list', () => {
    // `readDraft` admits this on purpose; the panels map over it on the very next
    // render, and a throw there unmounts the issues pane that explains it.
    expect(listOf(3)).toEqual([]);
    expect(listOf(undefined)).toEqual([]);
    expect(parseDraft({ ...blankStage(), win: 3 as never }).ok).toBe(false);
  });

  it('does NOT filter a malformed member out', () => {
    // The panels write back by index, so dropping a member would renumber the
    // survivors and send the author's next edit to the wrong one.
    expect(listOf([null, { kind: 'cursor-on' }])).toHaveLength(2);
  });
});
