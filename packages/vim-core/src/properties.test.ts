/**
 * Property tests for invariants the goldens cannot enumerate.
 *
 * Goldens prove specific cases against real Vim; these prove statements that
 * must hold for EVERY buffer, which is where the warts that nobody wrote a
 * case for tend to hide.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { clamp, lineAt } from './buffer.ts';
import { tokenize } from './keys.ts';
import { initState, replay, step, type EditorState } from './state.ts';

/** Buffers weighted toward the shapes that break engines: empty lines, blanks, punctuation. */
const arbLines = fc.array(
  fc.oneof(
    fc.constant(''),
    fc.constant('   '),
    fc.stringMatching(/^[a-z]{1,8}$/),
    fc.stringMatching(/^[a-z]{1,4} [a-z]{1,4}$/),
    fc.stringMatching(/^[a-z]{1,3}[.,(){}[\]]{1,2}[a-z]{1,3}$/),
  ),
  { minLength: 1, maxLength: 6 },
);

const arbState = arbLines.chain((lines) =>
  fc.record({
    line: fc.integer({ min: 0, max: lines.length - 1 }),
    col: fc.integer({ min: 0, max: 12 }),
  }).map(({ line, col }) => initState(lines, clamp(lines, { line, col }, false))),
);

function feed(state: EditorState, notation: string): EditorState {
  return replay(state, tokenize(notation));
}

describe('invariants', () => {
  it('the cursor is always inside the buffer', () => {
    const keys = fc.array(
      fc.constantFrom('h', 'l', 'j', 'k', '0', '^', '$', 'w', 'b', 'e', 'W', 'B', 'E', 'G', '%', 'x', 'X'),
      { maxLength: 12 },
    );
    fc.assert(
      fc.property(arbState, keys, (s0, ks) => {
        const s = replay(s0, ks);
        expect(s.cursor.line).toBeGreaterThanOrEqual(0);
        expect(s.cursor.line).toBeLessThan(s.lines.length);
        const len = lineAt(s.lines, s.cursor.line).length;
        expect(s.cursor.col).toBeGreaterThanOrEqual(0);
        expect(s.cursor.col).toBeLessThanOrEqual(Math.max(0, len - 1));
      }),
    );
  });

  it('a buffer never becomes zero lines', () => {
    fc.assert(
      fc.property(arbState, fc.array(fc.constantFrom('x', 'X', 'u'), { maxLength: 10 }), (s0, ks) => {
        expect(replay(s0, ks).lines.length).toBeGreaterThanOrEqual(1);
      }),
    );
  });

  it('w then b never lands past where w started', () => {
    fc.assert(
      fc.property(arbState, (s0) => {
        const afterW = feed(s0, 'w');
        const back = feed(afterW, 'b');
        const before = s0.cursor;
        const after = back.cursor;
        const notPast = after.line < before.line || (after.line === before.line && after.col <= before.col);
        expect(notPast).toBe(true);
      }),
    );
  });

  it('u after any single change restores the exact prior buffer', () => {
    fc.assert(
      fc.property(
        arbState,
        fc.constantFrom('x', 'X', 'rZ', 'dd', 'dw', 'D', 'cwQ<Esc>', 'ccQ<Esc>', '>>', 'gUU', '~', 'iQ<Esc>', 'oQ<Esc>'),
        (s0, cmd) => {
          const changed = feed(s0, cmd);
          // Only meaningful when the command actually changed something.
          fc.pre(JSON.stringify(changed.lines) !== JSON.stringify(s0.lines));
          const undone = feed(changed, 'u');
          expect(undone.lines).toEqual(s0.lines);
        },
      ),
    );
  });

  it('dd reduces the line count by exactly one, except on a one-line buffer', () => {
    fc.assert(
      fc.property(arbState, (s0) => {
        const after = feed(s0, 'dd');
        const expected = s0.lines.length === 1 ? 1 : s0.lines.length - 1;
        expect(after.lines.length).toBe(expected);
      }),
    );
  });

  it('an operator abandoned with <Esc> is a no-op', () => {
    // Tokens rather than notation: a literal `<` next to `<Esc>` would parse
    // as a malformed named key.
    const ops = fc.constantFrom(['d'], ['c'], ['y'], ['>'], ['<'], ['2', 'd'], ['"', 'a', 'd'], ['g', 'U']);
    fc.assert(
      fc.property(arbState, ops, (s0, op) => {
        const s = replay(s0, [...op, '<Esc>']);
        expect(s.lines).toEqual(s0.lines);
        expect(s.cursor).toEqual(s0.cursor);
        expect(s.mode).toBe('normal');
        expect(s.pending.keyBuffer).toHaveLength(0);
      }),
    );
  });

  it('<Esc> cancels any half-typed command without touching the buffer', () => {
    const prefixes = fc.constantFrom('2', '"a', 'g', '3', '"z9', 'f', 'r');
    fc.assert(
      fc.property(arbState, prefixes, (s0, prefix) => {
        const s = feed(s0, `${prefix}<Esc>`);
        expect(s.lines).toEqual(s0.lines);
        expect(s.pending.keyBuffer).toHaveLength(0);
      }),
    );
  });

  it('step is pure — the same state and key always give the same result', () => {
    fc.assert(
      fc.property(arbState, fc.constantFrom('w', 'x', 'b', 'e', '$', 'u', 'G'), (s0, k) => {
        const a = step(s0, k);
        const b = step(s0, k);
        expect(a.state.lines).toEqual(b.state.lines);
        expect(a.state.cursor).toEqual(b.state.cursor);
        expect(a.events).toEqual(b.events);
      }),
    );
  });

  it('visual mode entered and abandoned is a no-op, whatever was selected', () => {
    // The selection lives entirely in `visualStart` plus the cursor, so an
    // abandoned selection must leave no trace at all — no buffer change, no
    // register write, and no lingering anchor to poison the next command.
    const inVisual = fc.tuple(
      fc.constantFrom('v', 'V', '<C-v>'),
      fc.array(fc.constantFrom('h', 'l', 'j', 'k', 'w', 'b', 'e', '$', '0', 'o'), { maxLength: 6 }),
    );
    fc.assert(
      fc.property(arbState, inVisual, (s0, [enter, moves]) => {
        const s = replay(s0, [...tokenize(enter), ...moves, '<Esc>']);
        expect(s.lines).toEqual(s0.lines);
        expect(s.registers).toEqual(s0.registers);
        expect(s.mode).toBe('normal');
        expect(s.visualStart).toBeUndefined();
      }),
    );
  });

  it('an operator over a selection always ends the selection', () => {
    // Whatever the operator did, visual mode must be over and the anchor gone.
    // A surviving anchor is the bug that makes the NEXT command operate on a
    // selection the player can no longer see.
    const ops = fc.constantFrom('d', 'y', 'x', '>', '<', 'U', 'u', '~', 'D', 'Y', 'C', 'S');
    fc.assert(
      fc.property(arbState, fc.constantFrom('v', 'V', '<C-v>'), ops, (s0, enter, op) => {
        const s = replay(s0, [...tokenize(enter), 'j', 'l', op, '<Esc>']);
        expect(s.visualStart).toBeUndefined();
        expect(s.mode).toBe('normal');
      }),
    );
  });

  it('a rejected key leaves the buffer untouched', () => {
    fc.assert(
      fc.property(arbState, (s0) => {
        const locked = { ...s0, keyPolicy: { denied: new Set(['x', 'w']) } };
        const after = replay(locked, ['x', 'w']);
        expect(after.lines).toEqual(s0.lines);
      }),
    );
  });
});
