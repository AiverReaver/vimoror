/**
 * Vim "magic" (default `'magic'`) regex → JS RegExp.
 *
 * Vim's magic levels invert JS's defaults: `( ) + ? = { } |` are LITERAL
 * unless backslash-escaped, while `. * [ ] ^ $` are special unescaped — the
 * opposite of most regex flavors. This translates exactly that one level
 * ('magic', the baseline every golden case runs under unless it overrides
 * `:set`). `\v` (very magic), `\V` (very nomagic) and bare `'nomagic'` are
 * NOT implemented — deliberately out of scope for M0, same as `[[ ]]` motions.
 *
 * Also out of scope, documented rather than faked: `\zs`/`\ze` (match-start/
 * end markers), look-around (`\@=` `\@!` `\@<=` `\@<!`), `\%(...\)`
 * non-capturing groups, POSIX bracket classes (`[:alpha:]`), and `^`/`$`
 * anchoring anywhere but the true start/end of the whole pattern (Vim also
 * anchors right after `\(`/`\|`; only the simple case is covered here).
 */

const JS_NEEDS_ESCAPE = new Set(['.', '*', '+', '?', '^', '$', '{', '}', '(', ')', '|', '[', ']', '\\', '/']);

function escapeLiteral(ch: string): string {
  return JS_NEEDS_ESCAPE.has(ch) ? `\\${ch}` : ch;
}

const CLASS_ESCAPES: Record<string, string> = {
  d: '\\d',
  D: '\\D',
  s: '\\s',
  S: '\\S',
  w: '\\w',
  W: '\\W',
  a: '[A-Za-z]',
  A: '[^A-Za-z]',
  l: '[a-z]',
  L: '[^a-z]',
  u: '[A-Z]',
  U: '[^A-Z]',
  x: '[0-9A-Fa-f]',
  X: '[^0-9A-Fa-f]',
  o: '[0-7]',
  O: '[^0-7]',
  h: '[A-Za-z_]',
  H: '[^A-Za-z_]',
};

/** Copy a `[...]` bracket expression through, valid in both Vim and JS almost verbatim. */
function copyBracket(pattern: string, start: number): { text: string; next: number } {
  let i = start + 1;
  let out = '[';
  if (pattern[i] === '^') {
    out += '^';
    i += 1;
  }
  // A `]` immediately after `[` or `[^` is a literal member in Vim; JS needs it escaped.
  if (pattern[i] === ']') {
    out += '\\]';
    i += 1;
  }
  while (i < pattern.length && pattern[i] !== ']') {
    const ch = pattern[i]!;
    out += ch === '\\' || ch === ']' ? `\\${ch}` : ch;
    i += 1;
  }
  out += ']';
  return { text: out, next: i + 1 };
}

export type VimRegexOptions = {
  readonly ignorecase: boolean;
  readonly smartcase: boolean;
};

/** Translate one magic-mode Vim pattern to an equivalent JS regex source, honoring inline `\c`/`\C`. */
function translate(pattern: string): { source: string; forceCase: 'sensitive' | 'insensitive' | undefined } {
  let out = '';
  let forceCase: 'sensitive' | 'insensitive' | undefined;
  let i = 0;
  const n = pattern.length;

  while (i < n) {
    const ch = pattern[i]!;

    if (ch === '\\' && i + 1 < n) {
      const next = pattern[i + 1]!;
      if (next === '(' || next === ')' || next === '+' || next === '|') {
        out += next;
        i += 2;
        continue;
      }
      if (next === '?' || next === '=') {
        out += '?';
        i += 2;
        continue;
      }
      if (next === '<' || next === '>') {
        out += '\\b';
        i += 2;
        continue;
      }
      if (next === '{') {
        let j = i + 2;
        let body = '';
        while (j < n && !(pattern[j] === '\\' && pattern[j + 1] === '}')) {
          body += pattern[j];
          j += 1;
        }
        out += `{${body}}`;
        i = j + 2;
        continue;
      }
      if (next in CLASS_ESCAPES) {
        out += CLASS_ESCAPES[next];
        i += 2;
        continue;
      }
      if (next === 'c') {
        forceCase = 'insensitive';
        i += 2;
        continue;
      }
      if (next === 'C') {
        forceCase = 'sensitive';
        i += 2;
        continue;
      }
      if (next >= '1' && next <= '9') {
        out += `\\${next}`;
        i += 2;
        continue;
      }
      // Unrecognized escape (incl. `\.` `\*` `\\` `\/`): the escaped char, literally.
      out += escapeLiteral(next);
      i += 2;
      continue;
    }

    if (ch === '.' || ch === '*') {
      out += ch;
      i += 1;
      continue;
    }
    if (ch === '^') {
      out += i === 0 ? '^' : '\\^';
      i += 1;
      continue;
    }
    if (ch === '$') {
      out += i === n - 1 ? '$' : '\\$';
      i += 1;
      continue;
    }
    if (ch === '[') {
      const { text, next } = copyBracket(pattern, i);
      out += text;
      i = next;
      continue;
    }
    out += escapeLiteral(ch);
    i += 1;
  }

  return { source: out, forceCase };
}

/** Compile a magic-mode Vim search pattern to a global (all-match) JS RegExp. */
export function compileVimPattern(pattern: string, opts: VimRegexOptions): RegExp {
  const { source, forceCase } = translate(pattern);
  const caseInsensitive =
    forceCase === 'insensitive' ||
    (forceCase !== 'sensitive' && opts.ignorecase && !(opts.smartcase && /[A-Z]/.test(pattern)));
  return new RegExp(source, caseInsensitive ? 'gi' : 'g');
}
