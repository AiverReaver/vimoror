/**
 * Operators: `d c y > < gu gU g~`.
 *
 * An operator plus a motion is the spine of the whole language, and the two
 * properties that decide what it touches — linewise vs charwise, inclusive vs
 * exclusive — are carried on the motion itself rather than looked up here. That
 * is deliberate: `dw` vs `de` vs `d$` is the single most common place engines
 * get Vim wrong, so the distinction lives in one place and is tested directly.
 */

import {
  applyEdit,
  comparePos,
  deleteLines,
  firstNonBlank,
  lastLine,
  lineAt,
  textBetween,
  type Lines,
} from './buffer.ts';
import type { MotionResult, Pos, RegisterType } from './types.ts';

export type OperatorName = 'd' | 'c' | 'y' | '>' | '<' | 'gu' | 'gU' | 'g~';

export type EditorOptions = {
  readonly shiftwidth: number;
  readonly tabstop: number;
  readonly expandtab: boolean;
  readonly autoindent: boolean;
};

export const DEFAULT_OPTIONS: EditorOptions = {
  shiftwidth: 4,
  tabstop: 8,
  expandtab: true,
  autoindent: false,
};

/** 'shiftwidth' zero means "follow 'tabstop'", exactly as in Vim. */
function effectiveShiftwidth(opts: EditorOptions): number {
  return opts.shiftwidth === 0 ? opts.tabstop : opts.shiftwidth;
}

/** Number of leading blank columns — where the "indent" of a line ends. */
function leadingBlanks(text: string): number {
  return /^[ \t]*/.exec(text)![0].length;
}

export type OperatorRange =
  | { readonly kind: 'charwise'; readonly start: Pos; readonly end: Pos }
  | { readonly kind: 'linewise'; readonly firstLine: number; readonly lastLine: number };

/** Turn a cursor plus a motion into the span the operator actually acts on. */
export function operatorRange(lines: Lines, cursor: Pos, motion: MotionResult): OperatorRange {
  if (motion.kind === 'linewise') {
    return {
      kind: 'linewise',
      firstLine: Math.min(cursor.line, motion.target.line),
      lastLine: Math.max(cursor.line, motion.target.line),
    };
  }

  const backwards = comparePos(motion.target, cursor) < 0;
  const start = backwards ? motion.target : cursor;
  const end = backwards ? cursor : motion.target;

  // Vim's two exclusive-motion adjustments (:help exclusive-linewise), applied
  // to any exclusive charwise motion whose end lands in column one of a later
  // line. They are why `dw` on an empty line deletes the LINE (rule 2) and why
  // `db` from column one does not drag the newline along (rule 1).
  if (!motion.inclusive && end.col === 0 && end.line > start.line) {
    const endLine = end.line - 1;
    // Rule 2: motion started at or before the first non-blank → linewise.
    if (start.col <= leadingBlanks(lineAt(lines, start.line))) {
      return { kind: 'linewise', firstLine: start.line, lastLine: endLine };
    }
    // Rule 1: end moves to just past the previous line's last character.
    return { kind: 'charwise', start, end: { line: endLine, col: lineAt(lines, endLine).length } };
  }

  // An inclusive motion takes the character under the region's far end too —
  // whichever direction the motion ran (`dge` and backward `d%` both include
  // the character the cursor started on).
  return {
    kind: 'charwise',
    start,
    end: motion.inclusive ? { line: end.line, col: end.col + 1 } : end,
  };
}


export type OperatorResult = {
  readonly lines: string[];
  readonly cursor: Pos;
  /** Text captured for the register, if this operator captures any. */
  readonly captured?: { readonly text: string; readonly type: RegisterType; readonly multiline: boolean };
  /** True when the operator leaves the editor in insert mode. */
  readonly entersInsert?: boolean;
};

function rangeText(lines: Lines, range: OperatorRange): string {
  if (range.kind === 'linewise') {
    // A linewise register value always ends in a newline — that is what makes
    // `p` open a new line rather than paste inline.
    return `${lines.slice(range.firstLine, range.lastLine + 1).join('\n')}\n`;
  }
  return textBetween(lines, range.start, range.end);
}

function isMultiline(range: OperatorRange): boolean {
  return range.kind === 'linewise' || range.start.line !== range.end.line;
}

function capture(lines: Lines, range: OperatorRange) {
  return {
    text: rangeText(lines, range),
    type: (range.kind === 'linewise' ? 'linewise' : 'charwise') as RegisterType,
    multiline: isMultiline(range),
  };
}

export function applyDelete(lines: Lines, range: OperatorRange): OperatorResult {
  // Vim's op_delete promotion: a charwise delete that spans lines, ends where
  // only blanks remain, and starts inside the indent, becomes LINEWISE. This
  // is what makes `d9w` overshooting the buffer take whole lines.
  if (
    range.kind === 'charwise' &&
    range.start.line < range.end.line &&
    /^[ \t]*$/.test(lineAt(lines, range.end.line).slice(range.end.col)) &&
    range.start.col <= leadingBlanks(lineAt(lines, range.start.line))
  ) {
    range = { kind: 'linewise', firstLine: range.start.line, lastLine: range.end.line };
  }

  const captured = capture(lines, range);

  if (range.kind === 'linewise') {
    const next = deleteLines(lines, range.firstLine, range.lastLine);
    const line = Math.min(range.firstLine, next.length - 1);
    return { lines: next, cursor: { line, col: firstNonBlank(next, line) }, captured };
  }

  const next = applyEdit(lines, { start: range.start, end: range.end, text: '' });
  return { lines: next, cursor: range.start, captured };
}

