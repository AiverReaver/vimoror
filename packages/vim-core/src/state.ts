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
import * as D from './dot.ts';
import * as I from './insert.ts';
import * as K from './marks.ts';
import * as M from './motions.ts';
import * as O from './operators.ts';
import * as P from './put.ts';
import { BLACKHOLE, readRegister, recordWrite, UNNAMED } from './registers.ts';
import * as T from './textobjects.ts';
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
  /**
   * The same keys as `keyBuffer` but with COUNT digits omitted — this is what
   * `.` records, so that a count typed on the `.` can replace the original
   * outright rather than being concatenated with it.
   */
  readonly dotKeys: readonly KeyToken[];
  readonly awaiting:
    | 'find'
    | 'replace'
    | 'register'
    | 'g'
    | 'textobject'
    /** `m` — waiting for the letter to record. */
    | 'mark'
    /** `` ` `` — waiting for the letter to jump to, exactly. */
    | 'mark-exact'
    /** `'` — waiting for the letter to jump to, linewise. */
    | 'mark-line'
    | undefined;
  readonly findCmd: 'f' | 'F' | 't' | 'T' | undefined;
  /** `i` or `a`, while waiting for the object character in `di(`, `caw`. */
  readonly textObjectKind: T.ObjectKind | undefined;
};

export const EMPTY_PENDING: Pending = {
  count: '',
  register: undefined,
  operator: undefined,
  operatorCount: '',
  keyBuffer: [],
  dotKeys: [],
  awaiting: undefined,
  findCmd: undefined,
  textObjectKind: undefined,
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
  /**
   * The fixed end of a visual selection — Vim's `VIsual`. The other end is the
   * cursor, which is why every motion works in visual mode for free.
   */
  readonly visualStart: Pos | undefined;
  /**
   * The selection `gv` restores. Recorded on every exit from visual mode,
   * whether by `<Esc>` or by running an operator, which is why `gv` works
   * equally well after `y` as after a cancelled selection.
   */
  readonly lastVisual: { readonly mode: Mode; readonly start: Pos; readonly end: Pos } | undefined;
  /** The last change, for `.`. */
  readonly dot: D.DotRecord | undefined;
  /**
   * The command half of a record whose insert session has not closed yet. `.`
   * cannot repeat a half-finished change, so this is deliberately separate
   * from `dot` until `<Esc>` arrives.
   */
  readonly dotPending: Omit<D.DotRecord, 'insertKeys'> | undefined;
  /** True while `.` is feeding recorded keys, so the replay records nothing. */
  readonly replaying: boolean;
  readonly marks: K.Marks;
  readonly jumps: K.JumpList;
  /**
   * Vim's `w_pcmark` — the previous-context mark that `` `` `` and `''` return
   * to. Every jump command overwrites it, which is why it is separate from the
   * jumplist index: `<C-o>` walks the list without disturbing this.
   */
  readonly pcmark: Pos | undefined;
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
    visualStart: undefined,
    lastVisual: undefined,
    dot: undefined,
    dotPending: undefined,
    replaying: false,
    marks: {},
    jumps: K.EMPTY_JUMPS,
    pcmark: undefined,
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
    ...withShiftedMarks(state, lines),
    lines,
    cursor: clamped,
    desiredCol: clamped.col,
    registers: registers ?? state.registers,
    undoState: pushUndo(state.undoState, lines, clamped, changeStart ?? state.cursor),
    pending: EMPTY_PENDING,
  };
}

/**
 * Move every stored position to keep up with an edit that added or removed
 * lines. Marks on a deleted line are destroyed; jumplist entries there clamp
 * instead. An edit that leaves the line count alone moves nothing at all.
 */
function withShiftedMarks(state: EditorState, lines: Lines): EditorState {
  const shift = K.lineShift(state.lines, lines);
  if (shift === null) return state;
  return {
    ...state,
    marks: K.adjustMarks(state.marks, shift),
    jumps: K.adjustJumps(state.jumps, shift),
    pcmark: state.pcmark === undefined ? undefined : K.adjustPos(state.pcmark, shift),
  };
}

/**
 * Change the buffer WITHOUT closing an undo block — used inside insert mode.
 *
 * Marks shift here too, not only at `commit`. `o`/`O` open their line through
 * this path long before `<Esc>` arrives, so a shift deferred to `finishInsert`
 * would compare two buffers that already both contain the new line and
 * conclude nothing had moved.
 */
function mutate(state: EditorState, lines: Lines, cursor: Pos, allowEol: boolean): EditorState {
  const clamped = clamp(lines, cursor, allowEol);
  return { ...withShiftedMarks(state, lines), lines, cursor: clamped, desiredCol: clamped.col };
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
  '{', '}', '(', ')',
]);

const OPERATORS: Record<string, O.OperatorName> = { d: 'd', c: 'c', y: 'y', '>': '>', '<': '<' };

/** The key that doubles an operator into its linewise form: `dd`, `guu`, `>>`. */
function doublingKey(op: O.OperatorName): string {
  if (op === 'gu') return 'u';
  if (op === 'gU') return 'U';
  if (op === 'g~') return '~';
  return op;
}

function motionCtx(
  state: EditorState,
  count: number,
  hasCount: boolean,
  operatorPending: boolean,
  oneMore = false,
): M.MotionContext {
  return {
    lines: state.lines,
    cursor: state.cursor,
    count,
    hasCount,
    desiredCol: state.desiredCol,
    operatorPending,
    oneMore,
    ...(state.lastFind ? { lastFind: state.lastFind } : {}),
  };
}

