/**
 * Buffer primitives: line access, position math, immutable edits.
 *
 * A buffer is always at least one line; Vim has no zero-line buffer, and an
 * "empty file" is one empty line. Every function here is pure.
 */

import type { Edit, Pos } from './types.ts';

export type Lines = readonly string[];

export function lineAt(lines: Lines, n: number): string {
  return lines[n] ?? '';
}

export function lineCount(lines: Lines): number {
  return lines.length;
}

export function lastLine(lines: Lines): number {
  return lines.length - 1;
}

export function pos(line: number, col: number): Pos {
  return { line, col };
}

export function comparePos(a: Pos, b: Pos): number {
  if (a.line !== b.line) return a.line - b.line;
  return a.col - b.col;
}

export function posEqual(a: Pos, b: Pos): boolean {
  return a.line === b.line && a.col === b.col;
}

/**
 * Clamp a position into the buffer.
 *
 * Normal mode cannot sit past the last character, but insert mode can sit one
 * past it — that one-column difference is the source of a great many
 * off-by-one bugs, so it is an explicit parameter rather than a guess.
 */
export function clamp(lines: Lines, p: Pos, allowEndOfLine: boolean): Pos {
  const line = Math.max(0, Math.min(p.line, lastLine(lines)));
  const len = lineAt(lines, line).length;
  const maxCol = allowEndOfLine ? len : Math.max(0, len - 1);
  return { line, col: Math.max(0, Math.min(p.col, maxCol)) };
}

export function isEmptyLine(lines: Lines, line: number): boolean {
  return lineAt(lines, line).length === 0;
}

/**
 * First non-blank column of a line.
 *
 * On an all-blank line there is no non-blank to land on, and Vim clamps to the
 * LAST character rather than to column 0 — `^` on a line of five spaces lands
 * on column 4, not 0. An empty line still yields 0.
 */
export function firstNonBlank(lines: Lines, line: number): number {
  const text = lineAt(lines, line);
  const m = /\S/.exec(text);
  return m ? m.index : Math.max(0, text.length - 1);
}

// --- character classes ------------------------------------------------------

export const CHAR_BLANK = 0;
export const CHAR_PUNCT = 1;
export const CHAR_WORD = 2;

/**
 * Vim's character classes, per the default
 * `iskeyword=@,48-57,_,192-255`. `w`/`b`/`e` treat a run of class-2 or a run
 * of class-1 as a word; `W`/`B`/`E` treat any run of non-blank as a WORD.
 */
export function charClass(ch: string | undefined, big: boolean): number {
  if (ch === undefined || ch === '') return CHAR_BLANK;
  if (ch === ' ' || ch === '\t') return CHAR_BLANK;
  if (big) return CHAR_WORD;
  if (/[0-9A-Za-z_]/.test(ch)) return CHAR_WORD;
  const code = ch.codePointAt(0) ?? 0;
  if (code >= 192 && code <= 255) return CHAR_WORD;
  if (code > 255) return CHAR_WORD;
  return CHAR_PUNCT;
}

export function charAt(lines: Lines, p: Pos): string | undefined {
  return lineAt(lines, p.line)[p.col];
}

/** Advance one character, stepping over line ends. Returns null at end of buffer. */
export function nextPos(lines: Lines, p: Pos): Pos | null {
  const len = lineAt(lines, p.line).length;
  if (p.col + 1 < len) return { line: p.line, col: p.col + 1 };
  if (p.line >= lastLine(lines)) {
    return p.col + 1 <= len ? null : null;
  }
  return { line: p.line + 1, col: 0 };
}

/** Retreat one character, stepping over line ends. Returns null at start of buffer. */
export function prevPos(lines: Lines, p: Pos): Pos | null {
  if (p.col > 0) return { line: p.line, col: p.col - 1 };
  if (p.line === 0) return null;
  const prevLen = lineAt(lines, p.line - 1).length;
  return { line: p.line - 1, col: Math.max(0, prevLen - 1) };
}

// --- edits ------------------------------------------------------------------

/** Text of the half-open span [start, end). */
export function textBetween(lines: Lines, start: Pos, end: Pos): string {
  if (comparePos(start, end) >= 0) return '';
  if (start.line === end.line) {
    return lineAt(lines, start.line).slice(start.col, end.col);
  }
  const parts: string[] = [lineAt(lines, start.line).slice(start.col)];
  for (let l = start.line + 1; l < end.line; l += 1) parts.push(lineAt(lines, l));
  parts.push(lineAt(lines, end.line).slice(0, end.col));
  return parts.join('\n');
}

/** Replace the half-open span [start, end) with `text`. Pure; returns new lines. */
export function applyEdit(lines: Lines, edit: Edit): string[] {
  const { start, end, text } = edit;
  const head = lineAt(lines, start.line).slice(0, start.col);
  const tail = lineAt(lines, end.line).slice(end.col);
  const inserted = (head + text + tail).split('\n');
  return [...lines.slice(0, start.line), ...inserted, ...lines.slice(end.line + 1)];
}

/** Delete whole lines [first, last] inclusive. A buffer never becomes zero lines. */
export function deleteLines(lines: Lines, first: number, last: number): string[] {
  const next = [...lines.slice(0, first), ...lines.slice(last + 1)];
  return next.length === 0 ? [''] : next;
}

export function insertLines(lines: Lines, at: number, inserted: readonly string[]): string[] {
  return [...lines.slice(0, at), ...inserted, ...lines.slice(at)];
}
