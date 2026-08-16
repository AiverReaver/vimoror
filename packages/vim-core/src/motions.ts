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
  /**
   * Vim's `one_more`: the cursor may rest ON the end-of-line NUL. True in
   * visual mode with 'selection' inclusive.
   *
   * Only `$` actually produces such a position — `l` refuses to step onto the
   * NUL without 'virtualedit', which is exactly why `v$d` joins the next line
   * up while `vlld` over the same characters leaves an empty one behind.
   * `j`/`k` inherit it through the remembered column.
   */
  readonly oneMore?: boolean;
  /** The character argument for `f F t T` and friends. */
  readonly arg?: string;
  readonly lastFind?: { readonly cmd: 'f' | 'F' | 't' | 'T'; readonly ch: string };
};

/** Character class at a position, for callers that need to reason about words. */
export function classAt(lines: Lines, p: Pos, big: boolean): number {
  return charClass(charAt(lines, p), big);
}

function charwise(target: Pos, inclusive: boolean, extra: Partial<MotionResult> = {}): MotionResult {
  return { target, kind: 'charwise', inclusive, ...extra };
}

function linewise(target: Pos): MotionResult {
  return { target, kind: 'linewise', inclusive: false };
}

// --- horizontal -------------------------------------------------------------

export function moveLeft(ctx: MotionContext): MotionResult | null {
  if (ctx.cursor.col === 0) {
    // Vim's `nv_left` beeps only when no operator is pending; with one it just
    // stops, and the operator runs over an EMPTY region. That is why `dh` at
    // column one deletes nothing yet still mints an undo node, and why `>h`
    // there really does indent the line. Same shape as `l` on an empty line.
    if (ctx.operatorPending) return charwise(ctx.cursor, false);
    return null;
  }
  // An overshooting count clamps rather than failing: `2dh` at column two
  // deletes exactly one character.
  return charwise({ line: ctx.cursor.line, col: Math.max(0, ctx.cursor.col - ctx.count) }, false);
}

export function moveRight(ctx: MotionContext): MotionResult | null {
  const len = lineAt(ctx.lines, ctx.cursor.line).length;
  // `l` may sit one past the last character only while an operator is pending
  // (so `dl` deletes the final character); otherwise it stops on it.
  const max = ctx.operatorPending ? len : Math.max(0, len - 1);
  if (ctx.cursor.col >= max) {
    // On an empty line the motion cannot move, but an operator still runs —
    // over an EMPTY region. This is why `cl` (and therefore `s`) on an empty
    // line deletes nothing yet still enters insert mode, while plain `l` beeps.
    if (ctx.operatorPending && len === 0) return charwise(ctx.cursor, false);
    return null;
  }
  return charwise({ line: ctx.cursor.line, col: Math.min(max, ctx.cursor.col + ctx.count) }, false);
}

export function moveLineStart(ctx: MotionContext): MotionResult {
  return charwise({ line: ctx.cursor.line, col: 0 }, false);
}

export function moveFirstNonBlank(ctx: MotionContext): MotionResult {
  return charwise({ line: ctx.cursor.line, col: firstNonBlank(ctx.lines, ctx.cursor.line) }, false);
}

export function moveLineEnd(ctx: MotionContext): MotionResult | null {
  // The count moves down count-1 lines with Vim's cursor_down() semantics:
  // already on the last line it FAILS (`2D` there beeps), anywhere else an
  // overshooting count clamps to the last line.
  if (ctx.count > 1 && ctx.cursor.line >= lastLine(ctx.lines)) return null;
  const line = Math.min(ctx.cursor.line + ctx.count - 1, lastLine(ctx.lines));
  const len = lineAt(ctx.lines, line).length;
  // `$` is ALWAYS inclusive, even on an empty line where there is nothing to
  // include — the resulting zero-character region is still a real region,
  // which is why `C` on an empty line writes (empty) registers while a failed
  // motion like `cl` there touches none.
  const col = ctx.oneMore === true ? len : Math.max(0, len - 1);
  return charwise({ line, col }, true);
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
  const max = ctx.oneMore === true ? len : Math.max(0, len - 1);
  const col = Math.min(ctx.desiredCol, max);
  return { target: { line, col }, kind: 'linewise', inclusive: false, keepDesiredCol: true };
}

