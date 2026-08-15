/**
 * Search: `/ ? n N * #`.
 *
 * The pattern TEXT is accumulated as extra `Pending` state in `state.ts` — an
 * `awaiting: 'search'` accumulator, exactly like `f`/`t`'s single-character
 * wait, just running until `<CR>` instead of one key. This module only does
 * the actual text search once a pattern is known.
 */

import { CHAR_WORD, charAt, charClass, lastLine, lineAt, type Lines } from './buffer.ts';
import { compileVimPattern, type VimRegexOptions } from './vimregex.ts';
import type { Pos } from './types.ts';

export type SearchDirection = 'forward' | 'backward';

type Match = { readonly col: number; readonly length: number };

/** Every match on one line. A zero-length match steps forward by one column so the scan terminates. */
function matchesOnLine(text: string, re: RegExp): Match[] {
  const out: Match[] = [];
  re.lastIndex = 0;
  let m = re.exec(text);
  while (m !== null) {
    out.push({ col: m.index, length: m[0].length });
    re.lastIndex = m[0].length === 0 ? m.index + 1 : re.lastIndex;
    m = re.exec(text);
  }
  return out;
}

/**
 * Find the next/previous match of `pattern` from `from`. Forward search
 * starts strictly AFTER `from`; backward search starts strictly BEFORE it —
 * neither re-matches the position the cursor is already sitting on, which is
 * what makes repeating `/same-pattern<CR>` (or `n`) advance instead of
 * standing still. With `wrapscan`, a search that runs off the end of the
 * buffer without a hit continues from the other end, including back onto the
 * very match it started at, if that is the only occurrence.
 */
export function findMatch(
  lines: Lines,
  from: Pos,
  pattern: string,
  direction: SearchDirection,
  opts: VimRegexOptions,
  wrapscan: boolean,
): Pos | null {
  let re: RegExp;
  try {
    re = compileVimPattern(pattern, opts);
  } catch {
    return null;
  }
  const last = lastLine(lines);

  if (direction === 'forward') {
    for (let line = from.line; line <= last; line += 1) {
      const found = matchesOnLine(lineAt(lines, line), re).find((m) => line > from.line || m.col > from.col);
      if (found !== undefined) return { line, col: found.col };
    }
    if (!wrapscan) return null;
    for (let line = 0; line <= from.line; line += 1) {
      const found = matchesOnLine(lineAt(lines, line), re).find((m) => line < from.line || m.col <= from.col);
      if (found !== undefined) return { line, col: found.col };
    }
    return null;
  }

  for (let line = from.line; line >= 0; line -= 1) {
    const matches = matchesOnLine(lineAt(lines, line), re).filter((m) => line < from.line || m.col < from.col);
    if (matches.length > 0) return { line, col: matches[matches.length - 1]!.col };
  }
  if (!wrapscan) return null;
  for (let line = last; line >= from.line; line -= 1) {
    const matches = matchesOnLine(lineAt(lines, line), re).filter((m) => line > from.line || m.col >= from.col);
    if (matches.length > 0) return { line, col: matches[matches.length - 1]!.col };
  }
  return null;
}

/** `findMatch`, repeated `count` times — each hop starts from the previous match. */
export function findMatchRepeated(
  lines: Lines,
  from: Pos,
  pattern: string,
  direction: SearchDirection,
  opts: VimRegexOptions,
  wrapscan: boolean,
  count: number,
): Pos | null {
  let pos = from;
  for (let i = 0; i < count; i += 1) {
    const next = findMatch(lines, pos, pattern, direction, opts, wrapscan);
    if (next === null) return null;
    pos = next;
  }
  return pos;
}

/**
 * The keyword under, or after, the cursor on its OWN line only — `*`/`#`
 * never look to another line for a word to search for. Real Vim's `*`
 * matches "the identifier or keyword under or after the cursor", not any
 * non-blank run, so only `CHAR_WORD` counts — punctuation is skipped over
 * exactly the way `w` skips over what it isn't standing on.
 *
 * Returns the word's OWN start column, not the cursor's — `*`/`#` search
 * from there, not from wherever the cursor sits inside the word. Measured
 * against real Vim: with the cursor mid-word, searching backward from the
 * raw cursor column would still see the current word's own start as "before"
 * it and wrongly re-find the word standing on, instead of skipping past it.
 */
export function wordUnderCursor(lines: Lines, pos: Pos): { readonly word: string; readonly start: Pos } | null {
  const line = lineAt(lines, pos.line);
  let col = pos.col;
  while (col < line.length && charClass(charAt(lines, { line: pos.line, col }), false) !== CHAR_WORD) col += 1;
  if (col >= line.length) return null;
  let start = col;
  while (start > 0 && charClass(charAt(lines, { line: pos.line, col: start - 1 }), false) === CHAR_WORD) start -= 1;
  let end = col;
  while (end < line.length && charClass(charAt(lines, { line: pos.line, col: end }), false) === CHAR_WORD) end += 1;
  return { word: line.slice(start, end), start: { line: pos.line, col: start } };
}
