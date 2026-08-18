/**
 * Text objects: `iw aw iW aW i" a" i' a' i( a( i[ a[ i{ a{ i< a< it at ip ap`.
 *
 * A text object is not a motion. A motion says "go there" and the operator
 * infers a region from the cursor; an object names the region outright. So these
 * return an `OperatorRange` directly rather than a `MotionResult`, and `end` is
 * EXCLUSIVE, matching what `operatorRange()` produces for motions.
 *
 * `range: null` means the object could not be found (`di(` with no brackets),
 * which aborts the operator. A found-but-EMPTY object (`di(` on `()`) is a
 * different thing entirely: a degenerate region, which runs the operator over
 * nothing — that is why `ci(` on `()` still enters insert mode.
 *
 * `abortCursor` is set for an `iw`/`aw` whose word-walk runs off the end of the
 * buffer — measured against real Vim: the whole command aborts (same as any
 * other not-found object) but the cursor still lands wherever the internal walk
 * got to before giving up, rather than staying put. Every other object kind
 * leaves it unset, which keeps the ordinary "aborted command doesn't move the
 * cursor" behavior.
 *
 * Wave 4g set this for the COUNTED overshoot only, and the fuzz triage of
 * 2026-08-18 found the uncounted first walk had the same rule and was missing
 * it: `yaW` on a whitespace-only line aborts in both, and real Vim leaves the
 * cursor on the line's last character while this engine left it at column zero.
 * See `wordObject`.
 */

import {
  CHAR_BLANK,
  charAt,
  charClass,
  comparePos,
  lastLine,
  lineAt,
  nextPos,
  prevPos,
  type Lines,
} from './buffer.ts';
import { decPos, fwdWordWalk, incPos } from './motions.ts';
import type { OperatorRange } from './operators.ts';
import type { Pos } from './types.ts';

/** The object keys, after alias folding. `w`/`W` are words, `p` paragraphs, `t` tags. */
export type ObjectKind = 'i' | 'a';

/**
 * Vim's bracket aliases: `b` is `(`, `B` is `{`, and either half of a pair names
 * the pair. `i)` and `i(` are the same object.
 */
const BRACKETS: Record<string, readonly [string, string]> = {
  '(': ['(', ')'], ')': ['(', ')'], b: ['(', ')'],
  '[': ['[', ']'], ']': ['[', ']'],
  '{': ['{', '}'], '}': ['{', '}'], B: ['{', '}'],
  '<': ['<', '>'], '>': ['<', '>'],
};

export type ObjectResult = { readonly range: OperatorRange } | { readonly range: null; readonly abortCursor?: Pos };

const notFound: ObjectResult = { range: null };

/** The last position a normal-mode cursor can occupy — where a failed forward walk stops. */
function lastBufferPos(lines: Lines): Pos {
  const line = lastLine(lines);
  return { line, col: Math.max(0, lineAt(lines, line).length - 1) };
}

export function textObject(lines: Lines, cursor: Pos, kind: ObjectKind, obj: string, count: number): ObjectResult {
  const include = kind === 'a';

  if (obj === 'w' || obj === 'W') return wordObject(lines, cursor, include, obj === 'W', count);
  if (obj === '"' || obj === "'" || obj === '`') {
    const r = quoteObject(lines, cursor, obj, include);
    return r === null ? notFound : { range: r };
  }
  if (obj === 'p') return { range: paragraphObject(lines, cursor, include) };
  if (obj === 't') {
    const r = tagObject(lines, cursor, include, count);
    return r === null ? notFound : { range: r };
  }

  const pair = BRACKETS[obj];
  if (pair !== undefined) {
    const r = blockObject(lines, cursor, pair[0], pair[1], include, count);
    return r === null ? notFound : { range: r };
  }

  return notFound;
}

/** A charwise range from an inclusive last position, which is what objects name. */
function inclusiveRange(lines: Lines, start: Pos, lastInside: Pos): OperatorRange {
  return { kind: 'charwise', start, end: { line: lastInside.line, col: lastInside.col + 1 } };
}

/** A region holding nothing, at `at` — Vim's `oap->empty`. */
function degenerate(at: Pos): OperatorRange {
  return { kind: 'charwise', start: at, end: at };
}

// --- words ------------------------------------------------------------------