function resolveMotion(
  state: EditorState,
  key: KeyToken,
  operatorPending: boolean,
  count: number,
  hasCount: boolean,
  oneMore = false,
): MotionResult | null {
  const ctx = motionCtx(state, count, hasCount, operatorPending, oneMore);

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
    case '{':
      return M.moveParagraph(ctx, false);
    case '}':
      return M.moveParagraph(ctx, true);
    case '(':
      return M.moveSentence(ctx, false);
    case ')':
      return M.moveSentence(ctx, true);
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
  const result = dispatch(state, key);
  // The `.` record is maintained OUTSIDE the reducer proper: it watches what a
  // key did rather than asking each command to declare itself, so no future
  // command can be added and silently forget to be repeatable.
  if (state.replaying) return result;
  return { ...result, state: recordChange(state, key, result.state) };
}

function dispatch(state: EditorState, key: KeyToken): StepResult {
  if (state.mode === 'insert' || state.mode === 'replace') return stepInsert(state, key);
  if (isVisual(state.mode)) return stepVisual(state, key);
  if (state.mode === 'normal' || state.mode === 'operator-pending') return stepNormal(state, key);
  return reject(state, key, 'not-in-mode');
}

/** Keys that change the buffer but are emphatically NOT changes to repeat. */
const NEVER_RECORDED = new Set<KeyToken>(['u', '<C-r>', '.']);

/** The selection's shape, captured before the operator consumed it. */
function shapeOfSelection(before: EditorState): D.VisualShape {
  const anchor = before.visualStart ?? before.cursor;
  const backwards = comparePos(before.cursor, anchor) < 0;
  const from = backwards ? before.cursor : anchor;
  const to = backwards ? anchor : before.cursor;
  return {
    mode: before.mode,
    lines: to.line - from.line,
    cols: Math.abs(to.col - from.col) + 1,
    endCol: to.col,
  };
}

/**
 * Decide whether the key just fed completed a change, and if so record it.
 *
 * The three cases are genuinely different and collapsing them loses `.`:
 *  - a command that OPENED insert mode is only half a change; its record waits
 *    in `dotPending` until `<Esc>` supplies the typed half;
 *  - a command that CLOSED insert mode completes that record;
 *  - anything else is a change exactly when it altered the buffer.
 */
function recordChange(before: EditorState, key: KeyToken, after: EditorState): EditorState {
  const wasInsert = before.mode === 'insert' || before.mode === 'replace';
  const nowInsert = after.mode === 'insert' || after.mode === 'replace';

  if (wasInsert && nowInsert) return after;

  if (wasInsert && !nowInsert) {
    const pending = before.dotPending;
    if (pending === undefined) return after;
    // The insert half IS raw-key replay — `<BS>` included, exactly as Vim's
    // redo buffer replays it.
    return { ...after, dot: { ...pending, insertKeys: [...(before.insert?.keys ?? []), key] }, dotPending: undefined };
  }

  const visual = isVisual(before.mode) ? shapeOfSelection(before) : undefined;
  const keys = [...before.pending.dotKeys, key];
  const { count } = countOf(before.pending);
  const typedCount = before.pending.count !== '' || before.pending.operatorCount !== '' ? count : 0;

  if (!wasInsert && nowInsert) {
    return { ...after, dotPending: { keys, count: typedCount, visual } };
  }

  if (NEVER_RECORDED.has(key)) return after;
  // A change is a change exactly when the buffer moved. A yank leaves it
  // alone, which is why `x yw .` still repeats the `x`.
  if (before.lines === after.lines) return after;
  return { ...after, dot: { keys, count: typedCount, insertKeys: [], visual } };
}

