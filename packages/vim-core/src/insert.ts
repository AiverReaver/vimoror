/**
 * Insert and Replace mode.
 *
 * Insert mode is one undo block per session, not per keystroke — `u` after
 * typing a word removes the whole word. That is why the undo snapshot is
 * pushed on `<Esc>` rather than on each edit.
 *
 * It also matters narratively: Act I has a stage where `<Esc>` does not work
 * and the player is trapped here, able to write but not to act. That scare only
 * lands if insert mode is a real, constrained state rather than a flag.
 */

import { applyEdit, lineAt, type Lines } from './buffer.ts';
import type { KeyToken, Pos } from './types.ts';
import type { EditorOptions } from './operators.ts';

export type InsertSession = {
  /** Replace mode overwrites instead of shifting text right. */
  readonly replace: boolean;
  /** `3i` repeats the whole insertion on `<Esc>`. */
  readonly count: number;
  /**
   * The session's RAW keystrokes. A counted insert repeats these on `<Esc>` —
   * never a reconstructed "net text", because a `<BS>` that ate PRE-session
   * text must be repeated too, exactly as Vim's redo replays keys.
   */
  readonly keys: readonly KeyToken[];
  /** `o`/`O` repeat by opening more lines, not by repeating inline. */
  readonly openLine: 'below' | 'above' | undefined;
  /**
   * True when a change operator opened this session. Vim's `op_change` prepares
   * the undo entry before insert mode starts, so such a session commits one even
   * if nothing is typed — `cl<Esc>` on an empty line mints a node, `i<Esc>` does
   * not.
   */
  readonly fromChange: boolean;
  /** Where this session began, so repetition knows what to duplicate. */
  readonly start: Pos;
  /**
   * Where the whole change began, for the undo entry (Vim's uh_cursor). For
   * `o` that is the line the command was typed on, not the opened line.
   */
  readonly changeStart: Pos;
  /**
   * Replace mode's memory, one entry per overwritten column: the character an
   * overwrite destroyed, null where the line was merely extended, and '\n'
   * where a line break was inserted — `<BS>` consumes these to restore, delete
   * or rejoin rather than plainly deleting.
   */
  readonly replaced: readonly (string | null)[];
  /**
   * A blockwise insert (`<C-v>c`, and later `I`/`A`): typing happens on the
   * first row only, and on `<Esc>` the typed text is replicated down the other
   * rows at the same column. Rows too short to reach that column are skipped,
   * exactly as Vim skips them.
   */
  readonly blockRows: { readonly firstLine: number; readonly lastLine: number; readonly col: number } | undefined;
};

export type InsertStep = {
  readonly lines: string[];
  readonly cursor: Pos;
};

export function insertText(lines: Lines, cursor: Pos, text: string): InsertStep {
  const next = applyEdit(lines, { start: cursor, end: cursor, text });
  if (text.includes('\n')) {
    const parts = text.split('\n');
    return { lines: next, cursor: { line: cursor.line + parts.length - 1, col: parts[parts.length - 1]!.length } };
  }
  return { lines: next, cursor: { line: cursor.line, col: cursor.col + text.length } };
}

/**
 * One replace-mode keystroke. It consumes AT MOST ONE character no matter how
 * many characters the key contributes — a `<Tab>` expanding to eight spaces
 * still overwrites a single character and inserts the rest, exactly as Vim's
 * `ins_tab` does. Returns what was destroyed so `<BS>` can restore it.
 */
export function overwriteText(
  lines: Lines,
  cursor: Pos,
  text: string,
): InsertStep & { readonly destroyed: string } {
  const line = lineAt(lines, cursor.line);
  const destroyed = line.slice(cursor.col, cursor.col + 1);
  const next = applyEdit(lines, {
    start: cursor,
    end: { line: cursor.line, col: cursor.col + destroyed.length },
    text,
  });
  return { lines: next, cursor: { line: cursor.line, col: cursor.col + text.length }, destroyed };
}

/**
 * `<BS>` with the baseline `backspace=indent,eol,start`, which is what every
 * real user has via defaults.vim — so it joins lines at column 0 rather than
 * refusing to move.
 */
export function backspace(lines: Lines, cursor: Pos): InsertStep | null {
  if (cursor.col > 0) {
    const next = applyEdit(lines, {
      start: { line: cursor.line, col: cursor.col - 1 },
      end: cursor,
      text: '',
    });
    return { lines: next, cursor: { line: cursor.line, col: cursor.col - 1 } };
  }

  if (cursor.line === 0) return null;
  const prevLen = lineAt(lines, cursor.line - 1).length;
  const next = applyEdit(lines, {
    start: { line: cursor.line - 1, col: prevLen },
    end: { line: cursor.line, col: 0 },
    text: '',
  });
  return { lines: next, cursor: { line: cursor.line - 1, col: prevLen } };
}

/** `<Tab>`: with 'expandtab' and softtabstop=0, spaces up to the next tabstop. */
export function tabText(cursor: Pos, opts: EditorOptions): string {
  if (!opts.expandtab) return '\t';
  return ' '.repeat(opts.tabstop - (cursor.col % opts.tabstop));
}

/** Open a line above or below and land on it. */
export function openLine(lines: Lines, cursor: Pos, where: 'below' | 'above'): InsertStep {
  const at = where === 'below' ? cursor.line + 1 : cursor.line;
  const next = [...lines.slice(0, at), '', ...lines.slice(at)];
  return { lines: next, cursor: { line: at, col: 0 } };
}

/** The literal characters a key contributes inside insert mode, if any. */
export function insertLiteral(key: KeyToken, cursor: Pos, opts: EditorOptions): string | null {
  if (key === '<CR>' || key === '<NL>') return '\n';
  if (key === '<Tab>') return tabText(cursor, opts);
  if (key === '<Space>') return ' ';
  if (key.length === 1 && key >= ' ' && key !== '\x7f') return key;
  return null;
}
