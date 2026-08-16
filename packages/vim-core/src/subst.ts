/**
 * `:s[ubstitute]` — argument syntax, matching, and replacement text. Built on
 * 4b's pattern translator (`vimregex.ts`), which already turns `\(`/`\)` into
 * real JS capture groups; this module only adds the replacement-side escapes
 * (`&`, `\1`-`\9`) and the delimiter-based argument grammar.
 *
 * Pure, like `motions.ts`/`excmd.ts`: no `EditorState`, no undo, no cursor.
 * `state.ts` owns the interactive `c`-flag confirm loop and the actual commit
 * — this module only finds matches and builds replaced text, so the eager and
 * confirm paths share one implementation.
 *
 * Out of scope, same spirit as `vimregex.ts`'s own omissions: `\r`/`\n` in the
 * replacement (would split/embed lines), `\u \l \U \L \e \E` case modifiers,
 * `~` (previous replacement string), and a trailing count after the flags.
 */

import type { Lines } from './buffer.ts';
import { compileVimPattern, type VimRegexOptions } from './vimregex.ts';

export type SubstFlags = { readonly global: boolean; readonly confirm: boolean };

export type SubstSpec = {
  readonly pattern: string;
  readonly replacement: string;
  readonly flags: SubstFlags;
};

/** Vim's own restriction (`:h :s`): a delimiter can be anything but a letter, digit, `\`, `"` or `|`. Exported for `:g`/`:v`'s own (single-split) delimiter grammar in `state.ts`. */
export const BAD_DELIM = /[a-zA-Z0-9\\"|]/;

/** Split on unescaped `delim`, keeping an escaped delimiter (`\/`) as a literal two-char escape for the caller to interpret. Exported for `:g`/`:v`, which reuses this rather than duplicating the escape handling. */
export function splitDelimited(s: string, delim: string): string[] {
  const parts: string[] = [];
  let cur = '';
  let i = 0;
  while (i < s.length) {
    const ch = s[i]!;
    if (ch === '\\' && i + 1 < s.length) {
      cur += ch + s[i + 1];
      i += 2;
      continue;
    }
    if (ch === delim) {
      parts.push(cur);
      cur = '';
      i += 1;
      continue;
    }
    cur += ch;
    i += 1;
  }
  parts.push(cur);
  return parts;
}

/** Leading `g`/`c` letters; stops at the first digit or space (an optional trailing count, not implemented). Unrecognized flag letters are ignored rather than rejected. */
function parseFlags(tail: string): SubstFlags {
  let global = false;
  let confirm = false;
  for (const ch of tail) {
    if (ch === ' ' || ch === '\t' || (ch >= '0' && ch <= '9')) break;
    if (ch === 'g') global = true;
    else if (ch === 'c') confirm = true;
  }
  return { global, confirm };
}

/**
 * `:s{delim}pattern{delim}replacement{delim}flags` — the trailing delimiter,
 * replacement and flags are all optional (`:s/x` deletes every `x`, same as
 * `:s/x//`). `null` means unparseable: no delimiter at all (the bare `:s`
 * "repeat last substitute" form, out of scope) or a disallowed one.
 */
export function parseSubstArgs(args: string): SubstSpec | null {
  const s = args.replace(/^\s+/, '');
  if (s === '') return null;
  const delim = s[0]!;
  if (BAD_DELIM.test(delim)) return null;
  const [pattern = '', replacement = '', tail = ''] = splitDelimited(s.slice(1), delim);
  return { pattern, replacement, flags: parseFlags(tail) };
}

// --- matching -------------------------------------------------------------

export type SubstMatch = {
  readonly index: number;
  readonly length: number;
  /** `groups[0]` is the whole match, same indexing as a regex exec result. */
  readonly groups: readonly (string | undefined)[];
};

/** Every match on one line. A zero-length match steps forward by one column so the scan terminates — same rule `search.ts` uses. */
function matchesOnLine(text: string, re: RegExp): SubstMatch[] {
  const out: SubstMatch[] = [];
  re.lastIndex = 0;
  let m = re.exec(text);
  while (m !== null) {
    out.push({ index: m.index, length: m[0]!.length, groups: [...m] });
    re.lastIndex = m[0]!.length === 0 ? m.index + 1 : re.lastIndex;
    m = re.exec(text);
  }
  return out;
}

/** `&` (and `\0`) → whole match, `\1`-`\9` → capture group (empty if unmatched), `\\` and any other `\x` → `x` literally. */
export function buildReplacement(replacement: string, m: SubstMatch): string {
  let out = '';
  let i = 0;
  while (i < replacement.length) {
    const ch = replacement[i]!;
    if (ch === '\\' && i + 1 < replacement.length) {
      const next = replacement[i + 1]!;
      if (next >= '0' && next <= '9') {
        out += m.groups[Number(next)] ?? '';
        i += 2;
        continue;
      }
      out += next;
      i += 2;
      continue;
    }
    if (ch === '&') {
      out += m.groups[0];
      i += 1;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

function applyMatches(text: string, matches: readonly SubstMatch[], replacement: string): string {
  let out = '';
  let last = 0;
  for (const m of matches) {
    out += text.slice(last, m.index) + buildReplacement(replacement, m);
    last = m.index + m.length;
  }
  return out + text.slice(last);
}

/** One line, eager: every match if `global`, else just the first. */
export function substituteLine(
  text: string,
  re: RegExp,
  replacement: string,
  global: boolean,
): { readonly text: string; readonly count: number } {
  const matches = matchesOnLine(text, re);
  const chosen = global ? matches : matches.slice(0, 1);
  if (chosen.length === 0) return { text, count: 0 };
  return { text: applyMatches(text, chosen, replacement), count: chosen.length };
}

export type SubstRangeResult = {
  readonly lines: Lines;
  readonly count: number;
  /** `undefined` when nothing in the range matched. */
  readonly lastChangedLine: number | undefined;
};

/** Eager (no `c` flag) substitution across `first..last` inclusive. */
export function substituteRange(
  lines: Lines,
  first: number,
  last: number,
  pattern: string,
  replacement: string,
  global: boolean,
  opts: VimRegexOptions,
): SubstRangeResult {
  let re: RegExp;
  try {
    re = compileVimPattern(pattern, opts);
  } catch {
    return { lines, count: 0, lastChangedLine: undefined };
  }
  const next = lines.slice();
  let count = 0;
  let lastChangedLine: number | undefined;
  for (let l = first; l <= last; l += 1) {
    const r = substituteLine(next[l]!, re, replacement, global);
    if (r.count > 0) {
      next[l] = r.text;
      count += r.count;
      lastChangedLine = l;
    }
  }
  return { lines: next, count, lastChangedLine };
}

/**
 * The next match at/after `from` within `first..last`, for the `c`-flag
 * interactive loop. `!global` considers only the FIRST match of each line —
 * the caller always resumes a non-global scan at column 0 of the following
 * line, never mid-line, so `from.col` only matters when `global` is true.
 */
export function findNextMatch(
  lines: Lines,
  first: number,
  last: number,
  from: { readonly line: number; readonly col: number },
  pattern: string,
  global: boolean,
  opts: VimRegexOptions,
): { readonly line: number; readonly match: SubstMatch } | null {
  let re: RegExp;
  try {
    re = compileVimPattern(pattern, opts);
  } catch {
    return null;
  }
  for (let l = Math.max(from.line, first); l <= last; l += 1) {
    const startCol = l === from.line ? from.col : 0;
    const matches = matchesOnLine(lines[l]!, re);
    const found = global ? matches.find((m) => m.index >= startCol) : matches[0];
    if (found !== undefined) return { line: l, match: found };
  }
  return null;
}
