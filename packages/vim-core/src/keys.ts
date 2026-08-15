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
  '<Space>': ' ',
  '<Bar>': '|',
  '<Bslash>': '\\',
  '<lt>': '<',
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
  '<space>': '<Space>',
  '<bar>': '<Bar>',
  '<bslash>': '<Bslash>',
  '<lt>': '<lt>',
  '<nul>': '<Nul>',
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

  throw new Error(
    `unknown key notation ${token}. Add it to packages/vim-core/src/keys.ts ` +
      `AND tools/goldens/keynotation.ts.`,
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

/** Render tokens back to notation, for `ResolvedCommand.keys` and hints. */
export function render(tokens: readonly KeyToken[]): string {
  return tokens.join('');
}
