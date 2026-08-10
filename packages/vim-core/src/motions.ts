/**
 * Wave 1 motions.
 *
 * Each motion returns where the cursor lands plus the two properties operators
 * need: linewise vs charwise, and inclusive vs exclusive. Getting
 * inclusive/exclusive wrong is the single most common way an engine gets Vim
 * wrong (`dw` vs `de` vs `d$`), so it is part of every return value rather than
 * a lookup table somewhere else.
 *
 * Returning `null` means the motion failed. A failed motion aborts a pending
 * operator without modifying the buffer — that is Vim's behavior and it is also
 * what lets the game reject a key in fiction.
 */

import {
  CHAR_BLANK,
  charAt,
  charClass,
  firstNonBlank,
  lastLine,
  lineAt,
  type Lines,
} from './buffer.ts';
import type { MotionResult, Pos } from './types.ts';

export type MotionContext = {
  readonly lines: Lines;
  readonly cursor: Pos;
  readonly count: number;
  /** Explicit count was typed; some motions behave differently without one. */
  readonly hasCount: boolean;
  readonly desiredCol: number;
  /** True while an operator is waiting — enables the `dw` end-of-line wart. */
  readonly operatorPending: boolean;
  /** The character argument for `f F t T` and friends. */
  readonly arg?: string;
  readonly lastFind?: { readonly cmd: 'f' | 'F' | 't' | 'T'; readonly ch: string };
};

function charwise(target: Pos, inclusive: boolean, extra: Partial<MotionResult> = {}): MotionResult {
  return { target, kind: 'charwise', inclusive, ...extra };
}

function linewise(target: Pos): MotionResult {
  return { target, kind: 'linewise', inclusive: false };
}

// --- horizontal -------------------------------------------------------------

export function moveLeft(ctx: MotionContext): MotionResult | null {
  const col = ctx.cursor.col - ctx.count;
  if (ctx.cursor.col === 0) return null;
  return charwise({ line: ctx.cursor.line, col: Math.max(0, col) }, false);
}

export function moveRight(ctx: MotionContext): MotionResult | null {
  const len = lineAt(ctx.lines, ctx.cursor.line).length;
  // `l` may sit one past the last character only while an operator is pending
  // (so `dl` deletes the final character); otherwise it stops on it.
  const max = ctx.operatorPending ? len : Math.max(0, len - 1);
  if (ctx.cursor.col >= max) return null;
  return charwise({ line: ctx.cursor.line, col: Math.min(max, ctx.cursor.col + ctx.count) }, false);
}

export function moveLineStart(ctx: MotionContext): MotionResult {
  return charwise({ line: ctx.cursor.line, col: 0 }, false);
}

export function moveFirstNonBlank(ctx: MotionContext): MotionResult {
  return charwise({ line: ctx.cursor.line, col: firstNonBlank(ctx.lines, ctx.cursor.line) }, false);
}

export function moveLineEnd(ctx: MotionContext): MotionResult {
  const line = Math.min(lastLine(ctx.lines), ctx.cursor.line + ctx.count - 1);
  const len = lineAt(ctx.lines, line).length;
  // `$` is inclusive, but on an empty line there is no character to include.
  return charwise({ line, col: Math.max(0, len - 1) }, len > 0);
}

// --- vertical ---------------------------------------------------------------

export function moveDown(ctx: MotionContext): MotionResult | null {
  const line = ctx.cursor.line + ctx.count;
  if (ctx.cursor.line >= lastLine(ctx.lines)) return null;
  return linewiseKeepingCol(ctx, Math.min(line, lastLine(ctx.lines)));
}

export function moveUp(ctx: MotionContext): MotionResult | null {
  if (ctx.cursor.line === 0) return null;
  return linewiseKeepingCol(ctx, Math.max(0, ctx.cursor.line - ctx.count));
}

function linewiseKeepingCol(ctx: MotionContext, line: number): MotionResult {
  const len = lineAt(ctx.lines, line).length;
  const col = Math.min(ctx.desiredCol, Math.max(0, len - 1));
  return { target: { line, col }, kind: 'linewise', inclusive: false, keepDesiredCol: true };
}

