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
import { describe, expect, it } from 'vitest';

import { blankStage } from './draft.ts';
import { bufferFromText, initialState, reduce, textFromBuffer, type EditorState } from './store.ts';

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
  const state = (): EditorState => ({ draft: blankStage(), selection: 'exit' });

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
    expect(initialState()).toEqual({ draft: blankStage(), selection: undefined });
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