/** `G`, and `{n}G`. Without a count, the last line. */
export function moveGotoLine(ctx: MotionContext): MotionResult {
  const line = ctx.hasCount ? Math.min(ctx.count - 1, lastLine(ctx.lines)) : lastLine(ctx.lines);
  return { ...linewise({ line, col: firstNonBlank(ctx.lines, line) }), isJump: true };
}

/** `gg`, and `{n}gg`. Without a count, the first line. */
export function moveGotoFirstLine(ctx: MotionContext): MotionResult {
  const line = ctx.hasCount ? Math.min(ctx.count - 1, lastLine(ctx.lines)) : 0;
  return { ...linewise({ line, col: firstNonBlank(ctx.lines, line) }), isJump: true };
}

/**
 * `+` / `<CR>` — first non-blank of the next line, count lines down. Same
 * `cursor_down()` overshoot rule `moveDown` already has: fails ONLY when the
 * cursor is ALREADY on the last line (`d+` there is a true no-op, pinned by
 * `delete/d-plus-at-last-line-noop`), clamps to the last line otherwise —
 * measured against real Vim with a scratch probe (`9+` from a NON-last line
 * of a 3-line buffer lands on the last line, no error). Found by fuzzing an
 * engine that beeped on every overshoot instead of only the boundary one.
 */
export function moveLineDownFirstNonBlank(ctx: MotionContext): MotionResult | null {
  if (ctx.cursor.line >= lastLine(ctx.lines)) return null;
  const line = Math.min(lastLine(ctx.lines), ctx.cursor.line + ctx.count);
  return linewise({ line, col: firstNonBlank(ctx.lines, line) });
}

/** `-` — first non-blank of the previous line, count lines up. Same boundary-only-fails rule as `moveUp`; see `moveLineDownFirstNonBlank`. */
export function moveLineUpFirstNonBlank(ctx: MotionContext): MotionResult | null {
  if (ctx.cursor.line === 0) return null;
  const line = Math.max(0, ctx.cursor.line - ctx.count);
  return linewise({ line, col: firstNonBlank(ctx.lines, line) });
}

/** `_` — first non-blank, count-1 lines down. */
export function moveLineFirstNonBlank(ctx: MotionContext): MotionResult {
  const line = Math.min(lastLine(ctx.lines), ctx.cursor.line + ctx.count - 1);
  return linewise({ line, col: firstNonBlank(ctx.lines, line) });
}

// --- words ------------------------------------------------------------------

/**
 * One step of Vim's internal cursor walk (`inc()`), over a position space that
 * INCLUDES the end-of-line position (`col === length`, where real Vim's cursor
 * sits on the NUL). Return codes mirror Vim's: 0 = moved within the line onto a
 * real character, 2 = moved onto the end-of-line position, 1 = wrapped to the
 * next line, -1 = end of buffer.
 */
export function incPos(lines: Lines, p: Pos): { readonly pos: Pos; readonly ret: number } {
  const len = lineAt(lines, p.line).length;
  if (p.col < len) {
    const col = p.col + 1;
    return { pos: { line: p.line, col }, ret: col < len ? 0 : 2 };
  }
  if (p.line >= lastLine(lines)) return { pos: p, ret: -1 };
  return { pos: { line: p.line + 1, col: 0 }, ret: 1 };
}

/**
 * A faithful port of Vim's `fwd_word` (search.c). `stopAtEol` is its `eol`
 * argument, true exactly when an operator is pending — it makes the walk stop
 * the moment the LAST count crosses an end of line, which is the mechanism
 * behind every `dw`-near-line-end wart. `failed` mirrors Vim's FAIL return:
 * an operator proceeds with the region anyway; plain `w` clamps and beeps.
 */