export function applyChange(lines: Lines, range: OperatorRange, opts: EditorOptions): OperatorResult {
  const captured = capture(lines, range);

  if (range.kind === 'linewise') {
    // `cc` clears the lines but leaves one empty line to type into, rather
    // than removing them the way `dd` does. With 'autoindent' the first
    // line's indent survives onto that line.
    const first = lineAt(lines, range.firstLine);
    const indent = opts.autoindent ? first.slice(0, leadingBlanks(first)) : '';
    const next = [
      ...lines.slice(0, range.firstLine),
      indent,
      ...lines.slice(range.lastLine + 1),
    ];
    return { lines: next, cursor: { line: range.firstLine, col: indent.length }, captured, entersInsert: true };
  }

  const next = applyEdit(lines, { start: range.start, end: range.end, text: '' });
  return { lines: next, cursor: range.start, captured, entersInsert: true };
}

/** Yank never changes the buffer; cursor movement is decided by the caller. */
export function applyYank(lines: Lines, range: OperatorRange): OperatorResult {
  return { lines: [...lines], cursor: { line: 0, col: 0 }, captured: capture(lines, range) };
}

// --- case operators ---------------------------------------------------------

function transformCase(op: 'gu' | 'gU' | 'g~', text: string): string {
  if (op === 'gu') return text.toLowerCase();
  if (op === 'gU') return text.toUpperCase();
  return [...text]
    .map((c) => {
      const lower = c.toLowerCase();
      return c === lower ? c.toUpperCase() : lower;
    })
    .join('');
}

export function applyCase(
  lines: Lines,
  op: 'gu' | 'gU' | 'g~',
  range: OperatorRange,
  opStart: Pos,
): OperatorResult {
  // The cursor lands on the start of the operated text as a POSITION — for
  // `gUj` that keeps the original column rather than snapping to non-blank.
  if (range.kind === 'linewise') {
    const next = [...lines];
    for (let l = range.firstLine; l <= range.lastLine; l += 1) {
      next[l] = transformCase(op, lineAt(lines, l));
    }
    return { lines: next, cursor: opStart };
  }

  const text = textBetween(lines, range.start, range.end);
  const next = applyEdit(lines, { start: range.start, end: range.end, text: transformCase(op, text) });
  return { lines: next, cursor: range.start };
}

/** `~` — toggle the case of `count` characters and step past them. */
export function applyTilde(lines: Lines, cursor: Pos, count: number): OperatorResult {
  const text = lineAt(lines, cursor.line);
  if (text.length === 0) return { lines: [...lines], cursor };
  const end = Math.min(text.length, cursor.col + count);
  const next = applyEdit(lines, {
    start: cursor,
    end: { line: cursor.line, col: end },
    text: transformCase('g~', text.slice(cursor.col, end)),
  });
  return { lines: next, cursor: { line: cursor.line, col: Math.min(end, Math.max(0, text.length - 1)) } };
}

// --- indent operators -------------------------------------------------------

/** Display width of a line's leading whitespace, expanding tabs. */
function indentWidth(text: string, tabstop: number): number {
  let width = 0;
  for (const ch of text) {
    if (ch === ' ') width += 1;
    else if (ch === '\t') width += tabstop - (width % tabstop);
    else break;
  }
  return width;
}

function indentChars(text: string): number {
  const m = /^[ \t]*/.exec(text);
  return m ? m[0].length : 0;
}

function renderIndent(width: number, opts: EditorOptions): string {
  if (width <= 0) return '';
  if (opts.expandtab) return ' '.repeat(width);
  return '\t'.repeat(Math.floor(width / opts.tabstop)) + ' '.repeat(width % opts.tabstop);
}

export function applyIndent(
  lines: Lines,
  op: '>' | '<',
  range: OperatorRange,
  opts: EditorOptions,
  count = 1,
): OperatorResult {
  // Indent is always linewise, even when driven by a charwise motion like `>w`.
  const first = range.kind === 'linewise' ? range.firstLine : Math.min(range.start.line, range.end.line);
  const last = range.kind === 'linewise' ? range.lastLine : Math.max(range.start.line, range.end.line);

  const next = [...lines];
  for (let l = first; l <= last; l += 1) {
    const text = lineAt(lines, l);
    // An empty line is never indented — a classic wart, and the reason `>>`
    // on a blank line looks like it silently failed.
    if (text.length === 0) continue;

    const current = indentWidth(text, opts.tabstop);
    const delta = effectiveShiftwidth(opts) * count * (op === '>' ? 1 : -1);
    const width = Math.max(0, current + delta);
    next[l] = renderIndent(width, opts) + text.slice(indentChars(text));
  }

  return { lines: next, cursor: { line: first, col: firstNonBlank(next, first) } };
}
