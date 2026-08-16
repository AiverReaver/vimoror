/**
 * Ex commands: `:` command-line mode — range parsing plus the commands that
 * don't need substitution logic (`:d :m :t :normal :set`, and the zero-I/O
 * `:w`/`:q`).
 *
 * Pure and DOM-free, like `motions.ts`/`textobjects.ts`/`operators.ts`: this
 * module only turns a typed command LINE into structured data (a range, a
 * resolved command name, pure line-splice results for `:m`/`:t`). Actually
 * applying a command — committing undo, moving the cursor, replaying
 * `:normal`'s keys back through `step()` — stays in `state.ts`, which is the
 * only place that owns those side effects.
 */

import { firstNonBlank, type Lines } from './buffer.ts';
import type { Marks } from './marks.ts';
import type { EditorOptions } from './operators.ts';
import type { InvalidReason, Pos } from './types.ts';

export type ExRange = { readonly first: number; readonly last: number };

export type RangeContext = {
  readonly cursor: Pos;
  /** 0-based index of the last line — `buffer.ts`'s `lastLine(state.lines)`. */
  readonly lastLine: number;
  readonly marks: Marks;
};

export type ExCommand = {
  readonly range: ExRange | undefined;
  /** Canonical name (`'delete'`, `'move'`, ...), or `''` for a bare range with no command. */
  readonly name: string;
  readonly bang: boolean;
  /** Raw remainder after the command name and its one separating space, if any. */
  readonly args: string;
};

type ExError = { readonly error: InvalidReason };

// --- addresses and ranges ----------------------------------------------------

type AddrResult = { readonly line: number; readonly pos: number } | ExError;

/**
 * One line address at `s[i]`: `. $ {number} 'x`, each optionally followed by
 * one or more chained `+n`/`-n` offsets (bare `+`/`-` means 1). Returns `null`
 * — not an error — when there is no address token at this position at all,
 * which is how a bare `:command` (no range) is told apart from a malformed one.
 */
function parseOneAddress(s: string, i: number, ctx: RangeContext): AddrResult | null {
  let line: number;
  let pos = i;
  const ch = s[pos];

  if (ch === '.') {
    line = ctx.cursor.line;
    pos += 1;
  } else if (ch === '$') {
    line = ctx.lastLine;
    pos += 1;
  } else if (ch !== undefined && /[0-9]/.test(ch)) {
    let j = pos;
    while (j < s.length && /[0-9]/.test(s[j]!)) j += 1;
    line = Number.parseInt(s.slice(pos, j), 10) - 1;
    pos = j;
  } else if (ch === "'") {
    const name = s[pos + 1];
    if (name === undefined) return { error: 'invalid-range' };
    const mark = ctx.marks[name];
    if (mark === undefined) return { error: 'mark-not-set' };
    line = mark.line;
    pos += 2;
  } else {
    return null;
  }

  while (s[pos] === '+' || s[pos] === '-') {
    const sign = s[pos] === '+' ? 1 : -1;
    pos += 1;
    let j = pos;
    while (j < s.length && /[0-9]/.test(s[j]!)) j += 1;
    const n = j > pos ? Number.parseInt(s.slice(pos, j), 10) : 1;
    line += sign * n;
    pos = j;
  }

  return { line, pos };
}

/**
 * `%` is shorthand for `1,$` and nothing may follow it. Otherwise one or two
 * addresses separated by `,`; one address alone is that single line.
 *
 * A backwards range is silently swapped rather than prompted for — real Vim
 * asks "Backwards range given, OK to swap (y/n)?" interactively, which has no
 * meaning for a scripted/replayed engine.
 *
 * ponytail: swap-without-asking is the whole simplification; upgrade path is
 * an event the host can turn into an actual prompt, if a stage ever wants one.
 */
export function parseRange(s: string, ctx: RangeContext): { readonly range: ExRange | undefined; readonly rest: string } | ExError {
  if (s[0] === '%') {
    return { range: { first: 0, last: ctx.lastLine }, rest: s.slice(1) };
  }

  const a = parseOneAddress(s, 0, ctx);
  if (a === null) return { range: undefined, rest: s };
  if ('error' in a) return a;

  let first = a.line;
  let last = a.line;
  let pos = a.pos;

  if (s[pos] === ',') {
    const b = parseOneAddress(s, pos + 1, ctx);
    if (b === null) return { error: 'invalid-range' };
    if ('error' in b) return b;
    last = b.line;
    pos = b.pos;
  }

  if (first > last) [first, last] = [last, first];
  if (first < 0 || last > ctx.lastLine) return { error: 'invalid-range' };
  return { range: { first, last }, rest: s.slice(pos) };
}

/** A single destination address for `:m`/`:t` — `-1` means "before line one", same as Vim's `0`. */
export function parseDestAddress(s: string, ctx: RangeContext): { readonly line: number } | ExError {
  const r = parseOneAddress(s.trim(), 0, ctx);
  if (r === null) return { error: 'invalid-range' };
  if ('error' in r) return r;
  if (r.line < -1 || r.line > ctx.lastLine) return { error: 'invalid-range' };
  return { line: r.line };
}

// --- command names ------------------------------------------------------------