export function fwdWordWalk(
  lines: Lines,
  start: Pos,
  big: boolean,
  count: number,
  stopAtEol: boolean,
): { readonly pos: Pos; readonly failed: boolean } {
  let cur = start;

  for (let n = count; n > 0; n -= 1) {
    const last = n === 1;
    const sclass = charClass(charAt(lines, cur), big);
    const onLastLine = cur.line === lastLine(lines);

    const advance = (): number => {
      const s = incPos(lines, cur);
      cur = s.pos;
      return s.ret;
    };

    // We always move at least one character, unless at the last char in file.
    let i = advance();
    if (i === -1 || (i >= 1 && onLastLine)) return { pos: cur, failed: true };
    if (i >= 1 && stopAtEol && last) return { pos: cur, failed: false };

    // Go one char past the end of the current word (if any).
    if (sclass !== CHAR_BLANK) {
      while (charClass(charAt(lines, cur), big) === sclass && cur.col < lineAt(lines, cur.line).length) {
        i = advance();
        if (i === -1 || (i >= 1 && onLastLine)) return { pos: cur, failed: true };
        if (i >= 1 && stopAtEol && last) return { pos: cur, failed: false };
      }
    }

    // Skip whitespace to the next word. An empty line is itself a word.
    while (charClass(charAt(lines, cur), big) === CHAR_BLANK || cur.col >= lineAt(lines, cur.line).length) {
      if (cur.col === 0 && lineAt(lines, cur.line).length === 0) break;
      i = advance();
      if (i === -1 || (i >= 1 && onLastLine)) return { pos: cur, failed: true };
      if (i >= 1 && stopAtEol && last) return { pos: cur, failed: false };
    }
  }

  return { pos: cur, failed: false };
}

