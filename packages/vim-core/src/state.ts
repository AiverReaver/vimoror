/**
 * The pure reducer: `step(state, key) → { state, events }`.
 *
 * No DOM, no clocks, no randomness, no I/O. That is what makes
 * `replay(initial, keys)` exact, and it is why golden tests, regression tests
 * and ghost replays are all the same mechanism. Everything spooky arrives
 * through the director API in `engine.ts`, never from in here.
 *
 * Waves 1-2: counts, motions, `x X r`, `u <C-r>`, the full operator grammar
 * (`d c y > < gu gU g~` composed with every motion), doubled operators, the
 * `D C Y s S` shortcuts, and insert/replace mode.
 */

import { applyEdit, clamp, comparePos, firstNonBlank, lastLine, lineAt, type Lines } from './buffer.ts';
import * as I from './insert.ts';
import * as M from './motions.ts';
import * as O from './operators.ts';
import * as P from './put.ts';
import { BLACKHOLE, readRegister, recordWrite, UNNAMED } from './registers.ts';
import { canRedo, canUndo, initUndo, pushUndo, redo, undo, type UndoState } from './undo.ts';
import type {
  EngineEvent,
  InvalidReason,
  KeyPolicy,
  KeyToken,
  Mode,
  MotionResult,
  Pos,
  Registers,
  RegisterValue,
} from './types.ts';

/** `$` remembers "end of line" rather than a column, exactly as Vim does. */
export const MAX_COL = 2147483647;

/** What `"_` reads back as for a put: written, and empty. */
const EMPTY_VALUE: RegisterValue = { text: '', type: 'charwise' };

export type Pending = {
  readonly count: string;
  readonly register: string | undefined;
  readonly operator: O.OperatorName | undefined;
  readonly operatorCount: string;
  readonly keyBuffer: readonly KeyToken[];
  readonly awaiting: 'find' | 'replace' | 'register' | 'g' | undefined;
  readonly findCmd: 'f' | 'F' | 't' | 'T' | undefined;
};

export const EMPTY_PENDING: Pending = {
  count: '',
  register: undefined,
  operator: undefined,
  operatorCount: '',
  keyBuffer: [],
  awaiting: undefined,
  findCmd: undefined,
};

export type EditorState = {
  readonly lines: Lines;
  readonly cursor: Pos;
  readonly desiredCol: number;
  readonly mode: Mode;
  readonly registers: Registers;
  readonly undoState: UndoState;
  readonly pending: Pending;
  readonly lastFind: { readonly cmd: 'f' | 'F' | 't' | 'T'; readonly ch: string } | undefined;
  readonly searchPattern: string;
  readonly keyPolicy: KeyPolicy | undefined;
  readonly options: O.EditorOptions;
  readonly insert: I.InsertSession | undefined;
};

export function initState(
  lines: Lines,
  cursor: Pos = { line: 0, col: 0 },
  options: O.EditorOptions = O.DEFAULT_OPTIONS,
): EditorState {
  const start = clamp(lines, cursor, false);
  return {
    lines,
    cursor: start,
    desiredCol: start.col,
    mode: 'normal',
    registers: {},
    undoState: initUndo(lines, start),
    pending: EMPTY_PENDING,
    lastFind: undefined,
    searchPattern: '',
    keyPolicy: undefined,
    options,
    insert: undefined,
  };
}

export type StepResult = {
  readonly state: EditorState;
  readonly events: readonly EngineEvent[];
};

// --- helpers ----------------------------------------------------------------

function reject(state: EditorState, key: KeyToken, reason: InvalidReason): StepResult {
  return { state: { ...state, pending: EMPTY_PENDING }, events: [{ type: 'KeyRejected', key, reason }] };
}

function invalid(state: EditorState, keys: string, reason: InvalidReason): StepResult {
  return { state: { ...state, pending: EMPTY_PENDING }, events: [{ type: 'InvalidCommand', keys, reason }] };
}

function pendingOnly(state: EditorState, pending: Pending): StepResult {
  return { state: { ...state, pending }, events: [] };
}

function withCursor(state: EditorState, to: Pos, desiredCol?: number): StepResult {
  const cursor = clamp(state.lines, to, false);
  return {
    state: { ...state, cursor, desiredCol: desiredCol ?? cursor.col, pending: EMPTY_PENDING },
    events: [{ type: 'CursorMoved', to: cursor }],
  };
}

function countOf(pending: Pending): { count: number; hasCount: boolean } {
  const a = pending.count === '' ? null : Number.parseInt(pending.count, 10);
  const b = pending.operatorCount === '' ? null : Number.parseInt(pending.operatorCount, 10);
  if (a === null && b === null) return { count: 1, hasCount: false };
  return { count: (a ?? 1) * (b ?? 1), hasCount: true };
}

