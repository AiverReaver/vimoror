/**
 * `p` and `P` — putting a register back into the buffer.
 *
 * The register's TYPE, not the key, decides what a put does: the same `p` opens
 * new lines for a linewise register and splices text inline for a charwise one.
 * That is the whole reason `dd` then `p` swaps two lines while `x` then `p`
 * swaps two characters, and it is why registers carry a type at all.
 *
 * Cursor rules are Vim's, and they are not uniform — see each branch.
 */

import { applyEdit, firstNonBlank, insertLines, lastLine, lineAt, type Lines } from './buffer.ts';
import type { Pos, RegisterValue } from './types.ts';

export type PutResult = {
  readonly lines: string[];
  readonly cursor: Pos;
  /** First line the put touched, for the BufferChanged span. */
  readonly firstLine: number;
};

/** A linewise register value always ends in a newline; that trailer is not a line. */
function linewiseBody(text: string): string[] {
  return text.replace(/\n$/, '').split('\n');
}

export function applyPut(
  lines: Lines,
  cursor: Pos,
  value: RegisterValue,
  forward: boolean,
  count: number,
): PutResult {
  if (value.type === 'linewise') return putLinewise(lines, cursor, value.text, forward, count);
  if (value.type === 'blockwise') return putBlockwise(lines, cursor, value.text, forward, count);
  return putCharwise(lines, cursor, value.text, forward, count);
}

/**
 * Charwise put. `p` inserts after the cursor character — but on an EMPTY line
 * there is no character to be after, so it inserts at column zero rather than
 * at the non-existent column one.
 */
function putCharwise(lines: Lines, cursor: Pos, text: string, forward: boolean, count: number): PutResult {
  const repeated = text.repeat(count);
  const empty = lineAt(lines, cursor.line).length === 0;
  const col = cursor.col + (forward && !empty ? 1 : 0);
  const at: Pos = { line: cursor.line, col };
  const next = applyEdit(lines, { start: at, end: at, text: repeated });

  const parts = repeated.split('\n');
  const cursorPos: Pos =
    parts.length === 1
      ? // Single-line: the cursor lands on the LAST character put, which is what
        // makes `xp` transpose and leaves `3p` sitting at the very end.
        { line: cursor.line, col: col + repeated.length - 1 }
      : // Multi-line charwise: the cursor lands on the FIRST character instead.
        at;

  return { lines: next, cursor: cursorPos, firstLine: cursor.line };
}

/** Linewise put: whole lines above or below, cursor on the first one's first non-blank. */
function putLinewise(lines: Lines, cursor: Pos, text: string, forward: boolean, count: number): PutResult {
  const body = linewiseBody(text);
  const inserted: string[] = [];
  for (let i = 0; i < count; i += 1) inserted.push(...body);

  const at = forward ? cursor.line + 1 : cursor.line;
  const next = insertLines(lines, at, inserted);
  return { lines: next, cursor: { line: at, col: firstNonBlank(next, at) }, firstLine: at };
}

/**
 * Blockwise put: each of the register's lines is spliced in at the SAME column
 * on successive buffer lines, and lines too short to reach that column are
 * padded with spaces. Lines are appended past the end of the buffer as needed.
 */
function putBlockwise(lines: Lines, cursor: Pos, text: string, forward: boolean, count: number): PutResult {
  const body = text.replace(/\n$/, '').split('\n');
  const empty = lineAt(lines, cursor.line).length === 0;
  const col = cursor.col + (forward && !empty ? 1 : 0);

  const next = [...lines];
  for (let i = 0; i < body.length; i += 1) {
    const line = cursor.line + i;
    while (line > lastLine(next)) next.push('');
    const existing = next[line]!;
    const padded = existing.length < col ? existing + ' '.repeat(col - existing.length) : existing;
    const chunk = body[i]!.repeat(count);
    next[line] = padded.slice(0, col) + chunk + padded.slice(col);
  }

  return { lines: next, cursor: { line: cursor.line, col }, firstLine: cursor.line };
}