/** Back up within the line while the previous character has the same class. */
function backInLine(lines: Lines, p: Pos, big: boolean): Pos {
  const text = lineAt(lines, p.line);
  const cls = charClass(text[p.col], big);
  let col = p.col;
  while (col > 0 && charClass(text[col - 1], big) === cls) col -= 1;
  return { line: p.line, col };
}

/**
 * Vim's `end_word`, including the `stop` argument that `current_word` passes and
 * that `e` does not. With `stop`, a cursor already inside a run ends at THAT
 * run's end instead of running on to the next word's — which is the whole reason
 * `diw` on the `.` of `foo.bar` takes one character and not `.bar`.
 */
function endWord(lines: Lines, from: Pos, big: boolean, stop: boolean): Pos | null {
  let cur = from;
  const sclass = charClass(charAt(lines, cur), big);

  /** Vim's `skip_chars`: advance while the class holds; FAIL at end of buffer. */
  const skip = (cls: number): boolean => {
    while (charClass(charAt(lines, cur), big) === cls) {
      const s = incPos(lines, cur);
      if (s.ret === -1) return false;
      cur = s.pos;
    }
    return true;
  };

  const first = incPos(lines, cur);
  if (first.ret === -1) return null;
  cur = first.pos;

  if (charClass(charAt(lines, cur), big) === sclass && sclass !== CHAR_BLANK) {
    if (!skip(sclass)) return null;
  } else if (!stop || sclass === CHAR_BLANK) {
    if (!skip(CHAR_BLANK)) return null;
    if (!skip(charClass(charAt(lines, cur), big))) return null;
  }

  // Vim overshoots by one and steps back — a plain `dec_cursor`, not `decl`.
  const back = decPos(lines, cur);
  return back.ret === -1 ? cur : back.pos;
}

/**
 * Vim's `decl`: `dec`, and when that crossed onto the previous line it steps
 * once more to skip the NUL the cursor would otherwise sit on. This is what
 * makes `iw` on an empty LAST line reach back to the previous line's last
 * character rather than to its end-of-line position.
 */
function decl(lines: Lines, p: Pos): Pos {
  const d = decPos(lines, p);
  if (d.ret === -1) return p;
  if (d.ret === 1 && d.pos.col > 0) return { line: d.pos.line, col: d.pos.col - 1 };
  return d.pos;
}

/**
 * The other half of `current_word`: run `fwd_word` and step back off it. Vim
 * ignores whether `fwd_word` succeeded and just looks at where it stopped —
 * landing in column zero means a line was crossed, so it uses `decl` to come
 * back to the end of the previous line rather than `oneleft` within this one.
 */
function beforeNextWord(lines: Lines, from: Pos, big: boolean): Pos {
  const walk = fwdWordWalk(lines, from, big, 1, true);
  const at = walk.pos;
  if (at.col === 0) return decl(lines, at);
  return { line: at.line, col: at.col - 1 };
}

/**
 * `iw` / `aw`. The branch that decides everything is Vim's `(cls() == 0) ==
 * include`, and it explains all four combinations at once:
 *
 *  - `iw` on a word  → end of that word
 *  - `iw` on blanks  → end of that blank run
 *  - `aw` on a word  → end of the word's TRAILING blanks
 *  - `aw` on blanks  → end of the FOLLOWING word
 *
 * And the fixup: `aw` that found no trailing whitespace takes LEADING
 * whitespace instead, which is why `daw` on the last word of a line eats the
 * space before it rather than the line break after it.
 */