function isPolicyAllowed(policy: KeyPolicy | undefined, key: KeyToken): boolean {
  if (policy === undefined) return true;
  if (policy.denied?.has(key)) return false;
  if (policy.allowed !== undefined && !policy.allowed.has(key)) return false;
  return true;
}

function sameLines(a: Lines, b: Lines): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  return a.every((line, i) => line === b[i]);
}

/**
 * Commit a buffer change and record it as its own undo block. The cursor at
 * commit time is where the change BEGAN — `u` and `<C-r>` return there.
 *
 * A command that RAN mints a node even when the buffer ends up identical:
 * Vim's `u_save()` happens before the work, not after, so `>>` on an empty
 * line, `gUU` on an already-uppercase line and `r` typing the same character
 * all leave an undo step for `u` to burn on. Only a command that FAILS mints
 * nothing, and failure is decided by the caller (a null motion, `~` on an
 * empty line), never by comparing content here.
 */
function commit(
  state: EditorState,
  lines: Lines,
  cursor: Pos,
  registers?: Registers,
  changeStart?: Pos,
): EditorState {
  const clamped = clamp(lines, cursor, false);
  return {
    ...state,
    lines,
    cursor: clamped,
    desiredCol: clamped.col,
    registers: registers ?? state.registers,
    undoState: pushUndo(state.undoState, lines, clamped, changeStart ?? state.cursor),
    pending: EMPTY_PENDING,
  };
}

/** Change the buffer WITHOUT closing an undo block — used inside insert mode. */
function mutate(state: EditorState, lines: Lines, cursor: Pos, allowEol: boolean): EditorState {
  const clamped = clamp(lines, cursor, allowEol);
  return { ...state, lines, cursor: clamped, desiredCol: clamped.col };
}

function bufferChanged(from: number, to: number): EngineEvent {
  return { type: 'BufferChanged', firstLine: from, lastLine: to };
}

/**
 * The honest dirty range of an edit: when the line count changed, every line
 * from the edit down has shifted, so the range runs to the end of the longer
 * buffer — an incremental renderer repainting less shows stale text.
 */
function changedSpan(before: Lines, after: Lines, from: number, to?: number): EngineEvent {
  if (before.length !== after.length) {
    return bufferChanged(from, Math.max(lastLine(before), lastLine(after)));
  }
  return bufferChanged(from, Math.max(from, to ?? from));
}

// --- motion dispatch --------------------------------------------------------

const MOTION_KEYS = new Set([
  'h', 'l', '0', '^', '$', 'j', 'k', 'G', '+', '-', '_',
  'w', 'W', 'b', 'B', 'e', 'E', '%', ';', ',', '<BS>', '<Space>', '<CR>',
]);

const OPERATORS: Record<string, O.OperatorName> = { d: 'd', c: 'c', y: 'y', '>': '>', '<': '<' };

/** The key that doubles an operator into its linewise form: `dd`, `guu`, `>>`. */
function doublingKey(op: O.OperatorName): string {
  if (op === 'gu') return 'u';
  if (op === 'gU') return 'U';
  if (op === 'g~') return '~';
  return op;
}

function motionCtx(state: EditorState, count: number, hasCount: boolean, operatorPending: boolean): M.MotionContext {
  return {
    lines: state.lines,
    cursor: state.cursor,
    count,
    hasCount,
    desiredCol: state.desiredCol,
    operatorPending,
    ...(state.lastFind ? { lastFind: state.lastFind } : {}),
  };
}

function resolveMotion(
  state: EditorState,
  key: KeyToken,
  operatorPending: boolean,
  count: number,
  hasCount: boolean,
): MotionResult | null {
  const ctx = motionCtx(state, count, hasCount, operatorPending);

  switch (key) {
    case 'h':
    case '<BS>':
      return M.moveLeft(ctx);
    case 'l':
    case '<Space>':
      return M.moveRight(ctx);
    case '0':
      return M.moveLineStart(ctx);
    case '^':
      return M.moveFirstNonBlank(ctx);
    case '$':
      return M.moveLineEnd(ctx);
    case 'j':
      return M.moveDown(ctx);
    case 'k':
      return M.moveUp(ctx);
    case 'G':
      return M.moveGotoLine(ctx);
    case '+':
    case '<CR>':
      return M.moveLineDownFirstNonBlank(ctx);
    case '-':
      return M.moveLineUpFirstNonBlank(ctx);
    case '_':
      return M.moveLineFirstNonBlank(ctx);
    case 'w':
      return M.moveWordForward({ ...ctx, arg: 'w' });
    case 'W':
      return M.moveWordForward({ ...ctx, arg: 'W' });
    case 'b':
      return M.moveWordBackward({ ...ctx, arg: 'b' });
    case 'B':
      return M.moveWordBackward({ ...ctx, arg: 'B' });
    case 'e':
      return M.moveWordEnd({ ...ctx, arg: 'e' });
    case 'E':
      return M.moveWordEnd({ ...ctx, arg: 'E' });
    case '%':
      return M.moveMatchingBracket(ctx);
    case ';':
      return M.moveFindRepeat(ctx, false);
    case ',':
      return M.moveFindRepeat(ctx, true);
    default:
      return null;
  }
}

