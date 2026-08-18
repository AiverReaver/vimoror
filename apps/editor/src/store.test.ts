/**
 * store.ts — the reducer, and the one conversion in it that carries real logic.
 *
 * The textarea round trip is a property rather than three examples because it is
 * the path every keystroke in the editor takes: text in, lines out, text back.
 * A lossy step there would corrupt the buffer of whatever stage was open, and it
 * would do so silently — the grid would redraw and the schema would still say
 * the stage is valid.
 */

import fc from 'fast-check';
import { GameSession, parseStage } from '@vimorror/game';
import { describe, expect, it } from 'vitest';

import { blankBeat, blankStage, exportStage, specsOrAbsent, withOption } from './draft.ts';
import {
  bufferFromText,
  initialState,
  reduce,
  textFromBuffer,
  type EditorAction,
  type EditorState,
} from './store.ts';

describe('text and lines are exact inverses', () => {
  it('PROPERTY: any textarea value survives the round trip', () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        expect(textFromBuffer(bufferFromText(text))).toBe(text);
      }),
    );
  });

  it('PROPERTY: any newline-free line list survives the round trip', () => {
    // Newline-free is not a restriction the reducer imposes — `lineSchema`
    // rejects a line containing one, so it is the only shape a valid buffer has.
    fc.assert(
      fc.property(fc.array(fc.string().filter((s) => !s.includes('\n')), { minLength: 1 }), (lines) => {
        expect(bufferFromText(textFromBuffer(lines))).toEqual(lines);
      }),
    );
  });

  it('lands Vim\'s own floor for an empty textarea', () => {
    // `min(1, 'a buffer has at least one line (an empty buffer is [""])')` — and
    // `''.split('\n')` gives it for free, so there is no floor to enforce here.
    expect(bufferFromText('')).toEqual(['']);
  });

  it('keeps a trailing blank line, which is a real line', () => {
    expect(bufferFromText('a\n')).toEqual(['a', '']);
  });

  it('leaves a carriage return alone — it is content, not a line break', () => {
    // The documented no-`\r`-handling promise, and unreachable by the property
    // above: fast-check's default `fc.string()` charset is printable ASCII, so a
    // `\r` never appears in 100 runs or in 50,000. A `\r` cannot arrive from a
    // textarea (HTML normalises the API value) and `readDraft` now refuses a FILE
    // carrying one, which is what leaves this function free of the rewrite.
    expect(bufferFromText('a\rb')).toEqual(['a\rb']);
    expect(textFromBuffer(bufferFromText('a\rb'))).toBe('a\rb');
  });
});

describe('reduce', () => {
  const state = (): EditorState => ({ draft: blankStage(), selection: 'exit', tool: undefined });

  it('typing replaces only the buffer', () => {
    const before = state();
    const after = reduce(before, { kind: 'buffer-typed', text: 'one\ntwo' });

    expect(after.draft.buffer).toEqual(['one', 'two']);
    expect({ ...after.draft, buffer: before.draft.buffer }).toEqual(before.draft);
    expect(after.selection).toBe('exit');
  });

  it('opening a draft drops the selection', () => {
    // The selection is an entity id, and the incoming stage's ids have nothing
    // to do with the outgoing one's — a stale id leaves the panels acting on
    // nothing while still reading as a selection.
    const opened = { ...blankStage(), id: 'other' };
    expect(reduce(state(), { kind: 'draft-opened', draft: opened })).toEqual({
      draft: opened,
      selection: undefined,
      tool: undefined,
    });
  });

  it('selecting and clearing are the same action', () => {
    expect(reduce(state(), { kind: 'entity-selected', id: 'wall' }).selection).toBe('wall');
    expect(reduce(state(), { kind: 'entity-selected', id: undefined }).selection).toBeUndefined();
  });

  it('never mutates the state it is given', () => {
    const before = state();
    const snapshot = structuredClone(before);
    reduce(before, { kind: 'buffer-typed', text: 'changed' });
    expect(before).toEqual(snapshot);
  });

  it('starts on a draft that parses', () => {
    expect(initialState()).toEqual({ draft: blankStage(), selection: undefined, tool: undefined });
  });

  it('hands back a FRESH draft every call', () => {
    // A shared instance is structurally identical to a fresh one, so `toEqual`
    // above cannot see the difference — and the difference is that the reducer's
    // spreads are shallow, so one mutation reachable through a shared `buffer` or
    // `entities` array would leak into the next new stage.
    expect(initialState()).not.toBe(initialState());
    expect(initialState().draft).not.toBe(initialState().draft);
    expect(initialState().draft.buffer).not.toBe(initialState().draft.buffer);
  });
});

/**
 * The blank stage, one entity selected — the same starting point `describe('reduce')`
 * above uses, hoisted so the Wave C blocks can share it.
 */
const editing = (): EditorState => ({ draft: blankStage(), selection: 'exit', tool: undefined });

describe('field-set is one action for all fourteen fields', () => {
  it('sets a value', () => {
    const after = reduce(editing(), { kind: 'field-set', field: 'title', value: 'Word Power' });
    expect(after.draft.title).toBe('Word Power');
  });

  it('clearing removes the key, so an omitted field stays omitted', () => {
    const gated = { ...editing(), draft: { ...blankStage(), allowedKeys: ['hjkl'] } };
    const after = reduce(gated, { kind: 'field-set', field: 'allowedKeys', value: undefined });
    expect(Object.hasOwn(after.draft, 'allowedKeys')).toBe(false);
  });

  it('leaves the selection and the tool alone', () => {
    const armed = { ...editing(), tool: 'wall' as const };
    const after = reduce(armed, { kind: 'field-set', field: 'act', value: 2 });
    expect({ selection: after.selection, tool: after.tool }).toEqual({ selection: 'exit', tool: 'wall' });
  });
});