function wordObject(lines: Lines, cursor: Pos, include: boolean, big: boolean, count: number): ObjectResult {
  const startCls = charClass(charAt(lines, cursor), big);
  const start = backInLine(lines, cursor, big);

  const extend = (from: Pos): Pos | null => {
    const cls = charClass(charAt(lines, from), big);
    if ((cls === CHAR_BLANK) === include) return endWord(lines, from, big, true);
    return beforeNextWord(lines, from, big);
  };

  let end = extend(cursor);
  // The FIRST walk can fail too, not just a counted one, and it takes the same
  // cursor rule — found by fuzz triage, minimized to a single atom: `yaW` on
  // `['   ']` aborts, and real Vim lands the cursor on column 2 while this
  // returned a bare `null` and left it at column 0. `aw`/`aW` on blanks walks
  // forward looking for a word, so a buffer with no word left anywhere fails,
  // while `iw`/`iW` succeed on the blank run itself and never reach this.
  //
  // `extend` can only fail by running off the END of the buffer:
  // `beforeNextWord` returns a `Pos` unconditionally, and `endWord` returns null
  // exactly when `incPos` reports `-1`, which happens only at the last position.
  // So "wherever the walk got to" IS the buffer's last position — measured over
  // `['   ']`, `['     ']`, `['ab  ']` and `['   ', '   ']`, whose landings are
  // 0:2, 0:4, 0:3 and 1:2 respectively.
  if (end === null) return { range: null, abortCursor: lastBufferPos(lines) };

  // A count that runs off the end of the buffer before it is satisfied fails
  // the WHOLE object, exactly like `di(` with no enclosing bracket — measured
  // against real Vim with a scratch probe run over an increasing count (`diw`
  // through `9diw` on a short two-line buffer): each count up to what the
  // buffer can actually satisfy deletes progressively more, but the moment
  // the count overshoots, the buffer comes back completely untouched, not
  // clamped to the largest count that did fit. Found by fuzzing — clamping
  // here silently deleted the entire rest of the buffer for a count nobody
  // meant literally. The cursor, however, still lands wherever the failed
  // walk got to (same probe) rather than staying put — `abortCursor` carries
  // that back to the caller instead of a plain `{ range: null }`.
  for (let n = 1; n < count; n += 1) {
    const next = nextPos(lines, end);
    if (next === null) return { range: null, abortCursor: end };
    const further = extend(next);
    if (further === null) return { range: null, abortCursor: next };
    end = further;
  }

  // `aw` starting on a word and finding no trailing blanks takes leading ones.
  let from = start;
  if (include && startCls !== CHAR_BLANK) {
    const text = lineAt(lines, end.line);
    const tookTrailing = end.line !== cursor.line || charClass(text[end.col], big) === CHAR_BLANK;
    if (!tookTrailing) {
      const own = lineAt(lines, start.line);
      let col = start.col;
      while (col > 0 && charClass(own[col - 1], big) === CHAR_BLANK) col -= 1;
      from = { line: start.line, col };
    }
  }

  // The walk can end up BEFORE where it started — `iw` on an empty LAST line
  // reaches back onto the previous line. The region is then that span, and it is
  // `op_delete`'s own promotion that turns it into whole lines for `d`.
  if (comparePos(end, from) < 0) return { range: inclusiveRange(lines, end, from) };

  // On an empty line in the MIDDLE of a buffer the walk cannot move, and
  // `inclusiveRange` names a span whose end is past the (zero-length) line. That
  // is deliberate: it is a REAL region holding zero characters, not a degenerate
  // one — exactly the distinction Wave 2 drew between `D` on an empty line and
  // `dl` there. So `yiw` writes an empty register while `diw` mints no undo node.
  return { range: inclusiveRange(lines, from, end) };
}

// --- quotes -----------------------------------------------------------------

/**
 * `i"` / `a"`, and the single-quote and backtick twins. Quoted objects never
 * leave the cursor's line, a backslash escapes the quote after it, and a cursor
 * that is not inside a pair uses the next pair on the line — so `di"` from
 * column one of `say "hi"` still finds the string.
 */
function quoteObject(lines: Lines, cursor: Pos, quote: string, include: boolean): OperatorRange | null {
  const text = lineAt(lines, cursor.line);

  const quotes: number[] = [];
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '\\') {
      i += 1;
      continue;
    }
    if (text[i] === quote) quotes.push(i);
  }

  // Quotes are CHAINED, not paired off disjointly: the candidates are every
  // consecutive pair, so in `"one" x "two"` the span between the two strings is
  // itself a quoted object and `di"` from the `x` deletes ` x `. Stepping by two
  // instead looks far more sensible and disagrees with Vim. The same loop also
  // covers a cursor sitting before every quote on the line, which is why `di"`
  // from column one of `say "hi"` still finds the string.
  for (let k = 0; k + 1 < quotes.length; k += 1) {
    const open = quotes[k]!;
    const close = quotes[k + 1]!;
    if (cursor.col > close) continue;

    if (!include) {
      if (open + 1 === close) return degenerate({ line: cursor.line, col: open + 1 });
      return {
        kind: 'charwise',
        start: { line: cursor.line, col: open + 1 },
        end: { line: cursor.line, col: close },
      };
    }

    // `a"` takes the quotes plus TRAILING whitespace, or leading whitespace when
    // there is no trailing whitespace to take.
    let end = close + 1;
    while (end < text.length && (text[end] === ' ' || text[end] === '\t')) end += 1;
    let from = open;
    if (end === close + 1) {
      while (from > 0 && (text[from - 1] === ' ' || text[from - 1] === '\t')) from -= 1;
    }
    return {
      kind: 'charwise',
      start: { line: cursor.line, col: from },
      end: { line: cursor.line, col: end },
    };
  }

  return null;
}

