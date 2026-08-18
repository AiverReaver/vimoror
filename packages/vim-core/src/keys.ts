/**
 * Key tokenizer: notation string → canonical `KeyToken[]`.
 *
 * A token is either a single character (`d`, `2`, `(`) or a named key in
 * angle brackets (`<Esc>`, `<CR>`, `<C-r>`). Canonical named tokens are the
 * engine's internal currency; raw control bytes are folded into them on the
 * way in so the rest of the engine never compares against `\x1b`.
 *
 * This is intentionally NOT shared with `tools/goldens/keynotation.ts`. One
 * parser feeding both the oracle and the engine could mis-decode a key
 * identically on both sides and produce a golden that agrees with the bug.
 */

import type { KeyToken } from './types.ts';

export const ESC = '<Esc>';
export const CR = '<CR>';
export const NL = '<NL>';
export const TAB = '<Tab>';
export const BS = '<BS>';
export const DEL = '<Del>';

const NAMED_TO_CHAR: Record<string, string> = {
  '<Esc>': '\x1b',
  '<CR>': '\r',
  '<NL>': '\n',
  '<Tab>': '\t',
  '<BS>': '\x08',
  '<Del>': '\x7f',
  '<Nul>': '\x00',
};

const CHAR_TO_NAMED: Record<string, string> = {
  '\x1b': ESC,
  '\r': CR,
  '\n': NL,
  '\t': TAB,
  '\x08': BS,
  '\x7f': DEL,
};

/**
 * Notation → canonical token. The five at the bottom resolve to the PLAIN
 * CHARACTER a keyboard delivers rather than to a second named token for the
 * same key: `<lt>` IS `<` and `<Space>` IS a space. **Two tokens for one key
 * is the bug M3 Wave A came here to remove**, and it bit in both directions —
 * `<lt>` was `isPrintable`-false, locked by a `{printable}` policy and unknown
 * to normal mode's un-indent operator, while `<Space>` was the mirror image:
 * hand-written notation drove the space motion and a real spacebar press,
 * arriving as `' '`, did nothing at all.
 *
 * `tools/goldens/keynotation.ts` has always resolved all five to characters
 * (`<gt>` included, which this side used to THROW on), so this is the two
 * deliberately-separate parsers agreeing on behaviour, not a new rule.
 */
const CANONICAL_ALIASES: Record<string, string> = {
  '<esc>': ESC,
  '<cr>': CR,
  '<enter>': CR,
  '<return>': CR,
  '<nl>': NL,
  '<lf>': NL,
  '<tab>': TAB,
  '<bs>': BS,
  '<del>': DEL,
  // `<Nul>` stays named: no key produces it and nothing consumes it, so there
  // is no keyboard spelling for it to disagree with.
  '<nul>': '<Nul>',
  '<space>': ' ',
  '<bar>': '|',
  '<bslash>': '\\',
  '<lt>': '<',
  '<gt>': '>',
};

/** Tokenize authoring notation such as `ci(X<Esc>` into canonical tokens. */
export function tokenize(notation: string): KeyToken[] {
  const out: KeyToken[] = [];
  let i = 0;

  while (i < notation.length) {
    const ch = notation[i]!;

    if (ch === '<') {
      // `<` doubles as the un-indent operator, so `<<` and `<j` are ordinary
      // keys. Only a bracketed name of two or more characters is notation —
      // Vim has no `<j>` key, and every real named key is longer than that.
      const close = notation.indexOf('>', i);
      const inner = close === -1 ? null : notation.slice(i + 1, close);
      if (inner !== null && inner.length >= 2) {
        out.push(canonicalizeNamed(notation.slice(i, close + 1)));
        i = close + 1;
        continue;
      }
      out.push('<');
      i += 1;
      continue;
    }

    // A raw control byte (as delivered by the harness or a real keyboard)
    // folds into its canonical named token.
    const named = CHAR_TO_NAMED[ch];
    if (named !== undefined) {
      out.push(named);
      i += 1;
      continue;
    }
    const code = ch.charCodeAt(0);
    if (code < 0x20) {
      out.push(`<C-${String.fromCharCode(code + 96)}>`);
      i += 1;
      continue;
    }

    out.push(ch);
    i += 1;
  }

  return out;
}

function canonicalizeNamed(token: string): KeyToken {
  const lower = token.toLowerCase();

  const alias = CANONICAL_ALIASES[lower];
  if (alias !== undefined) return alias;

  const ctrl = /^<c-(.)>$/.exec(lower);
  if (ctrl) return `<C-${ctrl[1]!}>`;

  const shift = /^<s-(.+)>$/.exec(lower);
  if (shift) return `<S-${shift[1]!}>`;

  // Rejecting is the point — silently typing `<Escape>` into a buffer as eight
  // characters is the failure this file exists to prevent, and no heuristic can
  // tell that typo from an intentional literal. But `tokenize` is a trust
  // boundary for stage AUTHORS too (`schema.ts` runs it over `solution`,
  // `allowedKeys` and `teachesKeys`, and M3's editor shows them the result), and
  // "add it to keys.ts" is useless advice to someone who just hand-wrote
  // `i<div>` and wanted a literal `<`. Name the escape first, for them.
  throw new Error(
    `unknown key notation ${token}. For a literal '<', write <lt> — ` +
      `${token} reads as the name of a key. If ${token} really is a key this ` +
      `engine should know, add it to packages/vim-core/src/keys.ts AND ` +
      `tools/goldens/keynotation.ts.`,
  );
}

/** True for a token that inserts literal text in insert mode. */
export function isPrintable(token: KeyToken): boolean {
  return token.length === 1 && token >= ' ' && token !== '\x7f';
}

/** The literal character a token produces, or undefined if it produces none. */
export function literalOf(token: KeyToken): string | undefined {
  if (isPrintable(token)) return token;
  const named = NAMED_TO_CHAR[token];
  if (named !== undefined) return named;
  // The inverse of the `code < 0x20` fold above — needed to round-trip a
  // recorded macro's `<C-r>`/`<C-o>`/... back to the control byte real Vim
  // would store in the register.
  const ctrl = /^<C-([a-z])>$/.exec(token);
  return ctrl ? String.fromCharCode(ctrl[1]!.charCodeAt(0) - 96) : undefined;
}

/**
 * Render tokens back to notation — the exact INVERSE of `tokenize`, for
 * `ResolvedCommand.keys` and hints. The inverse property is what lets M3's
 * recorder turn keys an author actually played into a `stage.solution` that
 * replays as played; a naive `join('')` broke it on one token, a literal `<`,
 * which swallowed whatever followed into a bracketed name. Both halves of that
 * were measured: `['i','<','d','i','v','>']` came back out as an unknown-key
 * THROW, and `['<','c','r','>']` came back — silently, which is worse — as a
 * single press of `<CR>`.
 *
 * Escaped only when the rendered SUFFIX already holds a `>` for the `<` to
 * reach, which is exactly when `tokenize` would misread it. So `<<`, `<G` and
 * `di<` still render as themselves and the un-indent operator keeps displaying
 * the way a player typed it, rather than as `<lt><lt>`. Built right-to-left
 * because that suffix is the thing being tested.
 */
export function render(tokens: readonly KeyToken[]): string {
  let out = '';
  for (let i = tokens.length - 1; i >= 0; i -= 1) {
    const token = tokens[i]!;
    out = (token === '<' && out.includes('>') ? '<lt>' : token) + out;
  }
  return out;
}