function stepNormal(state: EditorState, key: KeyToken): StepResult {
  const p = state.pending;
  const keys = [...p.keyBuffer, key];
  const bump = (patch: Partial<Pending>): Pending => ({
    ...p,
    ...patch,
    keyBuffer: keys,
    dotKeys: [...p.dotKeys, key],
  });
  /** Same, but for a key consumed as a COUNT digit — `.` records those apart. */
  const bumpCount = (patch: Partial<Pending>): Pending => ({
    ...p,
    ...patch,
    keyBuffer: keys,
    dotKeys: p.dotKeys,
  });
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

  if (p.awaiting === 'textobject') {
    if (key === '<Esc>') return { state: { ...state, pending: EMPTY_PENDING }, events: [] };
    if (key.length !== 1) return invalid(state, keys.join(''), 'unknown-key');
    const range = T.textObject(state.lines, state.cursor, p.textObjectKind!, key, countOf(p).count);
    // Not FOUND (`di(` with no brackets) aborts the operator and mints nothing.
    // Found-but-EMPTY (`di(` on `()`) is a degenerate region, which still runs.
    if (range === null) return invalid(state, keys.join(''), 'no-such-motion');
    // An object names its region outright, so the operated text starts at the
    // region's own start — column ZERO for a linewise object, which is why
    // `yip` lands on column one while `yy` keeps the column it had.
    return runOperator(state, p.operator!, range, O.rangeStart(range), { fromObject: true });
  }

  if (p.awaiting === 'replace') {
    if (key === '<Esc>') return { state: { ...state, pending: EMPTY_PENDING }, events: [] };
    if (key.length !== 1) return invalid(state, keys.join(''), 'unknown-key');
    return doReplaceChar(state, key, countOf(p).count);
  }

  if (p.awaiting === 'mark') {
    if (!K.isMarkName(key)) return invalid(state, keys.join(''), 'unknown-key');
    // Setting a mark is not a jump and not a change: no undo node, no
    // jumplist entry, nothing but the recorded position.
    return {
      state: { ...state, marks: { ...state.marks, [key]: state.cursor }, pending: EMPTY_PENDING },
      events: [],
    };
  }

  if (p.awaiting === 'mark-exact' || p.awaiting === 'mark-line') {
    return doMarkJump(state, key, p.awaiting === 'mark-line', keys.join(''));
  }

  if (p.awaiting === 'g') {
    const { count, hasCount } = countOf(p);
    switch (key) {
      case 'g': {
        const r = M.moveGotoFirstLine(motionCtx(state, count, hasCount, opPending));
        const jumped = recordJump(state);
        if (opPending) return applyOperator(jumped, p.operator!, r, keys.join(''));
        return withCursor(jumped, r.target);
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
      case 'v':
        if (opPending) return invalid(state, keys.join(''), 'no-such-motion');
        return reselect(state, undefined);
      default:
        return invalid(state, keys.join(''), 'no-such-motion');
    }
  }

  // --- prefixes -------------------------------------------------------------

  // `0` is a motion, not a count digit, unless a count is already building.
  const countBuf = opPending ? p.operatorCount : p.count;
  if (/^[1-9]$/.test(key) || (key === '0' && countBuf !== '')) {
    return pendingOnly(state, bumpCount(opPending ? { operatorCount: countBuf + key } : { count: countBuf + key }));
  }

  if (key === '"') return pendingOnly(state, bump({ awaiting: 'register' }));
  if (key === 'g') return pendingOnly(state, bump({ awaiting: 'g' }));

  if (key === '<Esc>') return { state: { ...state, pending: EMPTY_PENDING }, events: [] };

  const { count, hasCount } = countOf(p);

  if (key === 'f' || key === 'F' || key === 't' || key === 'T') {
    return pendingOnly(state, bump({ awaiting: 'find', findCmd: key }));
  }

  // `` ` `` and `'` are motions, so they compose with operators. `m` is not —
  // `dm` is nonsense, and Vim beeps rather than swallowing the next key.
  if (key === '`') return pendingOnly(state, bump({ awaiting: 'mark-exact' }));
  if (key === "'") return pendingOnly(state, bump({ awaiting: 'mark-line' }));
  if (key === 'm') {
    if (opPending) return invalid(state, keys.join(''), 'no-such-motion');
    return pendingOnly(state, bump({ awaiting: 'mark' }));
  }

  // `<C-o>`/`<C-i>` are commands, not motions — Vim's `checkclearopq` beeps
  // when an operator is pending rather than jumping. `<C-i>` and `<Tab>` are
  // the same key at the terminal, so both must work.
  if (key === '<C-o>' || key === '<C-i>' || key === '<Tab>') {
    if (opPending) return invalid(state, keys.join(''), 'no-such-motion');
    return doJumpList(state, key === '<C-o>' ? -count : count);
  }

  // --- operators ------------------------------------------------------------

  if (opPending && key === doublingKey(p.operator!)) {
    return applyLinewise(state, p.operator!, count, keys.join(''));
  }

  const asOperator = OPERATORS[key];
  if (asOperator !== undefined && !opPending) {
    return pendingOnly(state, bump({ operator: asOperator }));
  }

  // `i` and `a` mean "insert" only in normal mode; with an operator pending
  // they are the two text-object prefixes and nothing else.
  if (opPending && (key === 'i' || key === 'a')) {
    return pendingOnly(state, bump({ awaiting: 'textobject', textObjectKind: key }));
  }

  // --- motions --------------------------------------------------------------

  if (MOTION_KEYS.has(key)) {
    // The `cw` special case has to be decided before the motion runs.
    const motion =
      opPending && p.operator === 'c' && (key === 'w' || key === 'W')
        ? changeWordMotion(state, key === 'W', count)
        : resolveMotion(state, key, opPending, count, hasCount);

    if (motion === null) return invalid(state, keys.join(''), 'motion-failed');
    // A jump records its origin even when it lands where it started (`3G` on
    // line three still pushes) and even with an operator pending (`d}` pushes)
    // — but only once the motion has SUCCEEDED, since Vim's setpcmark sits
    // after the walk.
    const jumped = motion.isJump === true ? recordJump(state) : state;
    if (opPending) return applyOperator(jumped, p.operator!, motion, keys.join(''));

    const desired = key === '$' ? MAX_COL : undefined;
    const keep = motion.keepDesiredCol === true ? state.desiredCol : desired;
    return withCursor(jumped, motion.target, keep);
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
    case '.':
      return doRepeat(state, hasCount ? count : 0);
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

    // Visual mode entry. The anchor is the cursor; from here every motion
    // extends the selection, which is why visual mode needs no motion code of
    // its own.
    case 'v':
      return enterVisual(state, 'visual');
    case 'V':
      return enterVisual(state, 'visual-line');
    case '<C-v>':
      return enterVisual(state, 'visual-block');

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
  return runOperator(state, op, range, opStart, { forcesNumbered: motion.forcesNumbered === true });
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
  return runOperator(state, op, range, opStart);
}

type RunOperator = {
  /** A delete over this region always shifts into `"1` (`% { } ( )` and marks). */
  readonly forcesNumbered?: boolean;
  /** The region came from a text object rather than from a motion. */
  readonly fromObject?: boolean;
  /**
   * The region came from a VISUAL selection. Vim carries this as
   * `oap->is_VIsual` and branches on it in more places than one would guess —
   * `op_delete`'s linewise promotion is skipped, and the region's start column
   * is real the way an object's is.
   */
  readonly fromVisual?: boolean;
  /**
   * How many times to apply a SHIFT. In visual mode a count before `>` means
   * "shift this much", so `2>` moves two shiftwidths — unlike normal mode's
   * `2>>`, where the count means two LINES.
   */
  readonly shiftCount?: number;
};

function runOperator(
  state: EditorState,
  op: O.OperatorName,
  range: O.OperatorRange,
  opStart: Pos,
  opts: RunOperator = {},
): StepResult {
  const forcesNumbered = opts.forcesNumbered === true;
  const fromVisual = opts.fromVisual === true;
  // A visual selection names its own region, so its start column is real in
  // exactly the way a text object's is — both pull a linewise yank's cursor to
  // column one, where a linewise MOTION leaves the column alone.
  const fromObject = opts.fromObject === true || fromVisual;
  const shiftCount = opts.shiftCount ?? 1;

  const explicit = state.pending.register;
  const { first: firstLine, last: lastRangeLine } = O.rangeLines(range);

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
    //
    // The cursor still lands on the region's start, which for a motion is where
    // it already was — but NOT for a text object: `di(` on `()` moves onto the
    // position between the brackets even though it deletes nothing.
    return { state: commit(state, state.lines, range.start, undefined, opStart), events: [] };
  }

  if (op === '>' || op === '<') {
    const r = O.applyIndent(state.lines, op, range, state.options, shiftCount);
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
    // region begins before where the cursor was — but "before" is measured
    // differently depending on where the region came from, and the two cases
    // genuinely disagree in Vim:
    //
    //  - from a MOTION, a linewise region has no meaningful start column, so
    //    only crossing lines counts. `y_` and `yy` leave the column alone even
    //    though `_` moves to the first non-blank; `ygg` jumps.
    //  - from an OBJECT, the region's start column is real and it is zero, so
    //    `yip` and `yi{` pull the cursor to column one of the first line even
    //    when that line is the one the cursor was already on.
    const moved =
      range.kind === 'charwise' || fromObject
        ? comparePos(opStart, state.cursor) < 0
        : opStart.line < state.cursor.line;
    const cursor = clamp(state.lines, moved ? opStart : state.cursor, false);
    return {
      state: { ...state, cursor, desiredCol: cursor.col, registers, pending: EMPTY_PENDING },
      events: [{ type: 'RegisterChanged', name: explicit ?? '"' }],
    };
  }

  const r =
    op === 'd'
      ? O.applyDelete(state.lines, range, !fromVisual)
      : O.applyChange(state.lines, range, state.options);

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
    const entered = enterInsert(next, {
      at: r.cursor,
      count: 1,
      fromChange: true,
      changeStart: opStart,
      ...(range.kind === 'blockwise'
        ? { blockRows: { firstLine: range.firstLine, lastLine: range.lastLine, col: range.startCol } }
        : {}),
    });
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

// --- visual mode ------------------------------------------------------------

function isVisual(mode: Mode): boolean {
  return mode === 'visual' || mode === 'visual-line' || mode === 'visual-block';
}

function enterVisual(state: EditorState, mode: Mode): StepResult {
  return {
    state: { ...state, mode, visualStart: state.cursor, pending: EMPTY_PENDING },
    events: [{ type: 'ModeChanged', from: state.mode, to: mode }],
  };
}

function leaveVisual(state: EditorState): EditorState {
  return {
    ...state,
    mode: 'normal',
    visualStart: undefined,
    // Remember it for `gv`, whichever way we are leaving.
    lastVisual: { mode: state.mode, start: state.visualStart ?? state.cursor, end: state.cursor },
    pending: EMPTY_PENDING,
  };
}

/**
 * The selection as an operator range. `'selection'` is `inclusive` in the
 * baseline, so the character under the cursor is part of it — which is why a
 * one-character charwise selection is a real one-character region and never a
 * degenerate one.
 */
function selectionRange(state: EditorState, anchor: Pos): O.OperatorRange {
  const { cursor, mode } = state;
  const backwards = comparePos(cursor, anchor) < 0;
  const from = backwards ? cursor : anchor;
  const to = backwards ? anchor : cursor;

  if (mode === 'visual-line') {
    return { kind: 'linewise', firstLine: from.line, lastLine: to.line };
  }
  if (mode === 'visual-block') {
    // A block's columns are independent of which corner the cursor is in, so
    // they are the min and max of the two — dragging left-and-down still
    // selects a rectangle.
    //
    // …unless `$` set the remembered column to MAXCOL, in which case the right
    // edge is each row's own end of line and the block is ragged by design.
    return {
      kind: 'blockwise',
      firstLine: from.line,
      lastLine: to.line,
      startCol: Math.min(anchor.col, cursor.col),
      endCol: Math.max(anchor.col, cursor.col),
      ...(state.desiredCol === MAX_COL ? { toEndOfLine: true } : {}),
    };
  }
  // An inclusive end that lands PAST the end of its line takes the line break
  // with it. Two selections that look nothing alike hit this rule:
  //
  //  - an EMPTY line, where column zero already IS the end-of-line position, so
  //    `v` alone there yields a register holding `"\n"`;
  //  - `v$`, the only motion that parks the cursor on the end-of-line NUL, which
  //    is why `v$d` joins the next line up while `vlld` over the same three
  //    characters leaves an empty one behind.
  //
  // On the last line there is no break to take, so the end clamps instead.
  const len = lineAt(state.lines, to.line).length;
  if (to.col + 1 > len && to.line < lastLine(state.lines)) {
    return { kind: 'charwise', start: from, end: { line: to.line + 1, col: 0 } };
  }
  return { kind: 'charwise', start: from, end: { line: to.line, col: Math.min(to.col + 1, len) } };
}

/** In visual mode these keys mean an operator over the selection, nothing else. */
const VISUAL_OPERATORS: Record<string, O.OperatorName> = {
  d: 'd', x: 'd', y: 'y', c: 'c', s: 'c',
  '>': '>', '<': '<',
  u: 'gu', U: 'gU', '~': 'g~',
};

/** …and these force the selection to whole lines first, whatever it was. */
const VISUAL_LINEWISE_OPERATORS: Record<string, O.OperatorName> = {
  D: 'd', X: 'd', Y: 'y', C: 'c', S: 'c', R: 'c',
};

function stepVisual(state: EditorState, key: KeyToken): StepResult {
  const p = state.pending;
  const keys = [...p.keyBuffer, key];
  const bump = (patch: Partial<Pending>): Pending => ({
    ...p,
    ...patch,
    keyBuffer: keys,
    dotKeys: [...p.dotKeys, key],
  });
  const bumpCount = (patch: Partial<Pending>): Pending => ({
    ...p,
    ...patch,
    keyBuffer: keys,
    dotKeys: p.dotKeys,
  });
  const anchor = state.visualStart ?? state.cursor;
  const { count, hasCount } = countOf(p);

  const ctx = (): M.MotionContext => motionCtx(state, count, hasCount, false, true);

  /**
   * Move the cursor, keeping the anchor — this is all "extending" ever is.
   * The clamp allows the end-of-line position, because visual mode's cursor
   * may rest on the NUL. Only `$` ever puts it there.
   */
  const extendTo = (to: Pos, desiredCol?: number): StepResult => {
    const cursor = clamp(state.lines, to, true);
    return {
      state: { ...state, cursor, desiredCol: desiredCol ?? cursor.col, pending: EMPTY_PENDING },
      events: [{ type: 'CursorMoved', to: cursor }],
    };
  };

  const runOverSelection = (op: O.OperatorName, forceLinewise: boolean): StepResult => {
    const range = forceLinewise
      ? ({
          kind: 'linewise',
          firstLine: Math.min(anchor.line, state.cursor.line),
          lastLine: Math.max(anchor.line, state.cursor.line),
        } as O.OperatorRange)
      : selectionRange(state, anchor);
    // Leave visual mode BEFORE the operator runs, so the resulting state is a
    // normal-mode one and the operator's own cursor rules apply unchanged. The
    // explicit register has to survive that transition — `leaveVisual` clears
    // pending, and `runOperator` reads the register off it, so `v"ay` would
    // otherwise silently write the unnamed register instead of `"a`.
    const normal: EditorState = {
      ...leaveVisual(state),
      pending: { ...EMPTY_PENDING, register: p.register },
    };
    const result = runOperator(normal, op, range, O.rangeStart(range), {
      fromVisual: true,
      shiftCount: count,
    });
    return {
      state: { ...result.state, mode: result.state.insert === undefined ? 'normal' : result.state.mode },
      events: [{ type: 'ModeChanged', from: state.mode, to: result.state.mode }, ...result.events],
    };
  };

  // --- character arguments --------------------------------------------------

  if (p.awaiting === 'register') {
    if (!/^[a-zA-Z0-9"_\-]$/.test(key)) return invalid(state, keys.join(''), 'unknown-key');
    return pendingOnly(state, bump({ register: key, awaiting: undefined }));
  }

  if (p.awaiting === 'find') {
    if (key.length !== 1) return invalid(state, keys.join(''), 'unknown-key');
    const cmd = p.findCmd!;
    const r = M.moveFind(ctx(), cmd, key);
    const remembered: EditorState = { ...state, lastFind: { cmd, ch: key } };
    if (r === null) return invalid(remembered, keys.join(''), 'motion-failed');
    const moved = extendTo(r.target);
    return { ...moved, state: { ...moved.state, lastFind: { cmd, ch: key } } };
  }

  if (p.awaiting === 'textobject') {
    if (key === '<Esc>') return { state: { ...state, pending: EMPTY_PENDING }, events: [] };
    if (key.length !== 1) return invalid(state, keys.join(''), 'unknown-key');
    const range = T.textObject(state.lines, state.cursor, p.textObjectKind!, key, count);
    if (range === null) return invalid(state, keys.join(''), 'no-such-motion');
    // An object REPLACES the selection with its own extent, anchor included.
    const start = O.rangeStart(range);
    const end =
      range.kind === 'charwise'
        ? { line: range.end.line, col: Math.max(0, range.end.col - 1) }
        : { line: O.rangeLines(range).last, col: state.cursor.col };
    return {
      state: {
        ...state,
        visualStart: clamp(state.lines, start, false),
        cursor: clamp(state.lines, end, false),
        pending: EMPTY_PENDING,
      },
      events: [{ type: 'CursorMoved', to: clamp(state.lines, end, false) }],
    };
  }

  if (p.awaiting === 'replace') {
    // `<Esc>` here cancels the `r` AND leaves visual mode, without changing
    // anything — the selection is simply dropped.
    if (key === '<Esc>') {
      return { state: leaveVisual(state), events: [{ type: 'ModeChanged', from: state.mode, to: 'normal' }] };
    }
    if (key.length !== 1) return invalid(state, keys.join(''), 'unknown-key');
    return visualReplace(state, anchor, key);
  }

  if (p.awaiting === 'mark') {
    if (!K.isMarkName(key)) return invalid(state, keys.join(''), 'unknown-key');
    return {
      state: { ...state, marks: { ...state.marks, [key]: state.cursor }, pending: EMPTY_PENDING },
      events: [],
    };
  }

  if (p.awaiting === 'mark-exact' || p.awaiting === 'mark-line') {
    if (key === '<Esc>') return { state: { ...state, pending: EMPTY_PENDING }, events: [] };
    const target = K.isPreviousContext(key)
      ? state.pcmark
      : K.isMarkName(key)
        ? state.marks[key]
        : undefined;
    if (!K.isPreviousContext(key) && !K.isMarkName(key)) return invalid(state, keys.join(''), 'unknown-key');
    if (target === undefined) return invalid(state, keys.join(''), 'mark-not-set');
    const at = clamp(state.lines, target, false);
    // `'a` extends to the first non-blank of the mark's line; `` `a `` to the
    // exact column. The selection's KIND is unchanged either way — that is
    // decided by `v` versus `V`, not by which mark key was used.
    const to =
      p.awaiting === 'mark-line' ? { line: at.line, col: firstNonBlank(state.lines, at.line) } : at;
    // Push the position we are LEAVING, then move — so `<C-o>` after the
    // selection returns to where the selection started growing from.
    const jumped = recordJump(state);
    const cursor = clamp(state.lines, to, false);
    return {
      state: { ...jumped, cursor, desiredCol: cursor.col, pending: EMPTY_PENDING },
      events: [{ type: 'CursorMoved', to: cursor }],
    };
  }

  if (p.awaiting === 'g') {
    switch (key) {
      case 'g':
        return extendTo(M.moveGotoFirstLine(ctx()).target);
      case 'e':
      case 'E': {
        const r = M.moveWordEndBackward({ ...ctx(), arg: key === 'E' ? 'gE' : 'ge' });
        if (r === null) return invalid(state, keys.join(''), 'motion-failed');
        return extendTo(r.target);
      }
      case 'u':
        return runOverSelection('gu', false);
      case 'U':
        return runOverSelection('gU', false);
      case '~':
        return runOverSelection('g~', false);
      case 'v':
        // `gv` from inside visual mode SWAPS: the stored selection becomes
        // current and the current one becomes stored.
        return reselect(state, { mode: state.mode, start: anchor, end: state.cursor });
      default:
        return invalid(state, keys.join(''), 'no-such-motion');
    }
  }

  // --- prefixes -------------------------------------------------------------

  if (/^[1-9]$/.test(key) || (key === '0' && p.count !== '')) {
    return pendingOnly(state, bumpCount({ count: p.count + key }));
  }
  if (key === '"') return pendingOnly(state, bump({ awaiting: 'register' }));
  if (key === 'g') return pendingOnly(state, bump({ awaiting: 'g' }));
  if (key === 'f' || key === 'F' || key === 't' || key === 'T') {
    return pendingOnly(state, bump({ awaiting: 'find', findCmd: key }));
  }
  if (key === 'i' || key === 'a') {
    return pendingOnly(state, bump({ awaiting: 'textobject', textObjectKind: key }));
  }
  if (key === 'm') return pendingOnly(state, bump({ awaiting: 'mark' }));
  if (key === '`') return pendingOnly(state, bump({ awaiting: 'mark-exact' }));
  if (key === "'") return pendingOnly(state, bump({ awaiting: 'mark-line' }));

  // --- leaving, and switching between the three visual modes ----------------

  if (key === '<Esc>') {
    return { state: leaveVisual(state), events: [{ type: 'ModeChanged', from: state.mode, to: 'normal' }] };
  }

  const asVisual: Record<string, Mode> = { v: 'visual', V: 'visual-line', '<C-v>': 'visual-block' };
  const wanted = asVisual[key];
  if (wanted !== undefined) {
    // The same key again leaves; a different one switches KIND while keeping
    // the selection, so `v`-then-`V` promotes what you already had to lines.
    if (wanted === state.mode) {
      return { state: leaveVisual(state), events: [{ type: 'ModeChanged', from: state.mode, to: 'normal' }] };
    }
    return {
      state: { ...state, mode: wanted, pending: EMPTY_PENDING },
      events: [{ type: 'ModeChanged', from: state.mode, to: wanted }],
    };
  }

  // `o` swaps which end of the selection the cursor holds.
  if (key === 'o') {
    return {
      state: { ...state, visualStart: state.cursor, cursor: anchor, desiredCol: anchor.col, pending: EMPTY_PENDING },
      events: [{ type: 'CursorMoved', to: anchor }],
    };
  }

  // --- operators over the selection ----------------------------------------

  // `r` over a selection replaces every character it covers. It takes its
  // argument next, so it has to be checked before the operator tables — and
  // before `R`, which is a linewise change.
  if (key === 'r') return pendingOnly(state, bump({ awaiting: 'replace' }));

  // `I` and `A` open an insert session rather than running an operator.
  if (key === 'I' || key === 'A') return visualInsert(state, anchor, key === 'A');

  // `p`/`P` REPLACE the selection with a register. `P` is the one that does
  // not clobber the unnamed register with what it just removed.
  if (key === 'p' || key === 'P') return visualPut(state, anchor, key === 'p');

  const lineOp = VISUAL_LINEWISE_OPERATORS[key];
  if (lineOp !== undefined) return runOverSelection(lineOp, true);

  const op = VISUAL_OPERATORS[key];
  if (op !== undefined) return runOverSelection(op, false);

  // --- motions --------------------------------------------------------------

  if (MOTION_KEYS.has(key)) {
    const motion = resolveMotion(state, key, false, count, hasCount, true);
    if (motion === null) return invalid(state, keys.join(''), 'motion-failed');
    const desired = key === '$' ? MAX_COL : undefined;
    const keep = motion.keepDesiredCol === true ? state.desiredCol : desired;
    const moved = extendTo(motion.target, keep);
    return motion.isJump === true
      ? { ...moved, state: { ...moved.state, jumps: K.pushJump(state.jumps, state.cursor), pcmark: state.cursor } }
      : moved;
  }

  return reject(state, key, 'unknown-key');
}

/**
 * `gv` — restore the last selection. `swapWith` is the selection to store in
 * its place, which is what makes `gv` from inside visual mode a swap rather
 * than a replacement.
 */
function reselect(
  state: EditorState,
  swapWith: { readonly mode: Mode; readonly start: Pos; readonly end: Pos } | undefined,
): StepResult {
  const last = state.lastVisual;
  if (last === undefined) return invalid(state, 'gv', 'no-such-motion');
  const start = clamp(state.lines, last.start, true);
  const cursor = clamp(state.lines, last.end, true);
  return {
    state: {
      ...state,
      mode: last.mode,
      visualStart: start,
      cursor,
      desiredCol: cursor.col,
      lastVisual: swapWith,
      pending: EMPTY_PENDING,
    },
    events: [{ type: 'ModeChanged', from: state.mode, to: last.mode }, { type: 'CursorMoved', to: cursor }],
  };
}

/**
 * `I` and `A` from visual mode.
 *
 * Blockwise is the interesting one: typing happens on the first row and is
 * replicated down the block on `<Esc>`. The two keys disagree about ragged
 * edges, and the difference is not cosmetic —
 *
 *  - `I` SKIPS a row too short to reach the column,
 *  - `A` PADS it out with spaces first.
 *
 * Which is why `<C-v>$A` is the idiom for appending to every line: with `$`
 * the column is each row's own end, so nothing is short and nothing is padded.
 *
 * Charwise and linewise selections do not replicate at all: `I` inserts at
 * column zero of the first selected line (NOT its first non-blank, unlike
 * normal-mode `I`), and `A` appends after the selection's far end.
 */
function visualInsert(state: EditorState, anchor: Pos, append: boolean): StepResult {
  const range = selectionRange(state, anchor);
  const normal = leaveVisual(state);

  if (range.kind !== 'blockwise') {
    const { first, last } = O.rangeLines(range);
    const at: Pos = append
      ? range.kind === 'linewise'
        ? { line: last, col: Math.max(anchor.col, state.cursor.col) + 1 }
        : { line: range.end.line, col: range.end.col }
      : { line: first, col: 0 };
    return enterInsert(normal, { at, count: 1, changeStart: at });
  }

  const col = append
    ? range.toEndOfLine === true
      ? lineAt(state.lines, range.firstLine).length
      : range.endCol + 1
    : range.startCol;
  const at: Pos = { line: range.firstLine, col };
  return enterInsert(normal, {
    at,
    count: 1,
    changeStart: at,
    blockRows: {
      firstLine: range.firstLine,
      lastLine: range.lastLine,
      col,
      pad: append,
      landCol: range.startCol,
      ...(range.toEndOfLine === true ? { toEndOfLine: true } : {}),
    },
  });
}

/**
 * `p` / `P` over a selection: remove it, then put the register in its place.
 *
 * The register is read BEFORE the delete, or `p` would paste whatever it just
 * removed. `p` then overwrites the unnamed register with the removed text and
 * `P` leaves it alone — that asymmetry is the entire reason `P` exists here,
 * and it is what makes `viwP` repeatable over several words.
 */
function visualPut(state: EditorState, anchor: Pos, clobber: boolean): StepResult {
  const name = state.pending.register ?? UNNAMED;
  const value = name === BLACKHOLE ? EMPTY_VALUE : readRegister(state.registers, name);
  const range = selectionRange(state, anchor);
  const normal = leaveVisual(state);

  if (value === undefined) {
    return {
      state: commit(normal, state.lines, state.cursor, undefined, state.cursor),
      events: [{ type: 'InvalidCommand', keys: `"${name}p`, reason: 'empty-register' }],
    };
  }

  // Replacing whole LINES is a line splice, not a delete followed by a put:
  // the register's body simply takes the selected lines' place, whatever
  // shape the register has.
  if (range.kind === 'linewise') {
    const body = value.type === 'linewise' ? value.text.replace(/\n$/, '').split('\n') : value.text.split('\n');
    const removed = `${state.lines.slice(range.firstLine, range.lastLine + 1).join('\n')}\n`;
    const lines = [...state.lines.slice(0, range.firstLine), ...body, ...state.lines.slice(range.lastLine + 1)];
    const at = { line: range.firstLine, col: firstNonBlank(lines, range.firstLine) };
    const registers = clobber
      ? recordWrite(state.registers, { isYank: false, type: 'linewise', text: removed, multiline: true })
      : state.registers;
    return {
      state: commit(normal, lines, at, registers, at),
      events: [changedSpan(state.lines, lines, range.firstLine)],
    };
  }

  const deleted = O.applyDelete(state.lines, range, false);
  const registers =
    clobber && deleted.captured!.text !== ''
      ? recordWrite(state.registers, {
          isYank: false,
          type: deleted.captured!.type,
          text: deleted.captured!.text,
          multiline: deleted.captured!.multiline,
        })
      : state.registers;

  const at = deleted.cursor;

  // A LINEWISE register put into a charwise hole splits the line open at the
  // hole and drops the register's lines in between — the head and tail of the
  // original line become lines of their own.
  if (value.type === 'linewise') {
    const text = lineAt(deleted.lines, at.line);
    const body = value.text.replace(/\n$/, '').split('\n');
    const lines = [
      ...deleted.lines.slice(0, at.line),
      text.slice(0, at.col),
      ...body,
      text.slice(at.col),
      ...deleted.lines.slice(at.line + 1),
    ];
    const landed = { line: at.line + 1, col: firstNonBlank(lines, at.line + 1) };
    return {
      state: commit(normal, lines, landed, registers, landed),
      events: [changedSpan(state.lines, lines, at.line)],
    };
  }

  // Otherwise put BEFORE the hole — the cursor is already where the removed
  // text started, so there is nothing to step over.
  const r = P.applyPut(deleted.lines, at, value, false, 1);
  return {
    state: commit(normal, r.lines, r.cursor, registers, at),
    events: [changedSpan(state.lines, r.lines, r.firstLine)],
  };
}

/**
 * `r` over a selection: every character it covers becomes `ch`. Line breaks
 * are never replaced, so a charwise selection spanning lines keeps its shape,
 * and a block leaves rows too short to reach it alone.
 */
function visualReplace(state: EditorState, anchor: Pos, ch: string): StepResult {
  const range = selectionRange(state, anchor);
  const normal = leaveVisual(state);
  const next = [...state.lines];

  const overwrite = (line: number, from: number, to: number): void => {
    const text = lineAt(state.lines, line);
    const start = Math.min(from, text.length);
    const end = Math.min(Math.max(to, start), text.length);
    next[line] = text.slice(0, start) + ch.repeat(end - start) + text.slice(end);
  };

  if (range.kind === 'linewise') {
    for (let l = range.firstLine; l <= range.lastLine; l += 1) overwrite(l, 0, lineAt(state.lines, l).length);
  } else if (range.kind === 'blockwise') {
    for (let l = range.firstLine; l <= range.lastLine; l += 1) {
      if (lineAt(state.lines, l).length <= range.startCol) continue;
      overwrite(l, range.startCol, O.blockRowEnd(state.lines, range, l) + 1);
    }
  } else {
    for (let l = range.start.line; l <= range.end.line; l += 1) {
      const from = l === range.start.line ? range.start.col : 0;
      const to = l === range.end.line ? range.end.col : lineAt(state.lines, l).length;
      overwrite(l, from, to);
    }
  }

  const at = O.rangeStart(range);
  const { first, last } = O.rangeLines(range);
  return {
    state: commit(normal, next, at, undefined, at),
    events: [changedSpan(state.lines, next, first, last)],
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
  /** A blockwise change replicates what is typed down the rest of the block. */
  readonly blockRows?: NonNullable<I.InsertSession['blockRows']>;
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
        blockRows: opts.blockRows,
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

  // A blockwise insert typed on the first row only; now put the same text on
  // every other row of the block. Rows too short to reach the block's column
  // are skipped rather than padded — that is Vim's rule, and it is why a block
  // insert down a ragged edge silently misses the short lines.
  const block = session.blockRows;
  let landAt: Pos | undefined;
  if (block !== undefined) {
    const typed = lineAt(lines, block.firstLine).slice(block.col, cursor.col);
    // A typed line break abandons replication entirely — only the first row
    // gets it, which is why `<C-v>I` with a `<CR>` in it looks like it broke.
    if (typed !== '' && !typed.includes('\n')) {
      if (block.landCol !== undefined) landAt = { line: block.firstLine, col: block.landCol };
      const next = [...lines];
      for (let l = block.firstLine + 1; l <= Math.min(block.lastLine, lastLine(next)); l += 1) {
        const text = next[l]!;
        const col = block.toEndOfLine === true ? text.length : block.col;
        if (text.length < col) {
          // Too short to reach the block. `A` pads; everything else skips.
          if (block.pad !== true) continue;
          next[l] = text + ' '.repeat(col - text.length) + typed;
          continue;
        }
        next[l] = text.slice(0, col) + typed + text.slice(col);
      }
      lines = next;
    }
  }

  // Leaving insert mode steps the cursor left — the classic off-by-one. A
  // blockwise `I`/`A` overrides that and returns to the block's left edge.
  const landed = clamp(lines, landAt ?? { line: cursor.line, col: Math.max(0, cursor.col - 1) }, false);

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
      // An insert session that opened or joined lines shifts marks too — `o`
      // above a mark pushes it down exactly as `p` does.
      ...withShiftedMarks(state, lines),
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

/**
 * Every jump records where it left from, in both places Vim keeps it: the
 * jumplist that `<C-o>` walks, and the single previous-context mark that
 * `` `` `` and `''` return to.
 */
function recordJump(state: EditorState): EditorState {
  return { ...state, jumps: K.pushJump(state.jumps, state.cursor), pcmark: state.cursor };
}

/**
 * `` `x `` and `'x`. The two keys differ only in the shape of the motion they
 * produce — exact-and-charwise-exclusive versus first-non-blank-and-linewise —
 * which is why they are one function and why `` d`a `` and `d'a` take
 * different amounts of text.
 *
 * `` ` `` and `'` name the previous-context mark instead of a letter, so
 * `` `` `` returns to exactly where the last jump started and `''` returns to
 * that line's first non-blank.
 */
function doMarkJump(state: EditorState, key: KeyToken, linewise: boolean, keys: string): StepResult {
  if (key === '<Esc>') return { state: { ...state, pending: EMPTY_PENDING }, events: [] };

  const target = K.isPreviousContext(key)
    ? state.pcmark
    : K.isMarkName(key)
      ? state.marks[key]
      : undefined;

  if (!K.isPreviousContext(key) && !K.isMarkName(key)) return invalid(state, keys, 'unknown-key');
  // A mark whose line was deleted is GONE, not relocated, so this is the same
  // E20 as a mark that was never set. The game layer can tell the player the
  // place they meant to return to no longer exists.
  if (target === undefined) return invalid(state, keys, 'mark-not-set');

  const at = clamp(state.lines, target, false);
  const motion: MotionResult = linewise
    ? {
        target: { line: at.line, col: firstNonBlank(state.lines, at.line) },
        kind: 'linewise',
        inclusive: false,
        isJump: true,
      }
    : { target: at, kind: 'charwise', inclusive: false, forcesNumbered: true, isJump: true };

  const jumped = recordJump(state);
  const operator = state.pending.operator;
  if (operator !== undefined) return applyOperator(jumped, operator, motion, keys);
  return withCursor(jumped, motion.target);
}

/** `<C-o>` (count negative) and `<C-i>` (positive). */
function doJumpList(state: EditorState, count: number): StepResult {
  const step = K.moveJump(state.jumps, state.cursor, count);
  if (step === null) return invalid(state, count < 0 ? '<C-o>' : '<C-i>', 'no-jump');
  const cursor = clamp(state.lines, step.to, false);
  return {
    state: {
      ...state,
      jumps: step.jumps,
      ...(step.recorded ? { pcmark: state.cursor } : {}),
      cursor,
      desiredCol: cursor.col,
      pending: EMPTY_PENDING,
    },
    events: [{ type: 'CursorMoved', to: cursor }],
  };
}

/**
 * `.` — replay the recorded change at the cursor.
 *
 * The replay runs through `step` itself rather than through a parallel
 * implementation, so a repeated command cannot drift from the typed one. The
 * `replaying` flag stops the replay from re-recording, and a count typed on
 * the `.` sticks for the NEXT `.` too — measured: `dw` `3.` `.` deletes one,
 * then three, then three again.
 */
function doRepeat(state: EditorState, newCount: number): StepResult {
  const record = state.dot;
  if (record === undefined) return invalid(state, '.', 'nothing-to-repeat');

  let s: EditorState = { ...state, replaying: true, pending: EMPTY_PENDING };
  const events: EngineEvent[] = [];

  // A visual change repeats by SHAPE: the same size of selection is rebuilt
  // wherever the cursor now is, and the recorded operator runs over that.
  if (record.visual !== undefined) {
    const [anchor, end] = D.replaySelection(record.visual, state.cursor);
    s = {
      ...s,
      mode: record.visual.mode,
      visualStart: clamp(state.lines, anchor, true),
      cursor: clamp(state.lines, end, true),
    };
  }

  for (const k of D.replayKeys(record, newCount)) {
    const r = step(s, k);
    s = r.state;
    events.push(...r.events);
  }

  return {
    state: {
      ...s,
      replaying: false,
      dot: D.withCount(record, newCount),
      pending: EMPTY_PENDING,
    },
    events,
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
