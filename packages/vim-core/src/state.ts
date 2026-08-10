/**
 * The pure reducer: `step(state, key) → { state, events }`.
 *
 * No DOM, no clocks, no randomness, no I/O. That is what makes
 * `replay(initial, keys)` exact, and it is why golden tests, regression tests
 * and ghost replays are all the same mechanism. Everything spooky arrives
 * through the director API in `engine.ts`, never from in here.
 *
 * Wave 1 scope: counts, motions, `x X r`, `u <C-r>`. Operators arrive in Wave 2;
 * the parser is already shaped to accept them.
 */

import { applyEdit, clamp, lineAt, lastLine, type Lines } from './buffer.ts';
import * as M from './motions.ts';
import { recordWrite } from './registers.ts';
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
} from './types.ts';

/** `$` remembers "end of line" rather than a column, exactly as Vim does. */
export const MAX_COL = 2147483647;

export type Pending = {
  readonly count: string;
  readonly register: string | undefined;
  readonly operator: string | undefined;
  readonly operatorCount: string;
  readonly keyBuffer: readonly KeyToken[];
  /** A key that needs one more character before it means anything. */
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
};

export function initState(lines: Lines, cursor: Pos = { line: 0, col: 0 }): EditorState {
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
  };
}

export type StepResult = {
  readonly state: EditorState;
  readonly events: readonly EngineEvent[];
};

// --- helpers ----------------------------------------------------------------

function reject(state: EditorState, key: KeyToken, reason: InvalidReason): StepResult {
  return {
    state: { ...state, pending: EMPTY_PENDING },
    events: [{ type: 'KeyRejected', key, reason }],
  };
}

function invalid(state: EditorState, keys: string, reason: InvalidReason): StepResult {
  return {
    state: { ...state, pending: EMPTY_PENDING },
    events: [{ type: 'InvalidCommand', keys, reason }],
  };
}

function pendingOnly(state: EditorState, pending: Pending): StepResult {
  return { state: { ...state, pending }, events: [] };
}