export function moveWordForward(ctx: MotionContext): MotionResult | null {
  const big = ctx.arg === 'W';
  const walk = fwdWordWalk(ctx.lines, ctx.cursor, big, ctx.count, ctx.operatorPending);

  let { line, col } = walk.pos;
  let inclusive = false;

  // Vim's adjust_cursor: a walk that ended on the end-of-line position is
  // pulled back onto the last real character, and with an operator pending the
  // motion becomes INCLUSIVE — that single rule is the `dw`-at-end-of-line
  // wart: the word is taken, the newline is not.
  const len = lineAt(ctx.lines, line).length;
  if (col >= len && col > 0) {
    col = len - 1;
    if (ctx.operatorPending) inclusive = true;
  }

  return charwise({ line, col: Math.max(0, col) }, inclusive);
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

/**
 * One step of Vim's backward cursor walk (`dec()`). Stepping back from column
 * zero lands on the PREVIOUS LINE'S end-of-line position (`col === length`) —
 * a blank-class position that terminates word runs at line boundaries. Return
 * codes mirror Vim's: 0 = moved within the line, 1 = crossed onto the previous
 * line's end, -1 = start of buffer.
 */
export function decPos(lines: Lines, p: Pos): { readonly pos: Pos; readonly ret: number } {
  if (p.col > 0) return { pos: { line: p.line, col: p.col - 1 }, ret: 0 };
  if (p.line > 0) return { pos: { line: p.line - 1, col: lineAt(lines, p.line - 1).length }, ret: 1 };
  return { pos: p, ret: -1 };
}

/**
 * `ge`/`gE` — a faithful port of Vim's `bckend_word` (search.c). The word
 * class is taken at the ORIGINAL position before stepping (starting on a blank
 * must not strip the word behind it), and the backward walk passes through the
 * end-of-line position so a run never merges across a line boundary. Hitting
 * the start of the buffer fails the whole motion, exactly as Vim beeps.
 */
export function moveWordEndBackward(ctx: MotionContext): MotionResult | null {
  const big = ctx.arg === 'gE';
  let cur = ctx.cursor;

  for (let n = ctx.count; n > 0; n -= 1) {
    const sclass = charClass(charAt(ctx.lines, cur), big);

    let s = decPos(ctx.lines, cur);
    if (s.ret === -1) return null;
    cur = s.pos;

    // Move back to before the end of the current word (if we started in one).
    if (sclass !== CHAR_BLANK) {
      while (charClass(charAt(ctx.lines, cur), big) === sclass && cur.col < lineAt(ctx.lines, cur.line).length) {
        s = decPos(ctx.lines, cur);
        if (s.ret === -1) return null;
        cur = s.pos;
      }
    }

    // Move back to the end of the previous word. An empty line is a word.
    while (charClass(charAt(ctx.lines, cur), big) === CHAR_BLANK || cur.col >= lineAt(ctx.lines, cur.line).length) {
      if (cur.col === 0 && lineAt(ctx.lines, cur.line).length === 0) break;
      s = decPos(ctx.lines, cur);
      if (s.ret === -1) return null;
      cur = s.pos;
    }
  }

  return charwise(cur, true);
}

/** Vim's `incl()` — `inc()` that additionally skips the NUL ending a non-empty line. */
function inclPos(lines: Lines, p: Pos): { readonly pos: Pos; readonly ret: number } {
  const s = incPos(lines, p);
  if (s.ret >= 1 && s.pos.col !== 0) return incPos(lines, s.pos);
  return s;
}

/** Vim's `decl()` — `dec()` that additionally skips the NUL ending a non-empty line. */
function declPos(lines: Lines, p: Pos): { readonly pos: Pos; readonly ret: number } {
  const s = decPos(lines, p);
  if (s.ret === 1 && s.pos.col !== 0) return decPos(lines, s.pos);
  return s;
}

/** Vim's `gchar_pos`: the character at a position, or NUL at an end-of-line. */
function charOrNul(lines: Lines, p: Pos): string {
  return lineAt(lines, p.line)[p.col] ?? '';
}

// --- paragraphs and sentences -----------------------------------------------

/**
 * Vim's `startPS` with `para = NUL`: a paragraph boundary is a genuinely EMPTY
 * line or a line beginning with a form feed. A line of SPACES is not one — `}`
 * walks straight past `"   "`, which is the wart that makes "blank line" the
 * wrong mental model.
 *
 * Vim also honours nroff macros from 'paragraphs'/'sections' here. Those are
 * deliberately not modelled: the option is not implemented, no stage will set
 * it, and pretending to support it would be worse than not.
 */
function isParagraphBoundary(lines: Lines, line: number): boolean {
  const text = lineAt(lines, line);
  return text.length === 0 || text.startsWith('\f');
}

/**
 * `{` and `}` — a port of Vim's `findpar` (search.c).
 *
 * `did_skip` is the mechanism people get wrong: the walk refuses to accept a
 * boundary until it has passed at least one NON-EMPTY line, which is why `}`
 * from inside a run of blank lines jumps clear of the whole run instead of
 * stopping on the next one.
 *
 * Failure is likewise counter-intuitive. Running off the end of the buffer is
 * only a failure while counts REMAIN: a bare `}` at the end of the buffer (and
 * `{` at the start) succeeds and simply does not move, so `d}` there runs over
 * a degenerate region and mints an undo node, while `d2}` aborts and mints
 * nothing. Both measured.
 */
export function moveParagraph(ctx: MotionContext, forward: boolean): MotionResult | null {
  const dir = forward ? 1 : -1;
  const last = lastLine(ctx.lines);
  let curr = ctx.cursor.line;
  let remaining = ctx.count;

  while (remaining > 0) {
    remaining -= 1;
    let didSkip = false;
    for (let first = true; ; first = false) {
      if (lineAt(ctx.lines, curr).length !== 0) didSkip = true;
      if (!first && didSkip && isParagraphBoundary(ctx.lines, curr)) break;

      curr += dir;
      if (curr < 0 || curr > last) {
        // Vim tests the count AFTER decrementing, so this is "counts left".
        if (remaining > 0) return null;
        curr -= dir;
        break;
      }
    }
  }

  // findpar's tail: landing on the LAST line puts the cursor on that line's
  // last character and makes the motion INCLUSIVE, so `d}` at the end of the
  // buffer takes the final character rather than stopping short of it. An
  // empty last line has no character to land on and stays exclusive at
  // column zero.
  //
  // Measured: this applies only going FORWARD. `{` on a one-line buffer also
  // "lands on the last line", and it goes to column zero exclusive — `d{`
  // there deletes back to the start of the line, it does not become inclusive.
  if (forward && curr === last) {
    const len = lineAt(ctx.lines, curr).length;
    if (len !== 0) {
      return charwise({ line: curr, col: len - 1 }, true, { forcesNumbered: true, isJump: true });
    }
  }
  return charwise({ line: curr, col: 0 }, false, { forcesNumbered: true, isJump: true });
}

const SENTENCE_ENDERS = '.!?';
const SENTENCE_CLOSERS = ')]"\'';

/**
 * `(` and `)` — a port of Vim's `findsent` (search.c).
 *
 * A sentence ends at `.`, `!` or `?`, followed by any number of `)]"'`, then a
 * space, tab or end of line. `a.b.c` is therefore one sentence: the dots have
 * no whitespace after them. An empty line is also a sentence boundary, and `)`
 * lands ON it rather than stepping over it.
 *
 * `(` from the middle of a sentence goes to that sentence's own start; from
 * the exact first character it goes to the previous sentence instead. That
 * asymmetry is the whole job of the "walk back over trailing punctuation"
 * loop, and it is why the port is worth having over a regex.
 */
export function moveSentence(ctx: MotionContext, forward: boolean): MotionResult | null {
  const lines = ctx.lines;
  const advance = (p: Pos): { readonly pos: Pos; readonly ret: number } =>
    forward ? inclPos(lines, p) : declPos(lines, p);

  let pos = ctx.cursor;
  let noskip = false;
  let remaining = ctx.count;

  while (remaining > 0) {
    remaining -= 1;
    let found = false;

    if (charOrNul(lines, pos) === '') {
      // On an empty line: skip to a non-empty one. Going forward that IS the
      // answer, so the sentence scan below is skipped entirely.
      for (;;) {
        const s = advance(pos);
        if (s.ret === -1) break;
        pos = s.pos;
        if (charOrNul(lines, pos) !== '') break;
      }
      if (forward) found = true;
    } else if (forward && pos.col === 0 && isParagraphBoundary(lines, pos.line)) {
      if (pos.line >= lastLine(lines)) return null;
      pos = { line: pos.line + 1, col: pos.col };
      found = true;
    } else if (!forward) {
      pos = declPos(lines, pos).pos;
    }

    if (!found) {
      // Walk back over whitespace and trailing sentence punctuation, so a
      // backward search starting just after a full stop does not immediately
      // re-find the sentence it is already in.
      let foundDot = false;
      for (;;) {
        const c = charOrNul(lines, pos);
        if (c !== ' ' && c !== '\t' && !SENTENCE_ENDERS.includes(c) && !(c !== '' && SENTENCE_CLOSERS.includes(c))) {
          break;
        }
        if (c === '') break;

        const back = declPos(lines, pos);
        if (back.ret === -1 || (forward && lineAt(lines, back.pos.line).length === 0)) break;
        if (foundDot) break;
        if (SENTENCE_ENDERS.includes(c)) foundDot = true;
        if (SENTENCE_CLOSERS.includes(c)) {
          const prev = charOrNul(lines, back.pos);
          if (prev === '' || !(SENTENCE_ENDERS + SENTENCE_CLOSERS).includes(prev)) break;
        }
        pos = declPos(lines, pos).pos;
      }

      // Find the end of the sentence.
      const startLine = pos.line;
      for (;;) {
        const c = charOrNul(lines, pos);
        if (c === '' || (pos.col === 0 && isParagraphBoundary(lines, pos.line))) {
          if (!forward && pos.line !== startLine) pos = { line: pos.line + 1, col: pos.col };
          break;
        }

        if (SENTENCE_ENDERS.includes(c)) {
          // Step past the ender and any closing brackets or quotes; whitespace
          // or an end of line after them means this really was a sentence end.
          let tpos = pos;
          let after = '';
          for (;;) {
            const s = incPos(lines, tpos);
            if (s.ret === -1) {
              after = '￿'; // Vim's c == -1: ran out of buffer.
              break;
            }
            tpos = s.pos;
            after = charOrNul(lines, tpos);
            if (!(after !== '' && SENTENCE_CLOSERS.includes(after))) break;
          }
          if (after === '￿' || after === ' ' || after === '\t' || after === '') {
            pos = tpos;
            if (charOrNul(lines, pos) === '') pos = incPos(lines, pos).pos;
            break;
          }
        }

        const s = advance(pos);
        if (s.ret === -1) {
          if (remaining > 0) return null;
          noskip = true;
          break;
        }
        pos = s.pos;
      }
    }

    // Skip whitespace — always FORWARD, whichever way the motion ran.
    while (!noskip) {
      const c = charOrNul(lines, pos);
      if (c !== ' ' && c !== '\t') break;
      const s = inclPos(lines, pos);
      if (s.ret === -1) break;
      pos = s.pos;
    }
  }

  // `nv_brace`'s adjust_cursor: the cursor may not rest on the NUL past the end
  // of a line, so it steps back one and the motion becomes INCLUSIVE — the same
  // rule that makes `dw` on the last word of a line take the word but not the
  // newline.
  if (pos.col > 0 && charOrNul(lines, pos) === '') {
    return charwise({ line: pos.line, col: pos.col - 1 }, true, { forcesNumbered: true, isJump: true });
  }
  return charwise(pos, false, { forcesNumbered: true, isJump: true });
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
      // `%` is on Vim's short list of motions (with `( ) / ? n N { }`) whose
      // deletes always shift into the numbered registers, even within a line.
      if (depth === 0) return charwise({ line, col: c }, true, { forcesNumbered: true, isJump: true });
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