/**
 * `cw` is not `dw`.
 *
 * With the cursor on a word, `cw` and `cW` change only up to the END of that
 * word, leaving the whitespace after it — so they behave like `ce`/`cE` rather
 * than like `dw`. And at the last character of a word there is nothing to
 * extend to, so `cw` changes exactly that character; using `ce` there would
 * wrongly run into the next word.
 */
function changeWordMotion(state: EditorState, big: boolean, count: number): MotionResult | null {
  const ctx = motionCtx(state, count, true, true);
  const cls = M.classAt(state.lines, state.cursor, big);
  if (cls === 0) return M.moveWordForward({ ...ctx, arg: big ? 'W' : 'w' });

  const atWordEnd = M.classAt(state.lines, { ...state.cursor, col: state.cursor.col + 1 }, big) !== cls;
  if (atWordEnd) {
    if (count <= 1) return { target: state.cursor, kind: 'charwise', inclusive: true };
    return M.moveWordEnd({ ...ctx, count: count - 1, arg: big ? 'E' : 'e' });
  }
  return M.moveWordEnd({ ...ctx, arg: big ? 'E' : 'e' });
}

// --- the reducer ------------------------------------------------------------

export function step(state: EditorState, key: KeyToken): StepResult {
  if (!isPolicyAllowed(state.keyPolicy, key)) return reject(state, key, 'key-locked');
  if (state.mode === 'insert' || state.mode === 'replace') return stepInsert(state, key);
  if (state.mode === 'normal' || state.mode === 'operator-pending') return stepNormal(state, key);
  return reject(state, key, 'not-in-mode');
}

