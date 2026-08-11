/**
 * Semantics the golden harness structurally cannot see, pinned by hand.
 *
 * Vim omits EMPTY registers from the oracle's output, so a golden can never
 * distinguish "register untouched" from "register overwritten with nothing" —
 * yet real Vim 9.1 makes exactly that distinction (verified by hand on
 * 2026-08-11, vim 9.1.1752, `-u NONE` + the harness baseline options):
 *
 *  - an empty-region YANK still writes its registers, clearing them
 *  - `C` on an empty line writes an empty small delete ("- and unnamed)
 *  - `dl`, `cl`/`s` and `D` on an empty line touch no register at all
 *
 * Also here: snapshot/restore round-trips that no golden exercises.
 */

import { describe, expect, it } from 'vitest';

import { VimEngine } from './engine.ts';
import { DEFAULT_OPTIONS } from './operators.ts';

/** An engine whose unnamed and "0 registers are seeded with 'a'. */
function seeded(): VimEngine {
  const engine = new VimEngine(['ab', ''], { line: 0, col: 0 });
  engine.feedKeys('yl');
  expect(engine.snapshot().registers['"']?.text).toBe('a');
  expect(engine.snapshot().registers['0']?.text).toBe('a');
  engine.feedKeys('j');
  return engine;
}

describe('empty-region register semantics (hand-verified against Vim 9.1)', () => {
  it('yank over an empty region clears the unnamed and "0 registers', () => {
    const engine = seeded();
    engine.feedKeys('yl');
    expect(engine.snapshot().registers['"']).toEqual({ text: '', type: 'charwise' });
    expect(engine.snapshot().registers['0']).toEqual({ text: '', type: 'charwise' });
  });

  it('an explicit-register empty yank clears that register but keeps "0', () => {
    const engine = seeded();
    engine.feedKeys('"ayl');
    expect(engine.snapshot().registers['a']).toEqual({ text: '', type: 'charwise' });
    expect(engine.snapshot().registers['"']?.text).toBe('');
    expect(engine.snapshot().registers['0']?.text).toBe('a');
  });

  it('C on an empty line writes an empty small delete, keeping "0', () => {
    const engine = seeded();
    engine.feedKeys('CX<Esc>');
    expect(engine.lines).toEqual(['ab', 'X']);
    expect(engine.snapshot().registers['"']?.text).toBe('');
    expect(engine.snapshot().registers['-']?.text).toBe('');
    expect(engine.snapshot().registers['0']?.text).toBe('a');
  });

  it.each(['dl', 'sZ<Esc>', 'clZ<Esc>', 'D'])('%s on an empty line touches no register', (keys) => {
    const engine = seeded();
    engine.feedKeys(keys);
    expect(engine.snapshot().registers['"']?.text).toBe('a');
    expect(engine.snapshot().registers['-']).toBeUndefined();
  });
});

describe('put from a register with nothing in it', () => {
  // The goldens pin the BUFFER, cursor and undo consequences of all three
  // register states. What they cannot see is the reported event, because Vim's
  // beep is not in the oracle's output — and that event is what the game layer
  // renders in character, so it is worth pinning here.

  const rejections = (engine: VimEngine, keys: string) =>
    engine.feedKeys(keys).filter((e) => e.type === 'InvalidCommand');

  it('an UNSET register reports empty-register, and still mints an undo node', () => {
    const engine = new VimEngine(['abc'], { line: 0, col: 0 });
    engine.feedKeys('x');
    expect(rejections(engine, '"zp')).toEqual([
      { type: 'InvalidCommand', keys: '"zp', reason: 'empty-register' },
    ]);
    // The node was minted before the register lookup failed, so `u` burns on it.
    engine.feedKeys('u');
    expect(engine.lines).toEqual(['bc']);
  });

  it('a WRITTEN-but-empty register is put silently, with no rejection', () => {
    const engine = new VimEngine(['abc', ''], { line: 0, col: 0 });
    engine.feedKeys('xj');
    engine.feedKeys('yl'); // yank over an empty region: written, and empty
    expect(rejections(engine, 'p')).toEqual([]);
    engine.feedKeys('u');
    expect(engine.lines).toEqual(['bc', '']);
  });

  it('the black hole reads back as written-but-empty, not as unset', () => {
    const engine = new VimEngine(['abc'], { line: 0, col: 0 });
    engine.feedKeys('x');
    expect(rejections(engine, '"_p')).toEqual([]);
    engine.feedKeys('u');
    expect(engine.lines).toEqual(['bc']);
  });
});

describe('snapshot/restore', () => {
  it('restoring a mid-insert snapshot yields a live normal-mode engine', () => {
    const engine = new VimEngine(['abc'], { line: 0, col: 0 });
    engine.feedKeys('iX');
    // Insert-mode edits apply live, so the typed text is already in the buffer;
    // a snapshot cannot and must not roll the half-finished session back.
    expect(engine.lines).toEqual(['Xabc']);

    const restored = VimEngine.restore(engine.snapshot());
    expect(restored.mode).toBe('normal');
    expect(restored.lines).toEqual(['Xabc']);
    // The restored engine must accept keys — a zombie rejects even <Esc>.
    restored.feedKeys('x');
    expect(restored.lines).toEqual(['Xbc']);
  });

  it('options survive the snapshot round-trip', () => {
    const engine = new VimEngine(['foo'], { line: 0, col: 0 }, { ...DEFAULT_OPTIONS, shiftwidth: 2 });
    const restored = VimEngine.restore(engine.snapshot());
    restored.feedKeys('>>');
    expect(restored.lines).toEqual(['  foo']);
  });
});