function withCursor(state: EditorState, to: Pos, desiredCol?: number): StepResult {
  const cursor = clamp(state.lines, to, false);
  return {
    state: {
      ...state,
      cursor,
      desiredCol: desiredCol ?? cursor.col,
      pending: EMPTY_PENDING,
    },
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

function commit(state: EditorState, lines: Lines, cursor: Pos, registers?: Registers): EditorState {
  const clamped = clamp(lines, cursor, false);
  return {
    ...state,
    lines,
    cursor: clamped,
    desiredCol: clamped.col,
    registers: registers ?? state.registers,
    undoState: pushUndo(state.undoState, lines, clamped),
    pending: EMPTY_PENDING,
  };
}

// --- motion dispatch --------------------------------------------------------

type MotionOutcome = { readonly result: MotionResult; readonly state: EditorState } | null;

/**
 * Resolve a motion key. Returns null when the key is not a motion at all, and
 * `{ result: ... }` with a null-ish target when it is a motion that failed —
 * the two cases mean different things to an operator and to the hint system.
 */
function resolveMotion(state: EditorState, key: KeyToken, operatorPending: boolean): MotionOutcome {
  const { count, hasCount } = countOf(state.pending);
  const ctx: M.MotionContext = {
    lines: state.lines,
    cursor: state.cursor,
    count,
    hasCount,
    desiredCol: state.desiredCol,
    operatorPending,
    ...(state.lastFind ? { lastFind: state.lastFind } : {}),
  };

  const simple = (r: MotionResult | null): MotionOutcome => (r === null ? null : { result: r, state });

  switch (key) {
    case 'h':
    case '<BS>':
      return simple(M.moveLeft(ctx));
    case 'l':
    case '<Space>':
      return simple(M.moveRight(ctx));
    case '0':
      return simple(M.moveLineStart(ctx));
    case '^':
      return simple(M.moveFirstNonBlank(ctx));
    case '$':
      return simple(M.moveLineEnd(ctx));
    case 'j':
      return simple(M.moveDown(ctx));
    case 'k':
      return simple(M.moveUp(ctx));
    case 'G':
      return simple(M.moveGotoLine(ctx));
    case '+':
    case '<CR>':
      return simple(M.moveLineDownFirstNonBlank(ctx));
    case '-':
      return simple(M.moveLineUpFirstNonBlank(ctx));
    case '_':
      return simple(M.moveLineFirstNonBlank(ctx));
    case 'w':
      return simple(M.moveWordForward({ ...ctx, arg: 'w' }));
    case 'W':
      return simple(M.moveWordForward({ ...ctx, arg: 'W' }));
    case 'b':
      return simple(M.moveWordBackward({ ...ctx, arg: 'b' }));
    case 'B':
      return simple(M.moveWordBackward({ ...ctx, arg: 'B' }));
    case 'e':
      return simple(M.moveWordEnd({ ...ctx, arg: 'e' }));
    case 'E':
      return simple(M.moveWordEnd({ ...ctx, arg: 'E' }));
    case '%':
      return simple(M.moveMatchingBracket(ctx));
    case ';':
      return simple(M.moveFindRepeat(ctx, false));
    case ',':
      return simple(M.moveFindRepeat(ctx, true));
    default:
      return null;
  }
}

const MOTION_KEYS = new Set([
  'h', 'l', '0', '^', '$', 'j', 'k', 'G', '+', '-', '_',
  'w', 'W', 'b', 'B', 'e', 'E', '%', ';', ',', '<BS>', '<Space>', '<CR>',
]);

// --- the reducer ------------------------------------------------------------

export function step(state: EditorState, key: KeyToken): StepResult {
  if (!isPolicyAllowed(state.keyPolicy, key)) {
    return reject(state, key, 'key-locked');
  }

  if (state.mode === 'normal') return stepNormal(state, key);
  // Later waves add insert, visual, operator-pending and command-line.
  return reject(state, key, 'not-in-mode');
}

function stepNormal(state: EditorState, key: KeyToken): StepResult {
  const p = state.pending;
  const keys = [...p.keyBuffer, key];
  const bump = (patch: Partial<Pending>): Pending => ({ ...p, ...patch, keyBuffer: keys });

  // --- awaiting a character argument ---------------------------------------

  if (p.awaiting === 'register') {
    if (!/^[a-zA-Z0-9"_\-]$/.test(key)) return invalid(state, keys.join(''), 'unknown-key');
    return pendingOnly(state, bump({ register: key, awaiting: undefined }));
  }

  if (p.awaiting === 'find') {
    if (key.length !== 1) return invalid(state, keys.join(''), 'unknown-key');
    const cmd = p.findCmd!;
    const { count, hasCount } = countOf(p);
    const r = M.moveFind(
      {
        lines: state.lines,
        cursor: state.cursor,
        count,
        hasCount,
        desiredCol: state.desiredCol,
        operatorPending: false,
      },
      cmd,
      key,
    );
    // The find is remembered for `;`/`,` even when it fails, matching Vim.
    const remembered: EditorState = { ...state, lastFind: { cmd, ch: key } };
    if (r === null) return invalid(remembered, keys.join(''), 'motion-failed');
    return withCursor(remembered, r.target);
  }

  if (p.awaiting === 'replace') {
    if (key === '<Esc>') return { state: { ...state, pending: EMPTY_PENDING }, events: [] };
    if (key.length !== 1) return invalid(state, keys.join(''), 'unknown-key');
    return doReplaceChar(state, key, countOf(p).count);
  }

  if (p.awaiting === 'g') {
    switch (key) {
      case 'g': {
        const { count, hasCount } = countOf(p);
        const r = M.moveGotoFirstLine({
          lines: state.lines,
          cursor: state.cursor,
          count,
          hasCount,
          desiredCol: state.desiredCol,
          operatorPending: false,
        });
        return withCursor(state, r.target);
      }
      case 'e':
      case 'E': {
        const { count, hasCount } = countOf(p);
        const r = M.moveWordEndBackward({
          lines: state.lines,
          cursor: state.cursor,
          count,
          hasCount,
          desiredCol: state.desiredCol,
          operatorPending: false,
          arg: key === 'E' ? 'gE' : 'ge',
        });
        if (r === null) return invalid(state, keys.join(''), 'motion-failed');
        return withCursor(state, r.target);
      }
      default:
        return invalid(state, keys.join(''), 'no-such-motion');
    }
  }

  // --- prefixes -------------------------------------------------------------

  // `0` is a motion, not a count digit, unless a count is already building.
  if (/^[1-9]$/.test(key) || (key === '0' && p.count !== '')) {
    return pendingOnly(state, bump({ count: p.count + key }));
  }

  if (key === '"') return pendingOnly(state, bump({ awaiting: 'register' }));
  if (key === 'g') return pendingOnly(state, bump({ awaiting: 'g' }));

  if (key === 'f' || key === 'F' || key === 't' || key === 'T') {
    return pendingOnly(state, bump({ awaiting: 'find', findCmd: key }));
  }

  if (key === 'r') return pendingOnly(state, bump({ awaiting: 'replace' }));

  if (key === '<Esc>') {
    // Escape always cancels a half-typed command without touching the buffer.
    return { state: { ...state, pending: EMPTY_PENDING }, events: [] };
  }

  // --- motions --------------------------------------------------------------

  if (MOTION_KEYS.has(key)) {
    const outcome = resolveMotion(state, key, false);
    if (outcome === null) return invalid(state, keys.join(''), 'motion-failed');
    const { result } = outcome;
    // `$` remembers end-of-line rather than a column, so a following `j`
    // stays at the end of each line however long it is.
    const desired = key === '$' ? MAX_COL : undefined;
    const keep = result.keepDesiredCol === true ? state.desiredCol : desired;
    return withCursor(state, result.target, keep);
  }

  // --- simple commands ------------------------------------------------------

  switch (key) {
    case 'x':
      return doDeleteChars(state, countOf(p).count, false);
    case 'X':
      return doDeleteChars(state, countOf(p).count, true);
    case 'u':
      return doUndo(state);
    case '<C-r>':
      return doRedo(state);
    default:
      return reject(state, key, 'unknown-key');
  }
}

// --- commands ---------------------------------------------------------------

function doDeleteChars(state: EditorState, count: number, before: boolean): StepResult {
  const { line, col } = state.cursor;
  const text = lineAt(state.lines, line);
  if (text.length === 0) return invalid(state, before ? 'X' : 'x', 'motion-failed');

  const start = before ? Math.max(0, col - count) : col;
  const end = before ? col : Math.min(text.length, col + count);
  if (start === end) return invalid(state, before ? 'X' : 'x', 'motion-failed');

  const removed = text.slice(start, end);
  const lines = applyEdit(state.lines, {
    start: { line, col: start },
    end: { line, col: end },
    text: '',
  });
  const registers = recordWrite(state.registers, {
    explicit: state.pending.register,
    isYank: false,
    type: 'charwise',
    text: removed,
    multiline: false,
  });

  return {
    state: commit(state, lines, { line, col: start }, registers),
    events: [
      { type: 'BufferChanged', firstLine: line, lastLine: line },
      { type: 'RegisterChanged', name: state.pending.register ?? '"' },
    ],
  };
}

function doReplaceChar(state: EditorState, ch: string, count: number): StepResult {
  const { line, col } = state.cursor;
  const text = lineAt(state.lines, line);
  // `r` fails outright if there are not `count` characters left — it never
  // does a partial replace.
  if (col + count > text.length) return invalid(state, `r${ch}`, 'motion-failed');

  const lines = applyEdit(state.lines, {
    start: { line, col },
    end: { line, col: col + count },
    text: ch.repeat(count),
  });

  return {
    state: commit(state, lines, { line, col: col + count - 1 }),
    events: [{ type: 'BufferChanged', firstLine: line, lastLine: line }],
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
    events: [{ type: 'BufferChanged', firstLine: 0, lastLine: lastLine(stepped.lines) }],
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
    events: [{ type: 'BufferChanged', firstLine: 0, lastLine: lastLine(stepped.lines) }],
  };
}

/** Replay a whole key sequence. Exact, because `step` is pure. */
export function replay(initial: EditorState, keys: readonly KeyToken[]): EditorState {
  let s = initial;
  for (const k of keys) s = step(s, k).state;
  return s;
}