/** `G`, and `{n}G`. Without a count, the last line. */
export function moveGotoLine(ctx: MotionContext): MotionResult {
  const line = ctx.hasCount ? Math.min(ctx.count - 1, lastLine(ctx.lines)) : lastLine(ctx.lines);
  return linewise({ line, col: firstNonBlank(ctx.lines, line) });
}

/** `gg`, and `{n}gg`. Without a count, the first line. */
export function moveGotoFirstLine(ctx: MotionContext): MotionResult {
  const line = ctx.hasCount ? Math.min(ctx.count - 1, lastLine(ctx.lines)) : 0;
  return linewise({ line, col: firstNonBlank(ctx.lines, line) });
}

/** `+` / `<CR>` — first non-blank of the next line. */
export function moveLineDownFirstNonBlank(ctx: MotionContext): MotionResult | null {
  const line = ctx.cursor.line + ctx.count;
  if (line > lastLine(ctx.lines)) return null;
  return linewise({ line, col: firstNonBlank(ctx.lines, line) });
}

/** `-` — first non-blank of the previous line. */
export function moveLineUpFirstNonBlank(ctx: MotionContext): MotionResult | null {
  const line = ctx.cursor.line - ctx.count;
  if (line < 0) return null;
  return linewise({ line, col: firstNonBlank(ctx.lines, line) });
}

/** `_` — first non-blank, count-1 lines down. */
export function moveLineFirstNonBlank(ctx: MotionContext): MotionResult {
  const line = Math.min(lastLine(ctx.lines), ctx.cursor.line + ctx.count - 1);
  return linewise({ line, col: firstNonBlank(ctx.lines, line) });
}

// --- words ------------------------------------------------------------------

function endOfBuffer(lines: Lines): Pos {
  const line = lastLine(lines);
  return { line, col: Math.max(0, lineAt(lines, line).length - 1) };
}

/** One `w`: forward to the start of the next word. */
function wordForwardOnce(lines: Lines, from: Pos, big: boolean): Pos | null {
  let { line, col } = from;
  const startClass = charClass(charAt(lines, { line, col }), big);

  const step = (): boolean => {
    const len = lineAt(lines, line).length;
    if (col + 1 < len) {
      col += 1;
      return true;
    }
    if (line >= lastLine(lines)) return false;
    line += 1;
    col = 0;
    return true;
  };

  // Skip the rest of the current word, unless we start on whitespace.
  if (startClass !== CHAR_BLANK) {
    while (charClass(charAt(lines, { line, col }), big) === startClass) {
      const atLineEnd = col >= lineAt(lines, line).length - 1;
      if (!step()) return null;
      if (atLineEnd) break;
    }
  } else if (!step()) {
    return null;
  }

  // Skip whitespace. An empty line is itself a word, so stop on one.
  for (;;) {
    if (lineAt(lines, line).length === 0 && line !== from.line) return { line, col: 0 };
    if (charClass(charAt(lines, { line, col }), big) !== CHAR_BLANK) return { line, col };
    if (!step()) return null;
  }
}

export function moveWordForward(ctx: MotionContext): MotionResult | null {
  let cur = ctx.cursor;
  let lastLineEndCandidate: Pos | null = null;

  for (let i = 0; i < ctx.count; i += 1) {
    const len = lineAt(ctx.lines, cur.line).length;
    const restOfLineIsBlank =
      charClass(charAt(ctx.lines, cur), false) !== CHAR_BLANK &&
      lineAt(ctx.lines, cur.line)
        .slice(cur.col)
        .search(/\s/) === -1;
    if (restOfLineIsBlank) lastLineEndCandidate = { line: cur.line, col: len };

    const next = wordForwardOnce(ctx.lines, cur, ctx.arg === 'W');
    if (next === null) {
      // At the end of the buffer `w` still moves to the last character, and
      // with an operator pending it takes the rest of the line.
      const end = endOfBuffer(ctx.lines);
      if (ctx.operatorPending) {
        const eol = { line: cur.line, col: lineAt(ctx.lines, cur.line).length };
        return charwise(eol, false);
      }
      return charwise(end, false);
    }
    cur = next;
  }

  // The wart: with an operator pending, if `w` crossed onto a new line and the
  // last word moved over ended at end of line, the operated text stops at that
  // line end rather than swallowing the newline. `dw` on the last word of a
  // line is the case everybody gets wrong from memory.
  if (ctx.operatorPending && cur.line > ctx.cursor.line && lastLineEndCandidate !== null) {
    return charwise(lastLineEndCandidate, false);
  }

  return charwise(cur, false);
}