function stepNormal(state: EditorState, key: KeyToken): StepResult {
  const p = state.pending;
  const keys = [...p.keyBuffer, key];
  const bump = (patch: Partial<Pending>): Pending => ({ ...p, ...patch, keyBuffer: keys });
  const opPending = p.operator !== undefined;

  // --- awaiting a character argument ---------------------------------------

  if (p.awaiting === 'register') {
    if (!/^[a-zA-Z0-9"_\-]$/.test(key)) return invalid(state, keys.join(''), 'unknown-key');
    return pendingOnly(state, bump({ register: key, awaiting: undefined }));
  }

  if (p.awaiting === 'find') {
    if (key.length !== 1) return invalid(state, keys.join(''), 'unknown-key');
    const cmd = p.findCmd!;
    const { count, hasCount } = countOf(p);
    const r = M.moveFind(motionCtx(state, count, hasCount, opPending), cmd, key);
    const remembered: EditorState = { ...state, lastFind: { cmd, ch: key } };
    if (r === null) return invalid(remembered, keys.join(''), 'motion-failed');
    if (opPending) return applyOperator(remembered, p.operator!, r, keys.join(''));
    return withCursor(remembered, r.target);
  }

  if (p.awaiting === 'replace') {
    if (key === '<Esc>') return { state: { ...state, pending: EMPTY_PENDING }, events: [] };
    if (key.length !== 1) return invalid(state, keys.join(''), 'unknown-key');
    return doReplaceChar(state, key, countOf(p).count);
  }

  if (p.awaiting === 'g') {
    const { count, hasCount } = countOf(p);
    switch (key) {
      case 'g': {
        const r = M.moveGotoFirstLine(motionCtx(state, count, hasCount, opPending));
        if (opPending) return applyOperator(state, p.operator!, r, keys.join(''));
        return withCursor(state, r.target);
      }
      case 'e':
      case 'E': {
        const r = M.moveWordEndBackward({
          ...motionCtx(state, count, hasCount, opPending),
          arg: key === 'E' ? 'gE' : 'ge',
        });
        if (r === null) return invalid(state, keys.join(''), 'motion-failed');
        if (opPending) return applyOperator(state, p.operator!, r, keys.join(''));
        return withCursor(state, r.target);
      }
      case 'u':
      case 'U':
      case '~': {
        const op: O.OperatorName = key === 'u' ? 'gu' : key === 'U' ? 'gU' : 'g~';
        // `gugu` is the long form of `guu`.
        if (p.operator === op) return applyLinewise(state, op, count, keys.join(''));
        if (opPending) return invalid(state, keys.join(''), 'no-such-motion');
        return pendingOnly(state, bump({ operator: op, awaiting: undefined }));
      }
      default:
        return invalid(state, keys.join(''), 'no-such-motion');
    }
  }

  // --- prefixes -------------------------------------------------------------

  // `0` is a motion, not a count digit, unless a count is already building.
  const countBuf = opPending ? p.operatorCount : p.count;
  if (/^[1-9]$/.test(key) || (key === '0' && countBuf !== '')) {
    return pendingOnly(state, bump(opPending ? { operatorCount: countBuf + key } : { count: countBuf + key }));
  }

  if (key === '"') return pendingOnly(state, bump({ awaiting: 'register' }));
  if (key === 'g') return pendingOnly(state, bump({ awaiting: 'g' }));

  if (key === '<Esc>') return { state: { ...state, pending: EMPTY_PENDING }, events: [] };

  const { count, hasCount } = countOf(p);

  if (key === 'f' || key === 'F' || key === 't' || key === 'T') {
    return pendingOnly(state, bump({ awaiting: 'find', findCmd: key }));
  }

  // --- operators ------------------------------------------------------------

  if (opPending && key === doublingKey(p.operator!)) {
    return applyLinewise(state, p.operator!, count, keys.join(''));
  }

  const asOperator = OPERATORS[key];
  if (asOperator !== undefined && !opPending) {
    return pendingOnly(state, bump({ operator: asOperator }));
  }

  // --- motions --------------------------------------------------------------

  if (MOTION_KEYS.has(key)) {
    // The `cw` special case has to be decided before the motion runs.
    const motion =
      opPending && p.operator === 'c' && (key === 'w' || key === 'W')
        ? changeWordMotion(state, key === 'W', count)
        : resolveMotion(state, key, opPending, count, hasCount);

    if (motion === null) return invalid(state, keys.join(''), 'motion-failed');
    if (opPending) return applyOperator(state, p.operator!, motion, keys.join(''));

    const desired = key === '$' ? MAX_COL : undefined;
    const keep = motion.keepDesiredCol === true ? state.desiredCol : desired;
    return withCursor(state, motion.target, keep);
  }

  // Anything below is a complete command, so an operator still pending means
  // the user typed something that is not a motion at all.
  if (opPending) return invalid(state, keys.join(''), 'no-such-motion');

  // --- shortcuts and simple commands ---------------------------------------

  switch (key) {
    case 'x':
      return doDeleteChars(state, count, false);
    case 'X':
      return doDeleteChars(state, count, true);
    case 'r':
      return pendingOnly(state, bump({ awaiting: 'replace' }));
    case '~':
      return doTilde(state, count);
    case 'u':
      return doUndo(state);
    case '<C-r>':
      return doRedo(state);
    case 'p':
      return doPut(state, count, true);
    case 'P':
      return doPut(state, count, false);

    // Sugar, revealed to the player only after the grammar lands.
    case 'D':
      return applyOperator(state, 'd', M.moveLineEnd(motionCtx(state, count, hasCount, true)), 'D');
    case 'C':
      return applyOperator(state, 'c', M.moveLineEnd(motionCtx(state, count, hasCount, true)), 'C');
    case 'Y':
      // `Y` is `yy`, NOT `y$` — a genuine Vim inconsistency.
      return applyLinewise(state, 'y', count, 'Y');
    case 's':
      // `s` is literally `cl`, sharing even the empty-line behavior.
      return applyOperator(state, 'c', M.moveRight(motionCtx(state, count, hasCount, true)), 's');
    case 'S':
      return applyLinewise(state, 'c', count, 'S');

    // Insert-mode entry.
    case 'i':
      return enterInsert(state, { at: state.cursor, count, changeStart: state.cursor });
    case 'a': {
      const at = { ...state.cursor, col: state.cursor.col + 1 };
      return enterInsert(state, { at, count, changeStart: at });
    }
    case 'I': {
      // `I` inserts before the first non-blank; on an all-blank line that is
      // the end of the line, one past where `^` could ever sit.
      const text = lineAt(state.lines, state.cursor.line);
      const m = /\S/.exec(text);
      const at = { line: state.cursor.line, col: m ? m.index : text.length };
      return enterInsert(state, { at, count, changeStart: at });
    }
    case 'A': {
      const at = { line: state.cursor.line, col: lineAt(state.lines, state.cursor.line).length };
      return enterInsert(state, { at, count, changeStart: at });
    }
    case 'o':
    case 'O': {
      const where = key === 'o' ? 'below' : 'above';
      const opened = I.openLine(state.lines, state.cursor, where);
      const next = mutate(state, opened.lines, opened.cursor, true);
      // The undoable change begins where the command was typed, on the OLD
      // line — undoing `o` lands there, not on the vanished line.
      const entered = enterInsert(next, {
        at: opened.cursor,
        count,
        openLine: where,
        changeStart: state.cursor,
      });
      return {
        state: entered.state,
        events: [changedSpan(state.lines, opened.lines, opened.cursor.line), ...entered.events],
      };
    }
    case 'R':
      return enterInsert(state, { at: state.cursor, count, replace: true, changeStart: state.cursor });

    default:
      return reject(state, key, 'unknown-key');
  }
}

// --- operator application ---------------------------------------------------

function applyOperator(
  state: EditorState,
  op: O.OperatorName,
  motion: MotionResult | null,
  keys: string,
): StepResult {
  if (motion === null) return invalid(state, keys, 'motion-failed');
  const range = O.operatorRange(state.lines, state.cursor, motion);
  // Where the operated text starts, as a position — several operators put the
  // cursor exactly here rather than on a first-non-blank.
  const opStart = comparePos(motion.target, state.cursor) < 0 ? motion.target : state.cursor;
  return runOperator(state, op, range, opStart, motion.forcesNumbered === true);
}

/**
 * Doubled operators (`dd`, `3>>`, `gUU`). Vim runs these as the operator over
 * a synthetic count-1-lines-down motion, and that mechanism leaks observably:
 * the down-move fails only from the LAST line (elsewhere an overshooting
 * count clamps), and for everything except yank it lands on the target line's
 * first non-blank — which is where the cursor and the undo entry end up.
 */
function applyLinewise(state: EditorState, op: O.OperatorName, count: number, keys: string): StepResult {
  if (count > 1 && state.cursor.line >= lastLine(state.lines)) {
    return invalid(state, keys, 'motion-failed');
  }
  const landed = Math.min(state.cursor.line + count - 1, lastLine(state.lines));
  const target: Pos = {
    line: landed,
    col: op === 'y' ? state.cursor.col : firstNonBlank(state.lines, landed),
  };
  const opStart = comparePos(target, state.cursor) < 0 ? target : state.cursor;
  const range: O.OperatorRange = { kind: 'linewise', firstLine: state.cursor.line, lastLine: landed };
  return runOperator(state, op, range, opStart, false);
}

function runOperator(
  state: EditorState,
  op: O.OperatorName,
  range: O.OperatorRange,
  opStart: Pos,
  forcesNumbered: boolean,
): StepResult {
  const explicit = state.pending.register;
  const firstLine = range.kind === 'linewise' ? range.firstLine : range.start.line;
  const lastRangeLine = range.kind === 'linewise' ? range.lastLine : range.end.line;

  // A charwise motion that could not move at all (`l` on an empty line, `h` at
  // column one) produces a DEGENERATE region — Vim's `oap->empty`. Such a
  // region is not an error under the default 'cpoptions', so the operator still
  // runs: a change enters insert mode (this is why `cl` and `s` work on an
  // empty line) and a delete mints an undo node, but neither touches a
  // register. That is distinct from a real region holding zero characters (`$`
  // on an empty line), which DOES write registers for `c` and `y`.
  const degenerate = range.kind === 'charwise' && comparePos(range.start, range.end) >= 0;
  if (degenerate && op === 'c') {
    return enterInsert(state, { at: range.start, count: 1, fromChange: true, changeStart: state.cursor });
  }
  if (degenerate && op === 'd') {
    // `op_delete`'s first act: `if (oap->empty) return u_save_cursor()`. Buffer
    // and registers untouched, but `u` now has a step to burn on.
    return { state: commit(state, state.lines, state.cursor, undefined, opStart), events: [] };
  }

  if (op === '>' || op === '<') {
    const r = O.applyIndent(state.lines, op, range, state.options);
    return {
      state: commit(state, r.lines, r.cursor, undefined, opStart),
      events: [bufferChanged(firstLine, lastRangeLine)],
    };
  }

  if (op === 'gu' || op === 'gU' || op === 'g~') {
    const r = O.applyCase(state.lines, op, range, opStart);
    return {
      state: commit(state, r.lines, r.cursor, undefined, opStart),
      events: [bufferChanged(firstLine, lastRangeLine)],
    };
  }

  if (op === 'y') {
    // A yank ALWAYS writes its registers, even over zero characters — `yl` on
    // an empty line really does clear the unnamed register in Vim.
    const r = O.applyYank(state.lines, range);
    const registers = recordWrite(state.registers, {
      explicit,
      isYank: true,
      type: r.captured!.type,
      text: r.captured!.text,
      multiline: r.captured!.multiline,
    });
    // A yank moves the cursor to the start of the yanked text only when the
    // motion ran backward — and a LINEWISE yank only counts crossing lines as
    // backward, which is why `y_` stays put while `ygg` jumps.
    const moved =
      range.kind === 'charwise'
        ? comparePos(opStart, state.cursor) < 0
        : opStart.line < state.cursor.line;
    const cursor = clamp(state.lines, moved ? opStart : state.cursor, false);
    return {
      state: { ...state, cursor, desiredCol: cursor.col, registers, pending: EMPTY_PENDING },
      events: [{ type: 'RegisterChanged', name: explicit ?? '"' }],
    };
  }

  const r =
    op === 'd' ? O.applyDelete(state.lines, range) : O.applyChange(state.lines, range, state.options);

  // A real but zero-character delete region — `D`/`d$` on an empty line, where
  // `$` is inclusive so the region is not `oap->empty` — runs the full delete
  // path, removes nothing, and leaves buffer, registers AND undo history
  // untouched. The degenerate case above is the one that mints a node.
  if (op === 'd' && r.captured!.text === '') {
    return { state: { ...state, pending: EMPTY_PENDING }, events: [] };
  }

  const registers = recordWrite(state.registers, {
    explicit,
    isYank: false,
    type: r.captured!.type,
    text: r.captured!.text,
    multiline: r.captured!.multiline,
    forcesNumbered,
  });

  if (op === 'c') {
    // The delete half of a change must NOT close an undo block — the whole
    // change-plus-typing is one `u`, beginning where the operated text starts.
    const next = mutate({ ...state, registers, pending: EMPTY_PENDING }, r.lines, r.cursor, true);
    const entered = enterInsert(next, { at: r.cursor, count: 1, fromChange: true, changeStart: opStart });
    return {
      state: entered.state,
      events: [
        changedSpan(state.lines, r.lines, firstLine, lastRangeLine),
        ...entered.events,
        { type: 'RegisterChanged', name: explicit ?? '"' },
      ],
    };
  }

  return {
    state: commit(state, r.lines, r.cursor, registers, opStart),
    events: [
      changedSpan(state.lines, r.lines, firstLine, lastRangeLine),
      { type: 'RegisterChanged', name: explicit ?? '"' },
    ],
  };
}

// --- insert mode ------------------------------------------------------------

type EnterInsert = {
  readonly at: Pos;
  readonly count: number;
  /** `o`/`O` repeat by opening more lines rather than by repeating inline. */
  readonly openLine?: 'below' | 'above';
  readonly replace?: boolean;
  /**
   * True when a change operator opened this session. Vim's `op_change` has
   * already prepared an undo entry by then, so even a session that types
   * nothing commits one — `cl<Esc>` on an empty line mints a node while a bare
   * `i<Esc>` mints none.
   */
  readonly fromChange?: boolean;
  /** Where the whole change began, for the undo entry (Vim's `uh_cursor`). */
  readonly changeStart: Pos;
};

function enterInsert(state: EditorState, opts: EnterInsert): StepResult {
  const cursor = clamp(state.lines, opts.at, true);
  const replace = opts.replace === true;
  const mode: Mode = replace ? 'replace' : 'insert';
  return {
    state: {
      ...state,
      cursor,
      desiredCol: cursor.col,
      mode,
      pending: EMPTY_PENDING,
      insert: {
        replace,
        count: opts.count,
        keys: [],
        openLine: opts.openLine,
        fromChange: opts.fromChange === true,
        start: cursor,
        changeStart: clamp(state.lines, opts.changeStart, true),
        replaced: [],
      },
    },
    events: [{ type: 'ModeChanged', from: state.mode, to: mode }],
  };
}

type InsertKeyResult = {
  readonly lines: Lines;
  readonly cursor: Pos;
  readonly session: I.InsertSession;
};

/**
 * Apply one key inside an insert/replace session. Pure over its inputs, so
 * the live path (stepInsert) and the count-repeat replay (finishInsert) run
 * the SAME code — a counted insert repeats raw keystrokes, exactly as Vim's
 * redo does. Returns null for keys that contribute nothing.
 */
function insertKey(
  lines: Lines,
  cursor: Pos,
  session: I.InsertSession,
  options: O.EditorOptions,
  key: KeyToken,
): InsertKeyResult | null {
  if (key === '<BS>') {
    if (session.replace) return replaceBackspace(lines, cursor, session);
    const r = I.backspace(lines, cursor);
    if (r === null) return { lines, cursor, session };
    return { lines: r.lines, cursor: r.cursor, session };
  }

  const literal = I.insertLiteral(key, cursor, options);
  if (literal === null) return null;

  if (session.replace && literal !== '\n') {
    const r = I.overwriteText(lines, cursor, literal);
    // One record per written column: the destroyed character first, then
    // null for every column the line merely grew by.
    const record: (string | null)[] = [...r.destroyed];
    while (record.length < literal.length) record.push(null);
    return { lines: r.lines, cursor: r.cursor, session: { ...session, replaced: [...session.replaced, ...record] } };
  }

  const r = I.insertText(lines, cursor, literal);
  // A line break in replace mode is INSERTED, not overwritten; its record is
  // the '\n' marker that tells `<BS>` to rejoin rather than restore.
  const replaced = session.replace ? [...session.replaced, ...literal.split('').map(() => '\n')] : session.replaced;
  return { lines: r.lines, cursor: r.cursor, session: { ...session, replaced } };
}

/**
 * Replace mode `<BS>`: put the ORIGINAL character back rather than deleting;
 * delete where the line was merely extended; rejoin where a line break was
 * inserted. Before the session's own edits, it only steps left.
 */
function replaceBackspace(lines: Lines, cursor: Pos, session: I.InsertSession): InsertKeyResult {
  if (session.replaced.length === 0) {
    if (cursor.col === 0) return { lines, cursor, session };
    return { lines, cursor: { line: cursor.line, col: cursor.col - 1 }, session };
  }

  const original = session.replaced[session.replaced.length - 1]!;
  const popped: I.InsertSession = { ...session, replaced: session.replaced.slice(0, -1) };

  if (original === '\n') {
    // Undo the inserted line break: rejoin this line onto the previous one.
    if (cursor.line === 0) return { lines, cursor, session: popped };
    const prevLen = lineAt(lines, cursor.line - 1).length;
    const next = applyEdit(lines, {
      start: { line: cursor.line - 1, col: prevLen },
      end: { line: cursor.line, col: 0 },
      text: '',
    });
    return { lines: next, cursor: { line: cursor.line - 1, col: prevLen }, session: popped };
  }

  const col = cursor.col - 1;
  const next = applyEdit(lines, {
    start: { line: cursor.line, col },
    end: { line: cursor.line, col: col + 1 },
    // null marks a column the session appended past the old end of line —
    // there is nothing to restore, so the character is simply removed.
    text: original ?? '',
  });
  return { lines: next, cursor: { line: cursor.line, col }, session: popped };
}

function stepInsert(state: EditorState, key: KeyToken): StepResult {
  const session = state.insert;
  if (session === undefined) return reject(state, key, 'not-in-mode');

  if (key === '<Esc>') return finishInsert(state, session);

  const out = insertKey(state.lines, state.cursor, session, state.options, key);
  if (out === null) return reject(state, key, 'unknown-key');

  return {
    state: {
      ...mutate(state, out.lines, out.cursor, true),
      insert: { ...out.session, keys: [...session.keys, key] },
    },
    events: [changedSpan(state.lines, out.lines, Math.min(state.cursor.line, out.cursor.line))],
  };
}

function finishInsert(state: EditorState, session: I.InsertSession): StepResult {
  let lines: Lines = state.lines;
  let cursor = state.cursor;

  // `3ix<Esc>` types "x" three times; `2ofoo<Esc>` opens two lines. Each
  // repeat replays the session's raw keystrokes through insertKey.
  for (let i = 1; i < session.count; i += 1) {
    if (session.openLine !== undefined) {
      const opened = I.openLine(lines, cursor, 'below');
      lines = opened.lines;
      cursor = opened.cursor;
    }
    let replay: I.InsertSession = { ...session, replaced: [], keys: [] };
    for (const key of session.keys) {
      const out = insertKey(lines, cursor, replay, state.options, key);
      if (out === null) continue;
      lines = out.lines;
      cursor = out.cursor;
      replay = out.session;
    }
  }

  // Leaving insert mode steps the cursor left — the classic off-by-one.
  const landed = clamp(lines, { line: cursor.line, col: Math.max(0, cursor.col - 1) }, false);

  // A session that changed nothing (`i<Esc>`, `R<Esc>`) must NOT mint an undo
  // node, or Esc-mashing would silently eat the player's real undo steps. The
  // baseline is the last committed state, so the delete half of a `cw` still
  // counts. A session a CHANGE operator opened always commits: `op_change` has
  // already prepared the undo entry, which is why `cl<Esc>` on an empty line
  // leaves a step for `u` to burn on while `i<Esc>` does not.
  const base = state.undoState.nodes.get(state.undoState.current)?.lines;
  const changed = base === undefined || !sameLines(lines, base);
  const mintsUndo = changed || session.fromChange;

  return {
    state: {
      ...state,
      lines,
      cursor: landed,
      desiredCol: landed.col,
      mode: 'normal',
      insert: undefined,
      pending: EMPTY_PENDING,
      undoState: mintsUndo ? pushUndo(state.undoState, lines, landed, session.changeStart) : state.undoState,
    },
    events: [{ type: 'ModeChanged', from: state.mode, to: 'normal' }, bufferChanged(0, lastLine(lines))],
  };
}

// --- simple commands --------------------------------------------------------

function doDeleteChars(state: EditorState, count: number, before: boolean): StepResult {
  const { line, col } = state.cursor;
  const text = lineAt(state.lines, line);
  if (text.length === 0) return invalid(state, before ? 'X' : 'x', 'motion-failed');

  const start = before ? Math.max(0, col - count) : col;
  const end = before ? col : Math.min(text.length, col + count);
  if (start === end) return invalid(state, before ? 'X' : 'x', 'motion-failed');

  const removed = text.slice(start, end);
  const lines = applyEdit(state.lines, { start: { line, col: start }, end: { line, col: end }, text: '' });
  const registers = recordWrite(state.registers, {
    explicit: state.pending.register,
    isYank: false,
    type: 'charwise',
    text: removed,
    multiline: false,
  });

  return {
    state: commit(state, lines, { line, col: start }, registers),
    events: [bufferChanged(line, line), { type: 'RegisterChanged', name: state.pending.register ?? '"' }],
  };
}

function doReplaceChar(state: EditorState, ch: string, count: number): StepResult {
  const { line, col } = state.cursor;
  const text = lineAt(state.lines, line);
  // `r` fails outright if there are not `count` characters left — never a
  // partial replace.
  if (col + count > text.length) return invalid(state, `r${ch}`, 'motion-failed');

  const lines = applyEdit(state.lines, {
    start: { line, col },
    end: { line, col: col + count },
    text: ch.repeat(count),
  });
  return { state: commit(state, lines, { line, col: col + count - 1 }), events: [bufferChanged(line, line)] };
}

function doTilde(state: EditorState, count: number): StepResult {
  // `~` on an empty line beeps — there is no character to toggle.
  if (lineAt(state.lines, state.cursor.line).length === 0) return invalid(state, '~', 'motion-failed');
  const r = O.applyTilde(state.lines, state.cursor, count);
  return { state: commit(state, r.lines, r.cursor), events: [bufferChanged(state.cursor.line, state.cursor.line)] };
}

/**
 * `p` / `P`. The register's TYPE decides the shape of the put, not the key.
 *
 * Three states of a register, and Vim distinguishes all three:
 *
 *  - UNSET (never written) — raises E353 "Nothing in register" and puts nothing.
 *  - WRITTEN BUT EMPTY (`yl` over an empty region, or anything via `"_`) — a
 *    perfectly successful put of zero characters, reported as nothing at all.
 *  - holding text — the ordinary case. A register holding one empty LINE is in
 *    this group, not the previous one: its text is `"\n"`, and putting it really
 *    does open a blank line.
 *
 * A put ALWAYS mints an undo node, measured with `undotree().seq_cur` — Vim's
 * `u_save` runs before `do_put` looks the register up, so even the E353 path
 * leaves a node for `u` to burn on. That refines the Wave 2 rule rather than
 * contradicting it: what matters is not "ran versus failed" but whether the
 * command reached its `u_save` before bailing out. `~` on an empty line beeps in
 * `nv_tilde` BEFORE any save and so mints nothing; `p` from an unset register
 * bails inside `do_put`, AFTER the save, and so mints one.
 */
function doPut(state: EditorState, count: number, forward: boolean): StepResult {
  const keys = forward ? 'p' : 'P';
  const name = state.pending.register ?? UNNAMED;
  // `readRegister` returns nothing for `"_` because the black hole genuinely
  // never reads back — but for a PUT that reads as written-but-empty, not as
  // unset, so `"_p` is a silent no-op rather than an E353.
  const value = name === BLACKHOLE ? EMPTY_VALUE : readRegister(state.registers, name);

  // The undo node is minted either way; only the reported event differs, so the
  // game layer can still reject an unset register in fiction.
  if (value === undefined || value.text === '') {
    const committed = commit(state, state.lines, state.cursor, undefined, state.cursor);
    if (value !== undefined) return { state: committed, events: [] };
    return {
      state: committed,
      events: [{ type: 'InvalidCommand', keys: `"${name}${keys}`, reason: 'empty-register' }],
    };
  }

  const r = P.applyPut(state.lines, state.cursor, value, forward, count);
  return {
    state: commit(state, r.lines, r.cursor, undefined, state.cursor),
    events: [changedSpan(state.lines, r.lines, r.firstLine)],
  };
}

function doUndo(state: EditorState): StepResult {
  if (!canUndo(state.undoState)) return invalid(state, 'u', 'nothing-to-undo');
  const stepped = undo(state.undoState);
  if (stepped === null) return invalid(state, 'u', 'nothing-to-undo');
  const cursor = clamp(stepped.lines, stepped.cursor, false);
  return {
    state: {
      ...state,
      lines: stepped.lines,
      cursor,
      desiredCol: cursor.col,
      undoState: stepped.undo,
      pending: EMPTY_PENDING,
    },
    events: [bufferChanged(0, lastLine(stepped.lines))],
  };
}

function doRedo(state: EditorState): StepResult {
  if (!canRedo(state.undoState)) return invalid(state, '<C-r>', 'nothing-to-redo');
  const stepped = redo(state.undoState);
  if (stepped === null) return invalid(state, '<C-r>', 'nothing-to-redo');
  const cursor = clamp(stepped.lines, stepped.cursor, false);
  return {
    state: {
      ...state,
      lines: stepped.lines,
      cursor,
      desiredCol: cursor.col,
      undoState: stepped.undo,
      pending: EMPTY_PENDING,
    },
    events: [bufferChanged(0, lastLine(stepped.lines))],
  };
}

/** Replay a whole key sequence. Exact, because `step` is pure. */
export function replay(initial: EditorState, keys: readonly KeyToken[]): EditorState {
  let s = initial;
  for (const k of keys) s = step(s, k).state;
  return s;
}
