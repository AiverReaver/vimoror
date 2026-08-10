/**
 * Key-notation → real control bytes, for the golden harness ONLY.
 *
 * This is deliberately a SECOND, independent implementation of the same
 * notation that `@vimorror/core`'s `keys.ts` parses. The harness must not
 * share that code: if one buggy parser fed both the oracle and the engine,
 * a mis-decoded key would produce a golden that agrees with the bug and the
 * test would pass while both sides were wrong. Two implementations that must
 * agree is the whole point.
 *
 * Note on "pass control characters as REAL BYTES, not `\<Esc>` notation":
 * the trap that recipe warns about is handing Vim the literal text `<Esc>`
 * and unescaping it with eval(), which types the characters `<Esc>` into the
 * buffer. Here the notation is resolved to a real 0x1b on the TypeScript side
 * before the spec is written; JSON's own  escape is then reversed by
 * Vim's json_decode, so feedkeys() receives a real byte. Going through JSON
 * escaping rather than writing raw bytes into the file is also what keeps a
 * key like <NL> from splitting the spec file into two lines.
 */

const NAMED: Record<string, string> = {
  esc: '\x1b',
  cr: '\r',
  enter: '\r',
  return: '\r',
  nl: '\n',
  lf: '\n',
  tab: '\t',
  bs: '\x08',
  del: '\x7f',
  space: ' ',
  bar: '|',
  bslash: '\\',
  lt: '<',
  gt: '>',
  nul: '\x00',
};

/**
 * Expand `<Esc>`, `<CR>`, `<C-r>`, `<S-Tab>`-style notation into the literal
 * characters Vim should receive. Unrecognised `<...>` groups throw rather
 * than passing through as text — silently typing `<Foo>` into a test buffer
 * is exactly the failure mode this file exists to prevent.
 */
export function encodeKeys(notation: string): string {
  let out = '';
  let i = 0;

  while (i < notation.length) {
    const ch = notation[i]!;

    if (ch !== '<') {
      out += ch;
      i += 1;
      continue;
    }

    const close = notation.indexOf('>', i);
    if (close === -1) {
      throw new Error(`unterminated key notation at index ${i} in ${JSON.stringify(notation)}`);
    }

    const inner = notation.slice(i + 1, close);
    out += resolveNamedKey(inner, notation);
    i = close + 1;
  }

  return out;
}

function resolveNamedKey(inner: string, whole: string): string {
  const lower = inner.toLowerCase();

  const named = NAMED[lower];
  if (named !== undefined) return named;

  // <C-x> / <C-X> → the control byte. Vim folds case here: <C-a> and <C-A>
  // are the same 0x01.
  const ctrl = /^c-(.)$/.exec(lower);
  if (ctrl) {
    const c = ctrl[1]!;
    const code = c.toUpperCase().charCodeAt(0);
    if (code >= 63 && code <= 95) return String.fromCharCode(code & 0x1f);
    if (c === '?') return '\x7f';
    throw new Error(`unsupported control key <${inner}> in ${JSON.stringify(whole)}`);
  }

  throw new Error(
    `unknown key notation <${inner}> in ${JSON.stringify(whole)}. ` +
      `Add it to tools/goldens/keynotation.ts AND packages/vim-core/src/keys.ts.`,
  );
}