/** One `e`: forward to the end of a word. */
function wordEndOnce(lines: Lines, from: Pos, big: boolean): Pos | null {
  let { line, col } = from;

  const step = (): boolean => {
    const len = lineAt(lines, line).length;
    if (col + 1 < len) {
      col += 1;
      return true;
    }
    if (line >= lastLine(lines)) return false;
    line += 1;
    col = 0;
    return true;
  };

  if (!step()) return null;

  // Skip whitespace to reach a word. Running out of buffer lands on the last
  // character, mirroring `b` on an all-blank buffer.
  while (charClass(charAt(lines, { line, col }), big) === CHAR_BLANK) {
    if (!step()) return { line, col };
  }

  // Walk to the last character of this word.
  const cls = charClass(charAt(lines, { line, col }), big);
  for (;;) {
    const len = lineAt(lines, line).length;
    if (col + 1 >= len) return { line, col };
    if (charClass(charAt(lines, { line, col: col + 1 }), big) !== cls) return { line, col };
    col += 1;
  }
}

export function moveWordEnd(ctx: MotionContext): MotionResult | null {
  let cur = ctx.cursor;
  for (let i = 0; i < ctx.count; i += 1) {
    const next = wordEndOnce(ctx.lines, cur, ctx.arg === 'E');
    if (next === null) return i === 0 ? null : charwise(cur, true);
    cur = next;
  }
  // `e` is inclusive — `de` takes the final character of the word.
  return charwise(cur, true);
}

/** One `b`: back to the start of a word. */
function wordBackwardOnce(lines: Lines, from: Pos, big: boolean): Pos | null {
  let { line, col } = from;

  const step = (): boolean => {
    if (col > 0) {
      col -= 1;
      return true;
    }
    if (line === 0) return false;
    line -= 1;
    col = Math.max(0, lineAt(lines, line).length - 1);
    return true;
  };

  // Failing to step at all means we are already at the start of the buffer,
  // which is the one case where `b` genuinely fails.
  if (!step()) return null;

  while (charClass(charAt(lines, { line, col }), big) === CHAR_BLANK) {
    if (lineAt(lines, line).length === 0) return { line, col: 0 };
    // Running off the front while skipping blanks is NOT a failure: on an
    // all-blank buffer Vim lands on the first character rather than beeping.
    if (!step()) return { line: 0, col: 0 };
  }

  const cls = charClass(charAt(lines, { line, col }), big);
  while (col > 0 && charClass(charAt(lines, { line, col: col - 1 }), big) === cls) {
    col -= 1;
  }
  return { line, col };
}

export function moveWordBackward(ctx: MotionContext): MotionResult | null {
  let cur = ctx.cursor;
  for (let i = 0; i < ctx.count; i += 1) {
    const next = wordBackwardOnce(ctx.lines, cur, ctx.arg === 'B');
    if (next === null) return i === 0 ? null : charwise(cur, false);
    cur = next;
  }
  return charwise(cur, false);
}

/** `ge` — back to the end of the previous word. */
export function moveWordEndBackward(ctx: MotionContext): MotionResult | null {
  const big = ctx.arg === 'gE';
  let cur = ctx.cursor;

  for (let i = 0; i < ctx.count; i += 1) {
    let { line, col } = cur;
    const step = (): boolean => {
      if (col > 0) {
        col -= 1;
        return true;
      }
      if (line === 0) return false;
      line -= 1;
      col = Math.max(0, lineAt(ctx.lines, line).length - 1);
      return true;
    };

    if (!step()) return i === 0 ? null : charwise(cur, true);
    const startCls = charClass(charAt(ctx.lines, { line, col }), big);
    if (startCls !== CHAR_BLANK) {
      // Walk off the current word first.
      while (charClass(charAt(ctx.lines, { line, col }), big) === startCls) {
        if (!step()) return i === 0 ? null : charwise(cur, true);
      }
    }
    while (charClass(charAt(ctx.lines, { line, col }), big) === CHAR_BLANK) {
      if (!step()) return i === 0 ? null : charwise(cur, true);
    }
    cur = { line, col };
  }

  return charwise(cur, true);
}

