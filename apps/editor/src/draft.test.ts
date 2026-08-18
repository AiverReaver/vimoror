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
import { GameSession, parseStage } from '@vimorror/game';
import { describe, expect, it } from 'vitest';

import { blankStage, exportStage, parseDraft, readDraft, stageFileName } from './draft.ts';

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
