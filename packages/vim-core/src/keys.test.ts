/**
 * `tokenize` ∘ `render` — the round trip M3's solution recorder rests on.
 *
 * The recorder's whole claim is that one recording yields `stage.solution`,
 * `par` and a regression test at once: capture the `KeyToken[]` an author
 * played, `render` them to notation, and have `feedKeys(solution)` replay
 * EXACTLY what was played. That only holds if `render` is `tokenize`'s inverse,
 * and before M3 Wave A it was `tokens.join('')` — which broke on a literal `<`
 * in two ways, one loud and one silent. Both are named cases below.
 *
 * The second half of this file is the other shape of the same bug: a key with
 * TWO canonical tokens, one from notation and one from a keyboard. `render` is
 * an inverse either way (each token round-trips to itself), so the property
 * cannot see it — only the engine can, by doing nothing when the spacebar is
 * pressed. Those cases exist because the property is blind to them.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { VimEngine } from './engine.ts';
import { isPrintable, literalOf, render, tokenize } from './keys.ts';

/**
 * Every shape `tokenize` can emit. Weighted toward `<` and `>` because that is
 * the only pair the escape exists for — a uniform draw over printables would
 * spend nearly all its budget on cases that were never broken.
 */
const arbToken = fc.oneof(
  { weight: 4, arbitrary: fc.constantFrom('<', '>') },
  { weight: 3, arbitrary: fc.constantFrom(...'abdiwxyz0129{}()[]"\'$^ |\\:/?@.~'.split('')) },
  { weight: 2, arbitrary: fc.constantFrom('<Esc>', '<CR>', '<NL>', '<Tab>', '<BS>', '<Del>', '<Nul>') },
  { weight: 1, arbitrary: fc.constantFrom('<C-v>', '<C-r>', '<C-o>', '<C-a>', '<S-tab>') },
);

describe('render is the inverse of tokenize', () => {
  it('round-trips every sequence of canonical tokens', () => {
    fc.assert(
      fc.property(fc.array(arbToken, { maxLength: 14 }), (tokens) => {
        expect(tokenize(render(tokens))).toEqual(tokens);
      }),
      { numRuns: 2000 },
    );
  });

  it('round-trips a literal < that used to throw', () => {
    // Measured before the fix: `render` produced `i<div><Esc>`, and tokenizing
    // that threw "unknown key notation <div>" — so a perfectly legal recording
    // failed its own schema check as invalid key notation.
    const played = ['i', '<', 'd', 'i', 'v', '>', '<Esc>'];
    expect(render(played)).toBe('i<lt>div><Esc>');
    expect(tokenize(render(played))).toEqual(played);
  });

  it('round-trips a literal < that used to change meaning silently', () => {
    // The worse half: four printable characters rendered as `<cr>` and came
    // back as ONE press of Enter. Nothing threw anywhere.
    const played = ['<', 'c', 'r', '>'];
    expect(render(played)).toBe('<lt>cr>');
    expect(tokenize(render(played))).toEqual(played);
  });

  it('leaves the un-indent operator readable', () => {
    // `ResolvedCommand.keys` is player-facing (the ghost HUD, `Hint.keys`), so
    // the escape is spent only where `tokenize` would actually misread — a `<`
    // with no later `>` to reach cannot start a bracketed name.
    for (const keys of ['<<', '2<<', '<G', '<j', 'di<', 'da<', '<C-v>jl<']) {
      expect(render(tokenize(keys))).toBe(keys);
    }
  });

  it('escapes every < once a > follows anywhere after it', () => {
    const played = ['<', '<', 'a', 'b', '>'];
    expect(render(played)).toBe('<lt><lt>ab>');
    expect(tokenize(render(played))).toEqual(played);
  });
});

describe('one key is one token', () => {
  it('resolves <lt> to the character a keyboard delivers', () => {
    // Was `'<lt>'`: a fourth spelling of `<` that `isPrintable` called false,
    // a `{printable}` key policy would have locked, and normal mode did not
    // know as the un-indent operator.
    expect(tokenize('<lt>')).toEqual(['<']);
    expect(tokenize('<gt>')).toEqual(['>']);
    expect(isPrintable(tokenize('<lt>')[0]!)).toBe(true);
    expect(literalOf(tokenize('<lt>')[0]!)).toBe('<');
  });

  it('resolves <Space>, <Bar> and <Bslash> to their characters', () => {
    expect(tokenize('<Space>')).toEqual([' ']);
    expect(tokenize('<Bar>')).toEqual(['|']);
    expect(tokenize('<Bslash>')).toEqual(['\\']);
  });

  it('drives the space motion from a plain spacebar press', () => {
    // The bug this direction: the space motion was reachable ONLY from
    // hand-written `<Space>` notation. A real keyboard delivers `' '`, which
    // normal mode did not recognise at all — so the editor's playtest and any
    // recorded solution containing a space would have diverged from real Vim.
    const engine = new VimEngine(['abc']);
    engine.feed(' ');
    expect(engine.cursor).toEqual({ line: 0, col: 1 });
    engine.feedKeys('<Space>');
    expect(engine.cursor).toEqual({ line: 0, col: 2 });
  });

  it('inserts a literal space from either spelling', () => {
    const engine = new VimEngine(['']);
    engine.feedKeys('ia<Space>b<Esc>');
    expect(engine.lines).toEqual(['a b']);
  });

  it('still rejects an unknown bracketed name rather than typing it', () => {
    expect(() => tokenize('<Escape>')).toThrow(/unknown key notation/);
  });
});