// --- find within line -------------------------------------------------------

export function moveFind(
  ctx: MotionContext,
  cmd: 'f' | 'F' | 't' | 'T',
  ch: string,
  forRepeat = false,
): MotionResult | null {
  const text = lineAt(ctx.lines, ctx.cursor.line);
  let col = ctx.cursor.col;

  for (let i = 0; i < ctx.count; i += 1) {
    // After `t`, the cursor sits immediately before its target, so repeating
    // with `;` would match the very same character and never move. Vim's
    // default 'cpoptions' (no ';') skips it. This applies ONLY to a repeat —
    // an initial `t` must not skip, or `t,` from the start of `a,b` overshoots.
    const skipAdjacent = forRepeat && i === 0 && (cmd === 't' || cmd === 'T');

    if (cmd === 'f' || cmd === 't') {
      const from = col + (skipAdjacent ? 2 : 1);
      const found = text.indexOf(ch, from);
      if (found === -1) return null;
      col = found;
    } else {
      const from = col - (skipAdjacent ? 2 : 1);
      if (from < 0) return null;
      const found = text.lastIndexOf(ch, from);
      if (found === -1) return null;
      col = found;
    }
  }

  if (cmd === 't') col -= 1;
  if (cmd === 'T') col += 1;

  // `f` and `t` are inclusive; their backward twins are exclusive.
  const inclusive = cmd === 'f' || cmd === 't';
  return charwise({ line: ctx.cursor.line, col }, inclusive);
}

/** `;` and `,` — repeat the last `f F t T`, `,` in the opposite direction. */
export function moveFindRepeat(ctx: MotionContext, reverse: boolean): MotionResult | null {
  const last = ctx.lastFind;
  if (last === undefined) return null;
  const flipped: Record<string, 'f' | 'F' | 't' | 'T'> = { f: 'F', F: 'f', t: 'T', T: 't' };
  const cmd = reverse ? flipped[last.cmd]! : last.cmd;
  return moveFind(ctx, cmd, last.ch, true);
}

// --- brackets ---------------------------------------------------------------

const PAIRS: Record<string, { readonly match: string; readonly forward: boolean }> = {
  '(': { match: ')', forward: true },
  ')': { match: '(', forward: false },
  '[': { match: ']', forward: true },
  ']': { match: '[', forward: false },
  '{': { match: '}', forward: true },
  '}': { match: '{', forward: false },
};

/** `%` — jump to the match of the next bracket at or after the cursor. */
export function moveMatchingBracket(ctx: MotionContext): MotionResult | null {
  const text = lineAt(ctx.lines, ctx.cursor.line);
  let col = ctx.cursor.col;
  while (col < text.length && PAIRS[text[col]!] === undefined) col += 1;
  if (col >= text.length) return null;

  const open = text[col]!;
  const pair = PAIRS[open]!;
  let depth = 0;
  let line = ctx.cursor.line;
  let c = col;

  for (;;) {
    const ch = lineAt(ctx.lines, line)[c];
    if (ch === open) depth += 1;
    else if (ch === pair.match) {
      depth -= 1;
      if (depth === 0) return charwise({ line, col: c }, true);
    }

    if (pair.forward) {
      c += 1;
      while (c >= lineAt(ctx.lines, line).length) {
        line += 1;
        if (line > lastLine(ctx.lines)) return null;
        c = 0;
        if (lineAt(ctx.lines, line).length === 0) c = 0;
        else break;
      }
    } else {
      c -= 1;
      while (c < 0) {
        line -= 1;
        if (line < 0) return null;
        c = lineAt(ctx.lines, line).length - 1;
        if (c >= 0) break;
      }
    }
  }
}