/** Minimum abbreviation Vim itself requires for each of these — not a general uniqueness solver, just the handful we implement. */
const COMMANDS: readonly { readonly canonical: string; readonly full: string; readonly min: number }[] = [
  { canonical: 'delete', full: 'delete', min: 1 },
  { canonical: 'move', full: 'move', min: 1 },
  // `:c` alone is `:change` in real Vim, so `:copy` needs at least `:co`.
  { canonical: 'copy', full: 'copy', min: 2 },
  { canonical: 'normal', full: 'normal', min: 4 },
  { canonical: 'set', full: 'set', min: 2 },
  // `:s` alone is already unambiguous, unlike `:c`/`:co`.
  { canonical: 'substitute', full: 'substitute', min: 1 },
  // `:g` and `:v` are each unambiguous on their own — no letter starts more
  // than one command implemented here.
  { canonical: 'global', full: 'global', min: 1 },
  { canonical: 'vglobal', full: 'vglobal', min: 1 },
  { canonical: 'write', full: 'write', min: 1 },
  { canonical: 'quit', full: 'quit', min: 1 },
];

/** `:t` is its own historical synonym for `:copy`, not an abbreviation of it. */
export function resolveCommandName(word: string): string | undefined {
  if (word === 't') return 'copy';
  for (const c of COMMANDS) {
    if (word.length >= c.min && c.full.startsWith(word)) return c.canonical;
  }
  return undefined;
}

/**
 * Range, then command name (letters, optional `!`), then everything after ONE
 * separating space — further leading space in `args` is preserved literally,
 * since `:normal`'s argument is raw keys where that could be meaningful.
 */
export function parseCommand(cmdline: string, ctx: RangeContext): ExCommand | ExError {
  const text = cmdline.replace(/^\s+/, '');
  const r = parseRange(text, ctx);
  if ('error' in r) return r;
  const afterRange = r.rest.replace(/^\s+/, '');

  if (afterRange === '') {
    return { range: r.range, name: '', bang: false, args: '' };
  }

  const m = /^([a-zA-Z]+)(!?)/.exec(afterRange);
  if (m === null) return { error: 'unknown-command' };
  const word = m[1]!;
  const bang = m[2] === '!';
  const afterName = afterRange.slice(m[0].length);
  const args = afterName.startsWith(' ') ? afterName.slice(1) : afterName;

  const name = resolveCommandName(word);
  if (name === undefined) return { error: 'unknown-command' };
  return { range: r.range, name, bang, args };
}

// --- pure line-splice helpers for :m and :t -----------------------------------

/**
 * `:m` — splice `range` out and reinsert it right after `dest` (0-based;
 * `-1` is "before line one"). `dest` is an index into the ORIGINAL lines, so
 * once the range is removed, a destination at or after it shifts left by the
 * size of what was removed — that single adjustment is what makes moving to
 * `$`, or to a line below the range, land in the right place.
 *
 * Returns `null` when `dest` falls inside `range` itself — Vim's E134, moving
 * lines into themselves.
 */
export function applyMove(lines: Lines, range: ExRange, dest: number): { readonly lines: Lines; readonly cursor: Pos } | null {
  if (dest >= range.first && dest <= range.last) return null;
  const moved = lines.slice(range.first, range.last + 1);
  const rest = [...lines.slice(0, range.first), ...lines.slice(range.last + 1)];
  const insertAt = dest >= range.first ? dest + 1 - moved.length : dest + 1;
  const next = [...rest.slice(0, insertAt), ...moved, ...rest.slice(insertAt)];
  const landed = insertAt + moved.length - 1;
  return { lines: next, cursor: { line: landed, col: firstNonBlank(next, landed) } };
}

/** `:t`/`:copy` — duplicate `range` right after `dest`. Unlike `:m`, `dest` may sit inside `range`. */
export function applyCopy(lines: Lines, range: ExRange, dest: number): { readonly lines: Lines; readonly cursor: Pos } {
  const copied = lines.slice(range.first, range.last + 1);
  const insertAt = dest + 1;
  const next = [...lines.slice(0, insertAt), ...copied, ...lines.slice(insertAt)];
  const landed = insertAt + copied.length - 1;
  return { lines: next, cursor: { line: landed, col: firstNonBlank(next, landed) } };
}

// --- :set ----------------------------------------------------------------------

/** One `:set` token, e.g. `sw=2` or `noexpandtab`. Shared with the golden harness's own `:set` overrides — see `tools/goldens/compare.ts`. */
function applyOneSetArg(opts: EditorOptions, arg: string): EditorOptions {
  const num = /^(shiftwidth|sw|tabstop|ts)=(\d+)$/.exec(arg);
  if (num) {
    const value = Number.parseInt(num[2]!, 10);
    return num[1] === 'shiftwidth' || num[1] === 'sw' ? { ...opts, shiftwidth: value } : { ...opts, tabstop: value };
  }
  if (arg === 'expandtab' || arg === 'et') return { ...opts, expandtab: true };
  if (arg === 'noexpandtab' || arg === 'noet') return { ...opts, expandtab: false };
  if (arg === 'autoindent' || arg === 'ai') return { ...opts, autoindent: true };
  if (arg === 'noautoindent' || arg === 'noai') return { ...opts, autoindent: false };
  if (arg === 'ignorecase' || arg === 'ic') return { ...opts, ignorecase: true };
  if (arg === 'noignorecase' || arg === 'noic') return { ...opts, ignorecase: false };
  if (arg === 'smartcase' || arg === 'scs') return { ...opts, smartcase: true };
  if (arg === 'nosmartcase' || arg === 'noscs') return { ...opts, smartcase: false };
  if (arg === 'wrapscan' || arg === 'ws') return { ...opts, wrapscan: true };
  if (arg === 'nowrapscan' || arg === 'nows') return { ...opts, wrapscan: false };
  return opts;
}

export function applySetArgs(options: EditorOptions, argsText: string): EditorOptions {
  let opts = options;
  for (const arg of argsText.split(/\s+/)) {
    if (arg !== '') opts = applyOneSetArg(opts, arg);
  }
  return opts;
}