describe('painting an entity', () => {
  const armed = (tool: 'goal' | 'wall'): EditorState => ({ ...editing(), tool });

  it('normalises the drag and selects what it made', () => {
    const after = reduce(armed('wall'), { kind: 'entity-painted', from: { line: 3, col: 8 }, to: { line: 1, col: 2 } });
    const entities = after.draft.entities ?? [];

    expect(entities).toHaveLength(2);
    expect(entities[1]).toEqual({
      id: 'wall',
      kind: 'wall',
      at: { line: 1, col: 2 },
      to: { line: 3, col: 8 },
      glyph: '#',
    });
    expect(after.selection).toBe('wall');
  });

  it('disarms the tool, so the next click selects instead of painting again', () => {
    const after = reduce(armed('wall'), { kind: 'entity-painted', from: { line: 0, col: 0 }, to: { line: 0, col: 0 } });
    expect(after.tool).toBeUndefined();
  });

  it('never collides with an id already in the stage', () => {
    // `blankStage`'s own entity is a goal called `exit`, so the collision this
    // guards is between two PAINTED entities of the same kind.
    const once = reduce(armed('goal'), { kind: 'entity-painted', from: { line: 0, col: 0 }, to: { line: 0, col: 0 } });
    const twice = reduce({ ...once, tool: 'goal' }, { kind: 'entity-painted', from: { line: 0, col: 1 }, to: { line: 0, col: 1 } });
    expect((twice.draft.entities ?? []).map((e) => e.id)).toEqual(['exit', 'goal', 'goal-2']);
  });

  it('is a no-op with no tool armed', () => {
    const before = editing();
    expect(reduce(before, { kind: 'entity-painted', from: { line: 0, col: 0 }, to: { line: 1, col: 1 } })).toBe(before);
  });

  it('survives a draft whose entities are not an array', () => {
    // `readDraft` admits it and the schema reports it; the reducer must not be
    // the thing that turns it into a crash.
    const broken: EditorState = { draft: { ...blankStage(), entities: 3 as never }, selection: undefined, tool: 'wall' };
    const after = reduce(broken, { kind: 'entity-painted', from: { line: 0, col: 0 }, to: { line: 0, col: 0 } });
    expect(after.draft.entities).toEqual([{ id: 'wall', kind: 'wall', at: { line: 0, col: 0 }, glyph: '#' }]);
  });
});

describe('picking a tool', () => {
  it('arms and disarms', () => {
    expect(reduce(editing(), { kind: 'tool-picked', tool: 'threat' }).tool).toBe('threat');
    expect(reduce({ ...editing(), tool: 'threat' }, { kind: 'tool-picked', tool: undefined }).tool).toBeUndefined();
  });

  it('goes away when a different stage is opened', () => {
    const armed: EditorState = { ...editing(), tool: 'wall' };
    expect(reduce(armed, { kind: 'draft-opened', draft: blankStage() }).tool).toBeUndefined();
  });
});

/**
 * **Wave C's done-line, as one test.** "A stage goes from `blankStage()` to
 * exported-and-valid without hand-editing JSON" — so every step below is an
 * action the UI dispatches, nothing reaches into the draft directly, and the
 * result is put through `parseStage` (which throws on any issue) and then through
 * a real `GameSession` to prove the stage it describes is one the game can load.
 */
describe('a whole stage authored through the reducer alone', () => {
  it('parses, plays and exports with no default materialized', () => {
    const acts: EditorAction[] = [
      { kind: 'field-set', field: 'id', value: 'word-power' },
      { kind: 'field-set', field: 'title', value: 'Word Power' },
      { kind: 'field-set', field: 'act', value: 1 },
      { kind: 'buffer-typed', text: 'the quick brown fox' },
      { kind: 'field-set', field: 'entities', value: [] },
      { kind: 'tool-picked', tool: 'goal' },
      { kind: 'entity-painted', from: { line: 0, col: 16 }, to: { line: 0, col: 16 } },
      { kind: 'field-set', field: 'win', value: [{ kind: 'cursor-on', entity: 'goal' }] },
      { kind: 'field-set', field: 'lose', value: [{ kind: 'keystrokes-over', max: 20 }] },
      { kind: 'field-set', field: 'beats', value: [blankBeat([], 'goal')] },
      { kind: 'field-set', field: 'allowedKeys', value: specsOrAbsent(['w', 'b', 'e']) },
      { kind: 'field-set', field: 'teachesKeys', value: specsOrAbsent(['w']) },
      { kind: 'field-set', field: 'options', value: withOption(undefined, 'shiftwidth', 2) },
      { kind: 'field-set', field: 'solution', value: 'www' },
      { kind: 'field-set', field: 'par', value: 3 },
    ];
    const { draft } = acts.reduce(reduce, initialState());

    const stage = parseStage(draft);
    const session = new GameSession(stage);
    session.feedKeys(stage.solution);
    expect(session.outcome.status).toBe('won');

    // And the export is still the AUTHORED shape: nine defaults the author never
    // wrote stay out of the file, which is the property `draft.ts` exists for.
    const exported = JSON.parse(exportStage(draft)) as Record<string, unknown>;
    expect(Object.keys(exported)).toEqual([
      'id',
      'act',
      'title',
      'buffer',
      'entities',
      'allowedKeys',
      'teachesKeys',
      'par',
      'solution',
      'win',
      'lose',
      'beats',
      'options',
    ]);
    expect(exported['options']).toEqual({ shiftwidth: 2 });
    expect(exported['cursor']).toBeUndefined();
  });
});
