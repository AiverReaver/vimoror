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

describe(':w / :q — events the golden oracle cannot express', () => {
  // Neither event is in the comparator's diff surface (buffer/cursor/registers
  // only), so a golden could not tell "emitted BufferSaved" from "did nothing"
  // either way. `:q` is worse than merely untestable there: running it for
  // real against the batched harness process would actually try to quit Vim
  // mid-run and corrupt every case after it, so it must never appear in a
  // wave4-excmd.yaml case. Both are exercised here instead, straight against
  // the engine, where core's zero-I/O contract — no filesystem write, no
  // process exit, just an event for the host to act on — is directly visible.

  it(':w emits BufferSaved and leaves the buffer untouched', () => {
    const engine = new VimEngine(['abc'], { line: 0, col: 0 });
    const events = engine.feedKeys(':w<CR>');
    expect(events).toContainEqual({ type: 'BufferSaved', force: false });
    expect(engine.lines).toEqual(['abc']);
    expect(engine.mode).toBe('normal');
  });

  it(':w! sets force', () => {
    const engine = new VimEngine(['abc'], { line: 0, col: 0 });
    const events = engine.feedKeys(':w!<CR>');
    expect(events).toContainEqual({ type: 'BufferSaved', force: true });
  });

  it(':q emits QuitRequested without touching the buffer', () => {
    const engine = new VimEngine(['abc'], { line: 0, col: 0 });
    const events = engine.feedKeys(':q<CR>');
    expect(events).toContainEqual({ type: 'QuitRequested', force: false });
    expect(engine.lines).toEqual(['abc']);
  });

  it(':q! sets force', () => {
    const engine = new VimEngine(['abc'], { line: 0, col: 0 });
    const events = engine.feedKeys(':q!<CR>');
    expect(events).toContainEqual({ type: 'QuitRequested', force: true });
  });
});

describe(':s ... c — sequential confirm responses (hand-verified through a real pty)', () => {
  // The golden oracle cannot see this at all: `feedkeys(..., 'xt')` under -es
  // drives the FIRST confirm response correctly but silently drops every
  // later one in the same `:s` invocation (measured with a scratch probe —
  // see tools/goldens/README.md and the wave4-subst.yaml file header).
  // Confirmed as an -es/feedkeys artifact, not real Vim, by driving actual
  // interactive Vim through a pty on 2026-08-16 (vim 9.1.1752, harness
  // baseline options): 5 keystrokes of `y` against 5 matches produced "Q Q Q
  // Q Q" and Vim's own "5 substitutions on 1 line" message. Every case here
  // is a direct transcription of that pty session or Vim's documented
  // `:help :s_flags` key semantics, exercised straight against the engine.

  it('every "y" in a row accepts every match — the pty-measured case', () => {
    const engine = new VimEngine(['x x x x x'], { line: 0, col: 0 });
    engine.feedKeys(':s/x/Q/gc<CR>yyyyy');
    expect(engine.lines).toEqual(['Q Q Q Q Q']);
  });

  it('y then n then y: accept, skip, accept — on one line', () => {
    const engine = new VimEngine(['x a x a x'], { line: 0, col: 0 });
    engine.feedKeys(':s/x/Q/gc<CR>yny');
    expect(engine.lines).toEqual(['Q a x a Q']);
  });

  it('y then n then y across separate lines (no g needed — one match per line)', () => {
    const engine = new VimEngine(['x1', 'x2', 'x3'], { line: 0, col: 0 });
    engine.feedKeys(':%s/x/Q/c<CR>yny');
    expect(engine.lines).toEqual(['Q1', 'x2', 'Q3']);
  });

  it('a after some manual decisions accepts itself and every remaining match', () => {
    const engine = new VimEngine(['x a x a x'], { line: 0, col: 0 });
    engine.feedKeys(':s/x/Q/gc<CR>na');
    expect(engine.lines).toEqual(['x a Q a Q']);
  });

  it('a sequence of accepts is ONE undo block, not one per match', () => {
    const engine = new VimEngine(['x x x'], { line: 0, col: 0 });
    engine.feedKeys(':s/x/Q/gc<CR>yyy');
    expect(engine.lines).toEqual(['Q Q Q']);
    engine.feedKeys('u');
    expect(engine.lines).toEqual(['x x x']);
  });

  it('cursor lands on first non-blank of the LAST accepted line, not the last prompt', () => {
    const engine = new VimEngine(['x1', 'x2', 'y3'], { line: 0, col: 0 });
    engine.feedKeys(':%s/x/Q/c<CR>yy');
    expect(engine.lines).toEqual(['Q1', 'Q2', 'y3']);
    expect(engine.cursor).toEqual({ line: 1, col: 0 });
  });
});

describe(':g/:v — a body the golden oracle cannot safely drive', () => {
  // `:s ... c` as a :g body is a genuine real-Vim feature (confirmed with a
  // scratch probe: the confirm loop really does run once per matched line),
  // but this project's oracle already cannot drive one plain `:s ... c`
  // session past its first response (wave4-subst.yaml's own header) — asking
  // it to drive one from inside `:g` on top of that is unmeasurable, so this
  // engine rejects the combination outright, UP FRONT, before touching
  // anything at all. That "touching nothing" is the one thing a golden could
  // never prove either way (the comparator only diffs buffer/cursor/
  // registers, never the specific InvalidReason), so both halves — the
  // rejection itself and its true no-op side effects — are pinned here.

  it('rejects a confirm-flagged :s body without moving the cursor at all', () => {
    const engine = new VimEngine(['x1', 'y', 'x2', 'y'], { line: 1, col: 0 });
    const events = engine.feedKeys(':g/x/s/x/y/gc<CR>');
    expect(events).toContainEqual(expect.objectContaining({ type: 'InvalidCommand', reason: 'invalid-global' }));
    expect(engine.lines).toEqual(['x1', 'y', 'x2', 'y']);
    // Real Vim, by contrast, DOES walk the cursor to the last matched line
    // here (verified with the same probe) even though nothing ends up
    // confirmed — this engine's up-front rejection never even starts the
    // scan, so the cursor is untouched instead. That divergence is the whole
    // point of this test existing outside the golden family.
    expect(engine.cursor).toEqual({ line: 1, col: 0 });
  });

  it('a nested :g/:v body is rejected the same way, on every matched line', () => {
    const engine = new VimEngine(['x1', 'y', 'x2', 'y'], { line: 0, col: 0 });
    const events = engine.feedKeys(':g/x/g/y/d<CR>');
    const rejections = events.filter((e) => e.type === 'InvalidCommand' && e.reason === 'invalid-global');
    // Once per outer-matched line (x1, x2) — the outer loop never aborts on
    // the inner rejection, matching real Vim's own "visits every match
    // regardless" behavior for a per-line body failure.
    expect(rejections).toHaveLength(2);
    expect(engine.lines).toEqual(['x1', 'y', 'x2', 'y']);
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