// --- bracket blocks ---------------------------------------------------------

/** Backward to the `open` that encloses `from`, or `from` itself if it is one. */
function enclosingOpen(lines: Lines, from: Pos, open: string, close: string): Pos | null {
  if (charAt(lines, from) === open) return from;
  let depth = 0;
  let cur: Pos | null = from;
  while ((cur = prevPos(lines, cur)) !== null) {
    const ch = charAt(lines, cur);
    if (ch === close) depth += 1;
    else if (ch === open) {
      if (depth === 0) return cur;
      depth -= 1;
    }
  }
  return null;
}

/**
 * When the cursor encloses no block, Vim's `findmatch` still finds one AHEAD of
 * it — so `di(` with the cursor on the `f` of `fn(a, b)` really does delete the
 * arguments even though the cursor is outside the parentheses. `:h ib` says the
 * cursor must be inside the block; the code disagrees, and the search is not
 * even bounded to the cursor's line.
 */
function openAhead(lines: Lines, from: Pos, open: string): Pos | null {
  for (let line = from.line; line <= lastLine(lines); line += 1) {
    const col = lineAt(lines, line).indexOf(open, line === from.line ? from.col : 0);
    if (col !== -1) return { line, col };
  }
  return null;
}

/** Forward to the `close` matching an `open` at `openPos`. */
function matchingClose(lines: Lines, openPos: Pos, open: string, close: string): Pos | null {
  let depth = 0;
  let cur: Pos | null = openPos;
  while ((cur = nextPos(lines, cur)) !== null) {
    const ch = charAt(lines, cur);
    if (ch === open) depth += 1;
    else if (ch === close) {
      if (depth === 0) return cur;
      depth -= 1;
    }
  }
  return null;
}

/** True when only blanks precede `col` on that line. */
function blankBefore(lines: Lines, p: Pos): boolean {
  return /^[ \t]*$/.test(lineAt(lines, p.line).slice(0, p.col));
}

function blockObject(
  lines: Lines,
  cursor: Pos,
  open: string,
  close: string,
  include: boolean,
  count: number,
): OperatorRange | null {
  let openPos = enclosingOpen(lines, cursor, open, close) ?? openAhead(lines, cursor, open);
  if (openPos === null) return null;

  // A count walks OUTWARD a level at a time: `2di(` takes the pair enclosing
  // the one the cursor is in.
  for (let n = 1; n < count; n += 1) {
    const before = prevPos(lines, openPos);
    if (before === null) return null;
    const outer = enclosingOpen(lines, before, open, close);
    if (outer === null) return null;
    openPos = outer;
  }

  const closePos = matchingClose(lines, openPos, open, close);
  if (closePos === null) return null;

  if (include) return inclusiveRange(lines, openPos, closePos);

  // The position just after the open bracket, which for a bracket at end of line
  // is column zero of the NEXT line — `di{` on adjacent braces lands there.
  const innerStart = nextPos(lines, openPos);
  if (innerStart === null) return degenerate({ line: openPos.line, col: openPos.col + 1 });
  if (comparePos(innerStart, closePos) >= 0) return degenerate(innerStart);

  // The inner block is LINEWISE when the braces sit on their own lines: the open
  // is the last character of its line and only blanks precede the close. This is
  // why `di{` on a `{` / body / `}` shape removes the body LINE, leaving the
  // braces, and why `yi{` there yields a linewise register.
  const openIsLastOnLine = openPos.col === lineAt(lines, openPos.line).length - 1;
  if (openIsLastOnLine && blankBefore(lines, closePos) && closePos.line > openPos.line + 1) {
    return { kind: 'linewise', firstLine: openPos.line + 1, lastLine: closePos.line - 1 };
  }

  const lastInside = prevPos(lines, closePos);
  if (lastInside === null) return degenerate(innerStart);
  return inclusiveRange(lines, innerStart, lastInside);
}

// --- paragraphs -------------------------------------------------------------

/** Vim's `linewhite`: a paragraph separator is a line of nothing but blanks. */
function isBlankLine(lines: Lines, line: number): boolean {
  return /^[ \t]*$/.test(lineAt(lines, line));
}

/**
 * `ip` / `ap`. A paragraph object is always linewise. `ip` is the run of lines
 * matching the cursor line's kind — all blank, or all non-blank — so it is a
 * real object on a run of blank lines too. `ap` adds the run that FOLLOWS, or
 * the run before it when the cursor's run ends the buffer.
 */
function paragraphObject(lines: Lines, cursor: Pos, include: boolean): OperatorRange {
  const blank = isBlankLine(lines, cursor.line);

  let first = cursor.line;
  while (first > 0 && isBlankLine(lines, first - 1) === blank) first -= 1;
  let last = cursor.line;
  while (last < lastLine(lines) && isBlankLine(lines, last + 1) === blank) last += 1;

  if (include) {
    if (last < lastLine(lines)) {
      const nextKind = isBlankLine(lines, last + 1);
      while (last < lastLine(lines) && isBlankLine(lines, last + 1) === nextKind) last += 1;
    } else if (first > 0) {
      const prevKind = isBlankLine(lines, first - 1);
      while (first > 0 && isBlankLine(lines, first - 1) === prevKind) first -= 1;
    }
  }

  return { kind: 'linewise', firstLine: first, lastLine: last };
}

// --- tags -------------------------------------------------------------------

const TAG = /<(\/?)([A-Za-z_][-A-Za-z0-9_:.]*)([^>]*?)(\/?)>/g;

/**
 * `it` / `at`. Tags nest and span lines, so this walks the buffer as one flat
 * string and keeps a stack of open tags; the object is the INNERMOST matched
 * pair containing the cursor. A count walks outward from there.
 */
function tagObject(lines: Lines, cursor: Pos, include: boolean, count: number): OperatorRange | null {
  const text = lines.join('\n');
  const offsets: number[] = [];
  let acc = 0;
  for (const line of lines) {
    offsets.push(acc);
    acc += line.length + 1;
  }
  const flatOf = (p: Pos): number => (offsets[p.line] ?? 0) + p.col;
  const posOf = (i: number): Pos => {
    let line = 0;
    while (line + 1 < offsets.length && offsets[line + 1]! <= i) line += 1;
    return { line, col: i - offsets[line]! };
  };

  type Pair = { openStart: number; openEnd: number; closeStart: number; closeEnd: number };
  const pairs: Pair[] = [];
  const stack: { name: string; start: number; end: number }[] = [];

  TAG.lastIndex = 0;
  for (let m = TAG.exec(text); m !== null; m = TAG.exec(text)) {
    const [whole, slash, name, , selfClose] = m;
    const start = m.index;
    const end = start + whole.length;
    if (selfClose === '/') continue;
    if (slash === '/') {
      for (let i = stack.length - 1; i >= 0; i -= 1) {
        if (stack[i]!.name === name) {
          const openTag = stack[i]!;
          stack.length = i;
          pairs.push({ openStart: openTag.start, openEnd: openTag.end, closeStart: start, closeEnd: end });
          break;
        }
      }
    } else {
      stack.push({ name: name!, start, end });
    }
  }

  const at = flatOf(cursor);
  // Innermost first: the smallest span containing the cursor.
  const containing = pairs
    .filter((p) => p.openStart <= at && at < p.closeEnd)
    .sort((a, b) => a.closeEnd - a.openStart - (b.closeEnd - b.openStart));

  const pair = containing[count - 1];
  if (pair === undefined) return null;

  if (include) {
    return { kind: 'charwise', start: posOf(pair.openStart), end: posOf(pair.closeEnd) };
  }
  if (pair.openEnd === pair.closeStart) return degenerate(posOf(pair.openEnd));
  return { kind: 'charwise', start: posOf(pair.openEnd), end: posOf(pair.closeStart) };
}
